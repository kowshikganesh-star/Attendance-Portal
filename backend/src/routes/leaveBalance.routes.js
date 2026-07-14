// src/routes/leaveBalance.routes.js
import { Router } from 'express';
import {
  getAllBalances, getMyBalance, getUserBalance,
  setUserAllowances, bulkSetAllowances, importAllowances,
} from '../controllers/leaveBalance.controller.js';
import { authenticate, authorize } from '../middleware/auth.middleware.js';

const router = Router();

router.use(authenticate);

// ── Employee: my own balance ──
router.get('/my', authorize('EMPLOYEE'), getMyBalance);

// ── Admin ──
router.get('/',         authorize('ADMIN'), getAllBalances);      // everyone's balances
router.get('/user/:id', authorize('ADMIN'), getUserBalance);      // one employee (approve modal)
router.put('/user/:id', authorize('ADMIN'), setUserAllowances);   // set one employee's allowances
router.post('/bulk',    authorize('ADMIN'), bulkSetAllowances);   // same allowance for everyone
router.post('/import',  authorize('ADMIN'), importAllowances);    // per-employee, from a file

export default router;