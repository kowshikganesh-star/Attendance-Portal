// src/routes/auth.routes.js
import { Router } from 'express';
import { login, logout, getMe } from '../controllers/auth.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';

const router = Router();

router.post('/login',  login);
router.post('/logout', authenticate, logout);
router.get('/me',      authenticate, getMe);

export default router;