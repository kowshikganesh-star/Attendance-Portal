// src/routes/user.routes.js
import { Router } from 'express';
import {
  getUsers, createUser, updateUser,
  toggleStatus, resetPassword, deleteUser,
} from '../controllers/user.controller.js';
import {
  bulkUpdateEmployeeIds, bulkCreateUsers,
} from '../controllers/import.controller.js';
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

// ── Bulk imports (admin-only, protected by router.use above) ──
router.post('/import-employee-ids', bulkUpdateEmployeeIds); // update emp id on existing users
router.post('/import-users',        bulkCreateUsers);       // create new users in bulk

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