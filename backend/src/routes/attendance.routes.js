// src/routes/attendance.routes.js
import { Router } from 'express';
import {
  clockIn, clockOut, getTodayStatus,
  getActiveEmployees, getMyHistory,
  getAllHistory, heartbeat,
} from '../controllers/attendance.controller.js';
import { authenticate, authorize } from '../middleware/auth.middleware.js';

const router = Router();

router.use(authenticate);

// Employee routes
router.post('/clock-in',    authorize('EMPLOYEE'), clockIn);
router.post('/clock-out',   authorize('EMPLOYEE'), clockOut);
router.get('/today',        authorize('EMPLOYEE'), getTodayStatus);
router.get('/history',      authorize('EMPLOYEE'), getMyHistory);
router.post('/heartbeat',   authorize('EMPLOYEE'), heartbeat);

// Admin only
router.get('/active',       authorize('ADMIN'),    getActiveEmployees);
router.get('/history/all',  authorize('ADMIN'),    getAllHistory);

export default router;