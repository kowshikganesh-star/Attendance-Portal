// src/controllers/leave.controller.js
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const calcDays = (from, to) => {
  const diff = new Date(to) - new Date(from);
  return Math.ceil(diff / (1000 * 60 * 60 * 24)) + 1;
};

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
    const { id }        = req.params;
    const userRemark    = req.body?.adminRemark?.trim() || null;
    const type          = req.body?.type || null;

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

    const typeChanged = type && type !== leave.type;
    const changeNote   = typeChanged
      ? `Changed from ${leave.type} to ${type} by admin.`
      : null;

    const adminRemark = [changeNote, userRemark].filter(Boolean).join(' ') || null;

    const updated = await prisma.leaveRequest.update({
      where: { id: parseInt(id) },
      data: {
        status:      'APPROVED',
        type:        type || leave.type,
        adminRemark: adminRemark,
        reviewedBy:  req.user.id,
        reviewedAt:  new Date(),
      },
      include: {
        user: { select: { name: true, email: true } },
      },
    });

    return res.status(200).json({
      success: true,
      message: `Leave approved for ${updated.user.name}${type && type !== leave.type ? ` as ${type}` : ''}.`,
      leave:   updated,
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
      leave:   updated,
    });
  } catch (err) {
    next(err);
  }
};
