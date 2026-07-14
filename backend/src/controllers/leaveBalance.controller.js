// src/controllers/leaveBalance.controller.js
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Only these types have a balance. LOP and HD_LOP are loss-of-pay (unpaid,
// unlimited), so they are never tracked here.
export const BALANCE_TYPES = ['SL', 'CL', 'PL'];

// ── Working days between two dates, inclusive, skipping Sat/Sun ──────────
// Fri -> Mon = 2 working days (Fri, Mon). Used for every balance deduction.
export const workingDays = (from, to) => {
  const start = new Date(from); start.setHours(0, 0, 0, 0);
  const end   = new Date(to);   end.setHours(0, 0, 0, 0);
  if (end < start) return 0;

  let count = 0;
  const cur = new Date(start);
  while (cur <= end) {
    const day = cur.getDay();        // 0 = Sun, 6 = Sat
    if (day !== 0 && day !== 6) count++;
    cur.setDate(cur.getDate() + 1);
  }
  return count;
};

// A leave belongs to the year it STARTS in (agreed rule).
const leaveYear   = (leave) => new Date(leave.fromDate).getFullYear();
const currentYear = () => new Date().getFullYear();

// ── Core: build the balance picture for a set of users, for one year ──────
// remaining = allowed - used, where "used" is summed from APPROVED leaves.
// Nothing is stored: used/remaining are always derived, so they can't drift.
const buildBalances = async (userIds, year) => {
  const allowances = await prisma.leaveAllowance.findMany({
    where: { userId: { in: userIds }, year },
    select: { userId: true, type: true, allowed: true },
  });

  const leaves = await prisma.leaveRequest.findMany({
    where: {
      userId: { in: userIds },
      status: 'APPROVED',
      type:   { in: BALANCE_TYPES },
    },
    select: { userId: true, type: true, fromDate: true, toDate: true },
  });

  const allowedMap = {};
  allowances.forEach((a) => {
    if (!allowedMap[a.userId]) allowedMap[a.userId] = {};
    allowedMap[a.userId][a.type] = a.allowed;
  });

  const usedMap = {};
  leaves.forEach((l) => {
    if (leaveYear(l) !== year) return;
    if (!usedMap[l.userId]) usedMap[l.userId] = {};
    const days = workingDays(l.fromDate, l.toDate);
    usedMap[l.userId][l.type] = (usedMap[l.userId][l.type] || 0) + days;
  });

  const result = {};
  userIds.forEach((uid) => {
    result[uid] = {};
    BALANCE_TYPES.forEach((type) => {
      const allowed = allowedMap[uid]?.[type] ?? null;   // null = not set by admin yet
      const used    = usedMap[uid]?.[type] ?? 0;
      result[uid][type] = {
        allowed,
        used,
        remaining: allowed === null ? null : allowed - used,
      };
    });
  });

  return result;
};

// ══════════════════════════════════════════════════════════════════
//  GET /api/leave-balances            (ADMIN)  — everyone's balances
// ══════════════════════════════════════════════════════════════════
export const getAllBalances = async (req, res, next) => {
  try {
    const year = parseInt(req.query.year) || currentYear();

    const employees = await prisma.user.findMany({
      where:   { role: 'EMPLOYEE' },
      select:  { id: true, name: true, email: true, employeeId: true, isActive: true },
      orderBy: { name: 'asc' },
    });

    const ids      = employees.map((e) => e.id);
    const balances = ids.length ? await buildBalances(ids, year) : {};

    const rows = employees.map((emp) => ({
      ...emp,
      balances: balances[emp.id] || {},
    }));

    return res.status(200).json({ success: true, year, types: BALANCE_TYPES, rows });
  } catch (err) {
    next(err);
  }
};

// ══════════════════════════════════════════════════════════════════
//  GET /api/leave-balances/my         (EMPLOYEE) — my own balance
// ══════════════════════════════════════════════════════════════════
export const getMyBalance = async (req, res, next) => {
  try {
    const year   = parseInt(req.query.year) || currentYear();
    const userId = req.user.id;

    const balances = await buildBalances([userId], year);

    return res.status(200).json({
      success: true,
      year,
      types: BALANCE_TYPES,
      balances: balances[userId] || {},
    });
  } catch (err) {
    next(err);
  }
};

// ══════════════════════════════════════════════════════════════════
//  GET /api/leave-balances/user/:id   (ADMIN) — one employee's balance
// ══════════════════════════════════════════════════════════════════
export const getUserBalance = async (req, res, next) => {
  try {
    const year   = parseInt(req.query.year) || currentYear();
    const userId = parseInt(req.params.id);

    const user = await prisma.user.findUnique({
      where:  { id: userId },
      select: { id: true, name: true, email: true },
    });
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    const balances = await buildBalances([userId], year);

    return res.status(200).json({
      success: true,
      year,
      types: BALANCE_TYPES,
      user,
      balances: balances[userId] || {},
    });
  } catch (err) {
    next(err);
  }
};

// ══════════════════════════════════════════════════════════════════
//  PUT /api/leave-balances/user/:id   (ADMIN) — set one user's allowances
//  Body: { year?: 2026, allowances: { SL: 12, CL: 12, PL: 0 } }
// ══════════════════════════════════════════════════════════════════
export const setUserAllowances = async (req, res, next) => {
  try {
    const userId = parseInt(req.params.id);
    const year   = parseInt(req.body?.year) || currentYear();
    const input  = req.body?.allowances || {};

    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    for (const type of BALANCE_TYPES) {
      if (!(type in input)) continue;

      const raw = input[type];

      if (raw === null || raw === '' || raw === undefined) {
        await prisma.leaveAllowance.deleteMany({ where: { userId, year, type } });
        continue;
      }

      const allowed = parseInt(raw);
      if (isNaN(allowed) || allowed < 0) {
        return res.status(400).json({
          success: false,
          message: `${type} allowance must be a number of 0 or more.`,
        });
      }

      await prisma.leaveAllowance.upsert({
        where:  { userId_year_type: { userId, year, type } },
        update: { allowed },
        create: { userId, year, type, allowed },
      });
    }

    const balances = await buildBalances([userId], year);

    return res.status(200).json({
      success: true,
      message: 'Leave allowances updated.',
      year,
      balances: balances[userId] || {},
    });
  } catch (err) {
    next(err);
  }
};

// ══════════════════════════════════════════════════════════════════
//  POST /api/leave-balances/bulk      (ADMIN) — SAME allowance for many
//  Body: { year?, allowances: { SL, CL, PL }, userIds?: [] }
// ══════════════════════════════════════════════════════════════════
export const bulkSetAllowances = async (req, res, next) => {
  try {
    const year  = parseInt(req.body?.year) || currentYear();
    const input = req.body?.allowances || {};

    const typesGiven = BALANCE_TYPES.filter((t) => t in input);
    if (typesGiven.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Provide at least one allowance (SL, CL, or PL).',
      });
    }

    const values = {};
    for (const type of typesGiven) {
      const allowed = parseInt(input[type]);
      if (isNaN(allowed) || allowed < 0) {
        return res.status(400).json({
          success: false,
          message: `${type} allowance must be a number of 0 or more.`,
        });
      }
      values[type] = allowed;
    }

    let userIds = Array.isArray(req.body?.userIds) && req.body.userIds.length
      ? req.body.userIds.map((n) => parseInt(n)).filter((n) => !isNaN(n))
      : null;

    if (!userIds) {
      const employees = await prisma.user.findMany({
        where:  { role: 'EMPLOYEE', isActive: true },
        select: { id: true },
      });
      userIds = employees.map((e) => e.id);
    }

    if (userIds.length === 0) {
      return res.status(400).json({ success: false, message: 'No employees to update.' });
    }

    let updated = 0;
    for (const userId of userIds) {
      for (const type of typesGiven) {
        await prisma.leaveAllowance.upsert({
          where:  { userId_year_type: { userId, year, type } },
          update: { allowed: values[type] },
          create: { userId, year, type, allowed: values[type] },
        });
      }
      updated++;
    }

    return res.status(200).json({
      success: true,
      message: `Allowances set for ${updated} employee(s) for ${year}.`,
      year,
      updated,
    });
  } catch (err) {
    next(err);
  }
};

// ══════════════════════════════════════════════════════════════════
//  POST /api/leave-balances/import    (ADMIN) — PER-EMPLOYEE allowances
//  from an uploaded spreadsheet. The frontend reads the file (columns:
//  email, SL, CL, PL) and posts:
//     { year?: 2026, rows: [{ email, SL, CL, PL }, ...] }
//
//  Each type is optional per row — a blank cell leaves that type untouched.
//  Matched by email. Never trusts the client: re-checks every email.
//
//  Summary: { updated: [{email, set:{...}}], notFound: [{email}], failed: [{email, reason}] }
// ══════════════════════════════════════════════════════════════════
export const importAllowances = async (req, res, next) => {
  try {
    const year   = parseInt(req.body?.year) || currentYear();
    const { rows } = req.body;

    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No rows received. Please upload a valid file.',
      });
    }
    if (rows.length > 5000) {
      return res.status(400).json({
        success: false,
        message: 'Too many rows (max 5000 per import). Split the file and try again.',
      });
    }

    const updated  = [];
    const notFound = [];
    const failed   = [];

    for (const raw of rows) {
      const email = String(raw?.email ?? '').trim().toLowerCase();
      if (!email) {
        failed.push({ email: '(blank)', reason: 'Missing email' });
        continue;
      }

      // Which types does this row actually specify? Blank = skip that type.
      const given = {};
      let bad = null;

      for (const type of BALANCE_TYPES) {
        const cell = raw?.[type];
        if (cell === undefined || cell === null || String(cell).trim() === '') continue;

        const allowed = parseInt(String(cell).trim());
        if (isNaN(allowed) || allowed < 0) {
          bad = `${type} must be a number of 0 or more (got "${cell}")`;
          break;
        }
        given[type] = allowed;
      }

      if (bad) { failed.push({ email, reason: bad }); continue; }

      if (Object.keys(given).length === 0) {
        failed.push({ email, reason: 'No SL / CL / PL values in this row' });
        continue;
      }

      const user = await prisma.user.findFirst({
        where:  { email: { equals: email, mode: 'insensitive' } },
        select: { id: true },
      });
      if (!user) { notFound.push({ email }); continue; }

      for (const [type, allowed] of Object.entries(given)) {
        await prisma.leaveAllowance.upsert({
          where:  { userId_year_type: { userId: user.id, year, type } },
          update: { allowed },
          create: { userId: user.id, year, type, allowed },
        });
      }

      updated.push({ email, set: given });
    }

    return res.status(200).json({
      success: true,
      message: `Import complete for ${year}: ${updated.length} updated, ${notFound.length} not found, ${failed.length} failed.`,
      year,
      summary: { updated, notFound, failed },
    });
  } catch (err) {
    next(err);
  }
};