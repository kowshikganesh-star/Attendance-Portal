// src/controllers/report.controller.js
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const getMonthRange = (month) => {
  if (month) {
    const [year, mon] = month.split('-').map(Number);
    return {
      start: new Date(year, mon - 1, 1, 0, 0, 0),
      end:   new Date(year, mon,     0, 23, 59, 59),
    };
  }
  const now = new Date();
  return {
    start: new Date(now.getFullYear(), now.getMonth(),     1,  0,  0,  0),
    end:   new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59),
  };
};

const buildSummary = (user, records) => {
  const byDate = {};
  for (const r of records) {
    const key = new Date(r.clockIn).toLocaleDateString('en-CA');
    if (!byDate[key]) byDate[key] = [];
    byDate[key].push(r);
  }

  const dates       = Object.keys(byDate);
  const daysPresent = dates.length;

  const totalMs = records
    .filter((r) => r.clockOut)
    .reduce((acc, r) => acc + (new Date(r.clockOut) - new Date(r.clockIn)), 0);

  const totalHours   = Math.floor(totalMs / 3600000);
  const totalMinutes = Math.floor((totalMs % 3600000) / 60000);
  const avgMsPerDay  = daysPresent > 0 ? totalMs / daysPresent : 0;
  const avgHours     = Math.floor(avgMsPerDay / 3600000);
  const avgMinutes   = Math.floor((avgMsPerDay % 3600000) / 60000);

  const incompleteDays = dates.filter((d) =>
    byDate[d].some((r) => !r.clockOut)
  ).length;

  // --- Session Behaviour ---

  // 1. Avg session length in minutes (only completed sessions)
  const completedSessions = records.filter((r) => r.clockOut);
  const avgSessionMins = completedSessions.length
    ? Math.round(
        completedSessions.reduce(
          (acc, r) => acc + (new Date(r.clockOut) - new Date(r.clockIn)),
          0
        ) / completedSessions.length / 60000
      )
    : 0;

  // 2. Avg sessions per day
  const avgSessionsPerDay = daysPresent > 0
    ? parseFloat((records.length / daysPresent).toFixed(1))
    : 0;

  // 3. Avg first clock-in time across all days
  const firstClockIns = dates.map((d) => {
    const sorted = [...byDate[d]].sort(
      (a, b) => new Date(a.clockIn) - new Date(b.clockIn)
    );
    return new Date(sorted[0].clockIn);
  });

  let avgFirstClockIn = '—';
  if (firstClockIns.length) {
    // Average the time-of-day portion only (ms since midnight)
    const avgMs =
      firstClockIns.reduce((acc, d) => {
        const msSinceMidnight =
          d.getHours() * 3600000 +
          d.getMinutes() * 60000 +
          d.getSeconds() * 1000;
        return acc + msSinceMidnight;
      }, 0) / firstClockIns.length;

    const h = Math.floor(avgMs / 3600000);
    const m = Math.floor((avgMs % 3600000) / 60000);
    const period = h >= 12 ? 'PM' : 'AM';
    const hour12 = h % 12 === 0 ? 12 : h % 12;
    avgFirstClockIn = `${String(hour12).padStart(2, '0')}:${String(m).padStart(2, '0')} ${period}`;
  }

  return {
    userId:        user.id,
    name:          user.name,
    email:         user.email,
    role:          user.role,
    daysPresent,
    incompleteDays,
    totalSessions: records.length,
    totalWorked:   { hours: totalHours,  minutes: totalMinutes  },
    avgPerDay:     { hours: avgHours,    minutes: avgMinutes    },
    avgSessionMins,
    avgSessionsPerDay,
    avgFirstClockIn,
    totalMs,
  };
};

export const getMySummary = async (req, res, next) => {
  try {
    const userId         = req.user.id;
    const { month }      = req.query;
    const { start, end } = getMonthRange(month);

    const user = await prisma.user.findUnique({
      where:  { id: userId },
      select: { id: true, name: true, email: true, role: true },
    });

    const records = await prisma.attendance.findMany({
      where:   { userId, clockIn: { gte: start, lte: end } },
      orderBy: { clockIn: 'asc' },
    });

    const byDate = {};
    for (const r of records) {
      const key = new Date(r.clockIn).toLocaleDateString('en-CA');
      if (!byDate[key]) byDate[key] = [];
      byDate[key].push(r);
    }

    const dailyBreakdown = Object.entries(byDate).map(([date, sessions]) => {
      const ms           = sessions.filter((s) => s.clockOut)
        .reduce((acc, s) => acc + (new Date(s.clockOut) - new Date(s.clockIn)), 0);
      const sortedByTime = [...sessions].sort(
        (a, b) => new Date(a.clockIn) - new Date(b.clockIn)
      );
      const firstLocation = sortedByTime.find((s) => s.location)?.location || null;

      return {
        date,
        sessions:    sessions.length,
        hoursWorked: Math.floor(ms / 3600000),
        minutes:     Math.floor((ms % 3600000) / 60000),
        seconds:     Math.floor((ms % 60000) / 1000),
        totalMs:     ms,
        isComplete:  sessions.every((s) => s.clockOut),
        location:    firstLocation,
      };
    }).sort((a, b) => new Date(b.date) - new Date(a.date));

    return res.status(200).json({
      success:        true,
      month:          month || `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`,
      summary:        buildSummary(user, records),
      dailyBreakdown,
    });
  } catch (err) {
    next(err);
  }
};

export const getAllSummary = async (req, res, next) => {
  try {
    const { month }      = req.query;
    const { start, end } = getMonthRange(month);

    const employees = await prisma.user.findMany({
      where:   { isActive: true },
      select:  { id: true, name: true, email: true, role: true },
      orderBy: { name: 'asc' },
    });

    const summaries = await Promise.all(
      employees.map(async (emp) => {
        const records = await prisma.attendance.findMany({
          where:   { userId: emp.id, clockIn: { gte: start, lte: end } },
          orderBy: { clockIn: 'asc' },
        });
        return buildSummary(emp, records);
      })
    );

    return res.status(200).json({
      success:   true,
      month:     month || `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`,
      summaries,
    });
  } catch (err) {
    next(err);
  }
};

export const exportCSV = async (req, res, next) => {
  try {
    const { month }      = req.query;
    const { start, end } = getMonthRange(month);
    const isEmployee     = req.user.role === 'EMPLOYEE';

    const where = {
      clockIn: { gte: start, lte: end },
      ...(isEmployee ? { userId: req.user.id } : {}),
    };

    const records = await prisma.attendance.findMany({
      where,
      include: { user: { select: { name: true, email: true, role: true } } },
      orderBy: { clockIn: 'asc' },
    });

    const headers = ['Employee', 'Email', 'Role', 'Date', 'Clock In', 'Clock Out', 'Duration (mins)', 'Status'];

    const rows = records.map((r) => {
      const duration = r.clockOut
        ? Math.round((new Date(r.clockOut) - new Date(r.clockIn)) / 60000)
        : '';
      const fmt = (d) => d
        ? new Date(d).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })
        : '';
      const date = new Date(r.clockIn).toLocaleDateString('en-CA');

      return [
        r.user.name, r.user.email, r.user.role,
        date, fmt(r.clockIn), fmt(r.clockOut),
        duration,
        r.clockOut ? 'Complete' : 'Active',
      ].join(',');
    });

    const csv      = [headers.join(','), ...rows].join('\n');
    const fileName = `attendance_${month || 'current'}.csv`;

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    return res.status(200).send(csv);
  } catch (err) {
    next(err);
  }
};
