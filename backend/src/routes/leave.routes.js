// src/routes/leave.routes.js
import { Router } from 'express';
import {
  applyLeave, getMyLeaves, getAllLeaves,
  approveLeave, rejectLeave,
} from '../controllers/leave.controller.js';
import { authenticate, authorize } from '../middleware/auth.middleware.js';

const router = Router();

router.use(authenticate);

// Employee
router.post('/',              authorize('EMPLOYEE'), applyLeave);
router.get('/my',             authorize('EMPLOYEE'), getMyLeaves);

// Admin only
router.get('/',               authorize('ADMIN'),    getAllLeaves);
router.patch('/:id/approve',  authorize('ADMIN'),    approveLeave);
router.patch('/:id/reject',   authorize('ADMIN'),    rejectLeave);

export default router;