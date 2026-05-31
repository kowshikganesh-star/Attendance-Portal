// src/routes/report.routes.js
import { Router } from 'express';
import { getMySummary, getAllSummary, exportCSV } from '../controllers/report.controller.js';
import { authenticate, authorize } from '../middleware/auth.middleware.js';

const router = Router();

router.use(authenticate);

router.get('/summary', authorize('EMPLOYEE'),           getMySummary);
router.get('/all',     authorize('ADMIN'),              getAllSummary);
router.get('/export',  authorize('ADMIN', 'EMPLOYEE'),  exportCSV);

export default router;