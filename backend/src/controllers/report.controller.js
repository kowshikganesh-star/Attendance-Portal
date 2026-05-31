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

  const clockIns  = records.map((r) => new Date(r.clockIn));
  const clockOuts = records.filter((r) => r.clockOut).map((r) => new Date(r.clockOut));

  const earliestIn = clockIns.length  ? new Date(Math.min(...clockIns))  : null;
  const latestOut  = clockOuts.length ? new Date(Math.max(...clockOuts)) : null;

  const incompleteDays = dates.filter((d) =>
    byDate[d].some((r) => !r.clockOut)
  ).length;

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
    earliestClockIn:  earliestIn  ? earliestIn.toLocaleTimeString('en-US',  { hour: '2-digit', minute: '2-digit', hour12: true }) : '—',
    latestClockOut:   latestOut   ? latestOut.toLocaleTimeString('en-US',   { hour: '2-digit', minute: '2-digit', hour12: true }) : '—',
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
      const ms = sessions.filter((s) => s.clockOut)
        .reduce((acc, s) => acc + (new Date(s.clockOut) - new Date(s.clockIn)), 0);
      return {
        date,
        sessions:    sessions.length,
        hoursWorked: Math.floor(ms / 3600000),
        minutes:     Math.floor((ms % 3600000) / 60000),
        isComplete:  sessions.every((s) => s.clockOut),
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