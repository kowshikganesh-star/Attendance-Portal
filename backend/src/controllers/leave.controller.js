// src/controllers/leave.controller.js
import { PrismaClient } from '@prisma/client';
import { workingDays, BALANCE_TYPES } from './leaveBalance.controller.js';

const prisma = new PrismaClient();

const calcDays = (from, to) => {
  const diff = new Date(to) - new Date(from);
  return Math.ceil(diff / (1000 * 60 * 60 * 24)) + 1;
};

// ── Helper: convert split [{type, days}] into [{type, fromDate, toDate}] ──
// Walks calendar, skips Sat/Sun, assigns working days to each chunk in order.
function buildDateChunks(fromDate, toDate, splits) {
  const chunks = [];
  const cur    = new Date(fromDate); cur.setHours(0, 0, 0, 0);
  const end    = new Date(toDate);   end.setHours(0, 0, 0, 0);

  for (const split of splits) {
    let remaining  = split.days;
    let chunkStart = null;
    let chunkEnd   = null;

    while (remaining > 0 && cur <= end) {
      const dow = cur.getDay(); // 0 = Sun, 6 = Sat
      if (dow !== 0 && dow !== 6) {
        if (!chunkStart) chunkStart = new Date(cur);
        chunkEnd = new Date(cur);
        remaining--;
      }
      if (remaining > 0) cur.setDate(cur.getDate() + 1);
    }

    chunks.push({ type: split.type, fromDate: chunkStart, toDate: chunkEnd });
    cur.setDate(cur.getDate() + 1); // advance past last day of chunk
  }

  return chunks;
}

export const applyLeave = async (req, res, next) => {
  try {
    const { type, fromDate, toDate, reason } = req.body;
    const userId = req.user.id;

    if (!type || !fromDate || !toDate || !reason) {
      return res.status(400).json({
        success: false,
        message: 'All fields are required.',
      });
    }

    if (!['SL', 'CL', 'LOP', 'HD_LOP', 'PL'].includes(type)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid leave type.',
      });
    }

    const from = new Date(fromDate);
    const to   = new Date(toDate);

    if (from > to) {
      return res.status(400).json({
        success: false,
        message: 'From date cannot be after to date.',
      });
    }

    const overlap = await prisma.leaveRequest.findFirst({
      where: {
        userId,
        status: { in: ['PENDING', 'APPROVED'] },
        OR: [{ fromDate: { lte: to }, toDate: { gte: from } }],
      },
    });

    if (overlap) {
      return res.status(400).json({
        success: false,
        message: 'You already have a leave request for overlapping dates.',
      });
    }

    const leave = await prisma.leaveRequest.create({
      data: { userId, type, fromDate: from, toDate: to, reason },
      include: {
        user: { select: { name: true, email: true } },
      },
    });

    return res.status(201).json({
      success: true,
      message: `${type} leave applied successfully for ${calcDays(from, to)} day(s).`,
      leave,
    });
  } catch (err) {
    next(err);
  }
};

export const getMyLeaves = async (req, res, next) => {
  try {
    const userId = req.user.id;

    const leaves = await prisma.leaveRequest.findMany({
      where:   { userId },
      include: { reviewer: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
    });

    const total    = leaves.length;
    const pending  = leaves.filter((l) => l.status === 'PENDING').length;
    const approved = leaves.filter((l) => l.status === 'APPROVED').length;
    const rejected = leaves.filter((l) => l.status === 'REJECTED').length;

    return res.status(200).json({
      success: true,
      stats: { total, pending, approved, rejected },
      leaves,
    });
  } catch (err) {
    next(err);
  }
};

export const getAllLeaves = async (req, res, next) => {
  try {
    const { status, type, userId } = req.query;

    const where = {
      ...(status && status !== 'ALL' ? { status } : {}),
      ...(type   && type   !== 'ALL' ? { type   } : {}),
      ...(userId ? { userId: parseInt(userId) } : {}),
    };

    const leaves = await prisma.leaveRequest.findMany({
      where,
      include: {
        user:     { select: { id: true, name: true, email: true } },
        reviewer: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const employees = await prisma.user.findMany({
      where:   { role: 'EMPLOYEE', isActive: true },
      select:  { id: true, name: true, email: true },
      orderBy: { name: 'asc' },
    });

    const total    = leaves.length;
    const pending  = leaves.filter((l) => l.status === 'PENDING').length;
    const approved = leaves.filter((l) => l.status === 'APPROVED').length;
    const rejected = leaves.filter((l) => l.status === 'REJECTED').length;

    return res.status(200).json({
      success: true,
      stats: { total, pending, approved, rejected },
      leaves,
      employees,
    });
  } catch (err) {
    next(err);
  }
};

export const approveLeave = async (req, res, next) => {
  try {
    const { id }      = req.params;
    const adminRemark = req.body?.adminRemark?.trim() || null;
    const type        = req.body?.type  || null;   // single-type path
    const splits      = req.body?.splits || null;  // split path: [{type, days}, ...]

    // Validate type if provided (single path)
    if (type && !['SL', 'CL', 'LOP', 'HD_LOP', 'PL'].includes(type)) {
      return res.status(400).json({ success: false, message: 'Invalid leave type.' });
    }

    const leave = await prisma.leaveRequest.findUnique({ where: { id: parseInt(id) } });

    if (!leave) {
      return res.status(404).json({ success: false, message: 'Leave request not found.' });
    }

    if (leave.status !== 'PENDING') {
      return res.status(400).json({
        success: false,
        message: `Leave is already ${leave.status.toLowerCase()}.`,
      });
    }

    // ── SPLIT APPROVAL PATH ────────────────────────────────────────────────
    if (splits && Array.isArray(splits) && splits.length > 1) {

      // Validate each split entry
      for (const s of splits) {
        if (!['SL', 'CL', 'LOP', 'HD_LOP', 'PL'].includes(s.type)) {
          return res.status(400).json({ success: false, message: `Invalid type in split: ${s.type}` });
        }
        if (!Number.isInteger(s.days) || s.days < 1) {
          return res.status(400).json({ success: false, message: `Invalid days for ${s.type}: must be >= 1` });
        }
      }

      // Total split days must equal total working days of original request
      const totalWd    = workingDays(leave.fromDate, leave.toDate);
      const splitTotal = splits.reduce((sum, s) => sum + s.days, 0);

      if (splitTotal !== totalWd) {
        return res.status(400).json({
          success: false,
          message: `Split total (${splitTotal} days) must equal working days in request (${totalWd} days).`,
        });
      }

      // Build concrete date ranges for each chunk
      const chunks = buildDateChunks(leave.fromDate, leave.toDate, splits);

      const splitNote  = `Split approved: ${splits.map((s) => `${s.days}d ${s.type}`).join(' + ')}`;
      const fullRemark = [splitNote, adminRemark].filter(Boolean).join(' — ');

      const reviewMeta = {
        status:     'APPROVED',
        reviewedBy: req.user.id,
        reviewedAt: new Date(),
      };

      // Update original row with first chunk
      await prisma.leaveRequest.update({
        where: { id: parseInt(id) },
        data: {
          ...reviewMeta,
          type:        chunks[0].type,
          fromDate:    chunks[0].fromDate,
          toDate:      chunks[0].toDate,
          adminRemark: fullRemark,
        },
      });

      // Create additional rows for remaining chunks
      for (let i = 1; i < chunks.length; i++) {
        await prisma.leaveRequest.create({
          data: {
            userId:      leave.userId,
            type:        chunks[i].type,
            fromDate:    chunks[i].fromDate,
            toDate:      chunks[i].toDate,
            reason:      leave.reason,
            adminRemark: `Split from leave #${id} — part ${i + 1} of ${chunks.length}`,
            ...reviewMeta,
          },
        });
      }

      return res.status(200).json({
        success: true,
        message: `Leave split and approved: ${splits.map((s) => `${s.days}d ${s.type}`).join(' + ')}.`,
      });
    }

    // ── SINGLE TYPE APPROVAL PATH (original behaviour) ─────────────────────
    const finalType   = type || leave.type;
    const typeChanged = finalType !== leave.type;
    const changeNote  = typeChanged ? `Changed from ${leave.type} to ${finalType} by admin.` : null;
    const fullRemark  = [changeNote, adminRemark].filter(Boolean).join(' ') || null;

    const updated = await prisma.leaveRequest.update({
      where: { id: parseInt(id) },
      data: {
        status:      'APPROVED',
        type:        finalType,
        adminRemark: fullRemark,
        reviewedBy:  req.user.id,
        reviewedAt:  new Date(),
      },
      include: {
        user: { select: { name: true, email: true } },
      },
    });

    return res.status(200).json({
      success: true,
      message: `Leave approved for ${updated.user.name}${typeChanged ? ` as ${finalType}` : ''}.`,
      leave: updated,
    });
  } catch (err) {
    next(err);
  }
};

export const rejectLeave = async (req, res, next) => {
  try {
    const { id }          = req.params;
    const { adminRemark } = req.body;

    if (!adminRemark || adminRemark.trim() === '') {
      return res.status(400).json({
        success: false,
        message: 'Rejection reason is required.',
      });
    }

    const leave = await prisma.leaveRequest.findUnique({ where: { id: parseInt(id) } });

    if (!leave) {
      return res.status(404).json({ success: false, message: 'Leave request not found.' });
    }

    if (leave.status !== 'PENDING') {
      return res.status(400).json({
        success: false,
        message: `Leave is already ${leave.status.toLowerCase()}.`,
      });
    }

    const updated = await prisma.leaveRequest.update({
      where: { id: parseInt(id) },
      data: {
        status:      'REJECTED',
        adminRemark: adminRemark.trim(),
        reviewedBy:  req.user.id,
        reviewedAt:  new Date(),
      },
      include: {
        user: { select: { name: true, email: true } },
      },
    });

    return res.status(200).json({
      success: true,
      message: `Leave rejected for ${updated.user.name}.`,
      leave: updated,
    });
  } catch (err) {
    next(err);
  }
};