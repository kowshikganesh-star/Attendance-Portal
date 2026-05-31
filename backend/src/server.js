// src/server.js
import express          from 'express';
import cors             from 'cors';
import dotenv           from 'dotenv';
import authRoutes       from './routes/auth.routes.js';
import attendanceRoutes from './routes/attendance.routes.js';
import userRoutes       from './routes/user.routes.js';
import reportRoutes     from './routes/report.routes.js';
import leaveRoutes      from './routes/leave.routes.js';
import { autoClockOutInactive } from './controllers/attendance.controller.js';

dotenv.config();

const app  = express();
const PORT = process.env.PORT || 5000;

app.use(cors({ origin: process.env.CLIENT_URL || 'http://localhost:5173' }));
app.use(express.json());

// ── Routes ────────────────────────────────────────────────
app.use('/api/auth',       authRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/users',      userRoutes);
app.use('/api/reports',    reportRoutes);
app.use('/api/leaves',     leaveRoutes);

// ── Health check ──────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ── Auto clock-out cron — runs every 10 minutes ───────────
setInterval(async () => {
  await autoClockOutInactive();
}, 10 * 60 * 1000);

// ── Global error handler ──────────────────────────────────
app.use((err, req, res, next) => {
  console.error(`[ERROR] ${err.message}`);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Internal server error',
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`⏱️  Auto clock-out check runs every 10 minutes`);
});