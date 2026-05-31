// src/controllers/attendance.controller.js
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const getTodayRange = () => {
  const start = new Date(); start.setHours(0,  0,  0,   0);
  const end   = new Date(); end.setHours(23, 59, 59, 999);
  return { start, end };
};

export const clockIn = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { latitude, longitude, location } = req.body;
    const { start, end } = getTodayRange();

    const openSession = await prisma.attendance.findFirst({
      where: { userId, clockIn: { gte: start, lte: end }, clockOut: null },
    });

    if (openSession) {
      return res.status(400).json({
        success: false,
        message: 'You are already clocked in. Please clock out first.',
      });
    }

    const attendance = await prisma.attendance.create({
      data: {
        userId,
        clockIn:   new Date(),
        latitude:  latitude  ? parseFloat(latitude)  : null,
        longitude: longitude ? parseFloat(longitude) : null,
        location:  location  || null,
      },
    });

    return res.status(201).json({
      success: true,
      message: 'Clocked in successfully.',
      attendance,
    });
  } catch (err) {
    next(err);
  }
};

export const clockOut = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { start, end } = getTodayRange();

    const openSession = await prisma.attendance.findFirst({
      where: { userId, clockIn: { gte: start, lte: end }, clockOut: null },
    });

    if (!openSession) {
      return res.status(400).json({
        success: false,
        message: 'No active clock-in found.',
      });
    }

    const now        = new Date();
    const attendance = await prisma.attendance.update({
      where: { id: openSession.id },
      data:  { clockOut: now },
    });

    const ms      = now - new Date(openSession.clockIn);
    const hours   = Math.floor(ms / 3600000);
    const minutes = Math.floor((ms % 3600000) / 60000);

    return res.status(200).json({
      success: true,
      message: `Clocked out successfully. Duration: ${hours}h ${minutes}m`,
      attendance,
    });
  } catch (err) {
    next(err);
  }
};

export const getTodayStatus = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { start, end } = getTodayRange();

    const sessions = await prisma.attendance.findMany({
      where:   { userId, clockIn: { gte: start, lte: end } },
      orderBy: { clockIn: 'asc' },
    });

    const activeSession = sessions.find((s) => s.clockOut === null) || null;
    const totalMs = sessions
      .filter((s) => s.clockOut !== null)
      .reduce((acc, s) => acc + (new Date(s.clockOut) - new Date(s.clockIn)), 0);

    return res.status(200).json({
      success:      true,
      isClockedIn:  !!activeSession,
      activeSession,
      sessions,
      totalWorked: {
        hours:   Math.floor(totalMs / 3600000),
        minutes: Math.floor((totalMs % 3600000) / 60000),
      },
    });
  } catch (err) {
    next(err);
  }
};

export const getActiveEmployees = async (req, res, next) => {
  try {
    const { start, end } = getTodayRange();

    const active = await prisma.attendance.findMany({
      where: { clockIn: { gte: start, lte: end }, clockOut: null },
      include: {
        user: { select: { id: true, name: true, email: true, role: true } },
      },
      orderBy: { clockIn: 'asc' },
    });

    return res.status(200).json({
      success: true,
      count:   active.length,
      active:  active.map((r) => ({
        ...r,
        latitude:  r.latitude,
        longitude: r.longitude,
        location:  r.location,
      })),
    });
  } catch (err) {
    next(err);
  }
};

export const heartbeat = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { start, end } = getTodayRange();

    const openSession = await prisma.attendance.findFirst({
      where: { userId, clockIn: { gte: start, lte: end }, clockOut: null },
    });

    if (!openSession) {
      return res.status(404).json({
        success: false,
        message: 'No active session found.',
      });
    }

    await prisma.attendance.update({
      where: { id: openSession.id },
      data:  { updatedAt: new Date() },
    });

    return res.status(200).json({ success: true, message: 'Heartbeat received.' });
  } catch (err) {
    next(err);
  }
};

export const autoClockOutInactive = async () => {
  try {
    const { start, end } = getTodayRange();
    const tenMinsAgo = new Date(Date.now() - 10 * 60 * 1000);

    const staleSessions = await prisma.attendance.findMany({
      where: {
        clockIn:   { gte: start, lte: end },
        clockOut:  null,
        updatedAt: { lt: tenMinsAgo },
      },
      include: {
        user: { select: { name: true, email: true } },
      },
    });

    if (staleSessions.length === 0) return;

    for (const session of staleSessions) {
      await prisma.attendance.update({
        where: { id: session.id },
        data:  { clockOut: session.updatedAt },
      });
      console.log(`⏱️  Auto clocked out: ${session.user.name}`);
    }
    console.log(`✅ Auto clock-out: ${staleSessions.length} session(s) closed`);
  } catch (err) {
    console.error('❌ Auto clock-out error:', err.message);
  }
};

export const getMyHistory = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { month, startDate, endDate } = req.query;
    let start, end;

    if (month) {
      const [year, mon] = month.split('-').map(Number);
      start = new Date(year, mon - 1, 1,  0,  0,  0);
      end   = new Date(year, mon,     0, 23, 59, 59);
    } else if (startDate && endDate) {
      start = new Date(startDate + 'T00:00:00');
      end   = new Date(endDate   + 'T23:59:59');
    } else {
      const now = new Date();
      start = new Date(now.getFullYear(), now.getMonth(),     1,  0,  0,  0);
      end   = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
    }

    const records = await prisma.attendance.findMany({
      where:   { userId, clockIn: { gte: start, lte: end } },
      orderBy: { clockIn: 'desc' },
    });

    const grouped = {};
    for (const r of records) {
      const dateKey = new Date(r.clockIn).toLocaleDateString('en-CA');
      if (!grouped[dateKey]) grouped[dateKey] = [];
      grouped[dateKey].push(r);
    }

    const history = Object.entries(grouped).map(([date, sessions]) => {
      const totalMs    = sessions
        .filter((s) => s.clockOut)
        .reduce((acc, s) => acc + (new Date(s.clockOut) - new Date(s.clockIn)), 0);
      const firstIn    = sessions[sessions.length - 1].clockIn;
      const lastOut    = sessions[0].clockOut;
      const isComplete = sessions.every((s) => s.clockOut !== null);
      return {
        date,
        firstClockIn:  firstIn,
        lastClockOut:  lastOut,
        totalSessions: sessions.length,
        totalWorked: {
          hours:   Math.floor(totalMs / 3600000),
          minutes: Math.floor((totalMs % 3600000) / 60000),
          totalMs,
        },
        isComplete,
        sessions,
      };
    });

    return res.status(200).json({ success: true, history });
  } catch (err) {
    next(err);
  }
};

export const getAllHistory = async (req, res, next) => {
  try {
    const { month, startDate, endDate, userId } = req.query;
    let start, end;

    if (month) {
      const [year, mon] = month.split('-').map(Number);
      start = new Date(year, mon - 1, 1,  0,  0,  0);
      end   = new Date(year, mon,     0, 23, 59, 59);
    } else if (startDate && endDate) {
      start = new Date(startDate + 'T00:00:00');
      end   = new Date(endDate   + 'T23:59:59');
    } else {
      const now = new Date();
      start = new Date(now.getFullYear(), now.getMonth(),     1,  0,  0,  0);
      end   = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
    }

    const where = {
      clockIn: { gte: start, lte: end },
      ...(userId ? { userId: parseInt(userId) } : {}),
    };

    const records = await prisma.attendance.findMany({
      where,
      include: {
        user: { select: { id: true, name: true, email: true, role: true } },
      },
      orderBy: { clockIn: 'desc' },
    });

    const employees = await prisma.user.findMany({
      where:   { role: 'EMPLOYEE', isActive: true },
      select:  { id: true, name: true, email: true },
      orderBy: { name: 'asc' },
    });

    return res.status(200).json({ success: true, records, employees });
  } catch (err) {
    next(err);
  }
};