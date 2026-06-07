// src/controllers/auth.controller.js
import bcrypt from 'bcryptjs';
import jwt    from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const getTodayRange = () => {
  const start = new Date(); start.setHours(0,  0,  0,   0);
  const end   = new Date(); end.setHours(23, 59, 59, 999);
  return { start, end };
};

export const login = async (req, res, next) => {
  try {
    const { email, password, latitude, longitude, location } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email and password are required.',
      });
    }

    const user = await prisma.user.findUnique({ where: { email } });

    if (!user || !user.isActive) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials.',
      });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials.',
      });
    }

    const token = jwt.sign(
      { id: user.id, name: user.name, email: user.email, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
    );

    // ── Auto Clock In for EMPLOYEE with location ──────────
    let clockInTime = null;
    if (user.role === 'EMPLOYEE') {
      const { start, end } = getTodayRange();

      const openSession = await prisma.attendance.findFirst({
        where: {
          userId:   user.id,
          clockIn:  { gte: start, lte: end },
          clockOut: null,
        },
      });

      if (!openSession) {
        const attendance = await prisma.attendance.create({
          data: {
            userId:    user.id,
            clockIn:   new Date(),
            latitude:  latitude  ? parseFloat(latitude)  : null,
            longitude: longitude ? parseFloat(longitude) : null,
            location:  location  || null,
          },
        });
        clockInTime = attendance.clockIn;
      } else {
        if (!openSession.latitude && latitude) {
          await prisma.attendance.update({
            where: { id: openSession.id },
            data: {
              latitude:  parseFloat(latitude),
              longitude: parseFloat(longitude),
              location:  location || null,
            },
          });
        }
        clockInTime = openSession.clockIn;
      }
    }

    return res.status(200).json({
      success:     true,
      message:     'Login successful.',
      token,
      clockInTime,
      user: {
        id:    user.id,
        name:  user.name,
        email: user.email,
        role:  user.role,
      },
    });
  } catch (err) {
    next(err);
  }
};

export const logout = async (req, res, next) => {
  try {
    // ── Detect logout type ────────────────────────────────
    // Explicit logout (button click):
    //   Token arrives via Authorization header → req.user is set by middleware
    //   → perform clock-out
    //
    // sendBeacon logout (tab close OR refresh):
    //   Browser cannot send Authorization header with sendBeacon
    //   → token arrives in req.body.token instead → req.user is NOT set
    //   → skip clock-out (refresh must not end the session)
    //   → clock-out handled by: 2-miss heartbeat or 10-min backend cron
    const isBeacon = !req.user && !!req.body?.token;

    let userId = req.user?.id;
    let role   = req.user?.role;

    // Verify token from body for beacon requests
    if (isBeacon) {
      try {
        const decoded = jwt.verify(req.body.token, process.env.JWT_SECRET);
        userId = decoded.id;
        role   = decoded.role;
      } catch {
        // Expired or invalid token — return 200 so sendBeacon doesn't retry
        return res.status(200).json({ success: false, message: 'Invalid token.' });
      }
    }

    if (!userId) {
      return res.status(200).json({ success: false, message: 'No user identified.' });
    }

    // ── Clock-out only on explicit logout (not beacon) ────
    // Beacon fires on BOTH refresh and tab close — we cannot distinguish
    // them reliably on the frontend (Vercel SPA breaks performance.navigation).
    // So we skip clock-out for all beacon requests.
    // Tab-close sessions end within 10 mins via autoClockOutInactive cron.
    if (role === 'EMPLOYEE' && !isBeacon) {
      const { start, end } = getTodayRange();

      const openSession = await prisma.attendance.findFirst({
        where: {
          userId,
          clockIn:  { gte: start, lte: end },
          clockOut: null,
        },
      });

      if (openSession) {
        const now     = new Date();
        const ms      = now - new Date(openSession.clockIn);
        const hours   = Math.floor(ms / 3600000);
        const minutes = Math.floor((ms % 3600000) / 60000);

        await prisma.attendance.update({
          where: { id: openSession.id },
          data:  { clockOut: now },
        });

        return res.status(200).json({
          success: true,
          message: `Clocked out. Session: ${hours}h ${minutes}m`,
        });
      }
    }

    return res.status(200).json({ success: true, message: 'Logged out.' });
  } catch (err) {
    next(err);
  }
};

export const getMe = async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where:  { id: req.user.id },
      select: { id: true, name: true, email: true, role: true, createdAt: true },
    });

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    return res.status(200).json({ success: true, user });
  } catch (err) {
    next(err);
  }
};
