// src/routes/user.routes.js
import { Router } from 'express';
import {
  getUsers, createUser, updateUser,
  toggleStatus, resetPassword, deleteUser,
} from '../controllers/user.controller.js';
import { authenticate, authorize } from '../middleware/auth.middleware.js';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const router = Router();

router.use(authenticate, authorize('ADMIN'));

router.get('/',                 getUsers);
router.post('/',                createUser);
router.put('/:id',              updateUser);
router.patch('/:id/status',     toggleStatus);
router.patch('/:id/password',   resetPassword);
router.delete('/:id',           deleteUser);

// ── Real stats ────────────────────────────────────────────
router.get('/stats/summary', async (req, res, next) => {
  try {
    const totalEmployees = await prisma.user.count({
      where: { role: 'EMPLOYEE', isActive: true },
    });

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const onLeave = await prisma.leaveRequest.count({
      where: {
        status:   'APPROVED',
        fromDate: { lte: new Date() },
        toDate:   { gte: today },
      },
    });

    return res.status(200).json({ success: true, totalEmployees, onLeave });
  } catch (err) {
    next(err);
  }
});

export default router;