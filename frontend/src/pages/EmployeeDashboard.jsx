// src/pages/EmployeeDashboard.jsx
import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import toast, { Toaster } from 'react-hot-toast';
import {
  Clock, LogOut, Timer, Calendar,
  Coffee, History, BarChart2, FileText,
} from 'lucide-react';

const API = import.meta.env.VITE_API_URL;

const EmployeeDashboard = () => {
  const { user, logout } = useAuth();
  const navigate         = useNavigate();

  const [status,      setStatus]      = useState(null);
  const [loading,     setLoading]     = useState(true);
  const [elapsed,     setElapsed]     = useState(0);
  const [currentTime, setCurrentTime] = useState(new Date());

  // ── Live clock ────────────────────────────────────────────
  useEffect(() => {
    const t = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // ── Live elapsed timer ────────────────────────────────────
  useEffect(() => {
    if (!status?.isClockedIn || !status?.activeSession) return;
    const start = new Date(status.activeSession.clockIn);
    const t = setInterval(() => {
      setElapsed(Math.floor((new Date() - start) / 1000));
    }, 1000);
    return () => clearInterval(t);
  }, [status]);

  // ── Fetch today status ────────────────────────────────────
  const fetchStatus = useCallback(async () => {
    try {
      const { data } = await axios.get(`${API}/attendance/today`);
      setStatus(data);
    } catch {
      toast.error('Failed to load attendance status.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchStatus(); }, [fetchStatus]);

  // ── Refresh status when tab becomes visible ───────────────
  useEffect(() => {
    const handleVisible = () => {
      if (document.visibilityState === 'visible') fetchStatus();
    };
    document.addEventListener('visibilitychange', handleVisible);
    return () => document.removeEventListener('visibilitychange', handleVisible);
  }, [fetchStatus]);

  // ── Handle logout ─────────────────────────────────────────
  const handleLogout = async () => {
    toast.loading('Clocking out...', { id: 'logout' });
    await logout();
    toast.dismiss('logout');
    navigate('/login');
  };

  const formatElapsed = (secs) => {
    const h = String(Math.floor(secs / 3600)).padStart(2, '0');
    const m = String(Math.floor((secs % 3600) / 60)).padStart(2, '0');
    const s = String(secs % 60).padStart(2, '0');
    return `${h}:${m}:${s}`;
  };

  const formatTime = (date) =>
    new Date(date).toLocaleTimeString('en-US', {
      hour: '2-digit', minute: '2-digit', hour12: true,
    });

  const todayLabel = currentTime.toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="w-10 h-10 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <Toaster position="top-right" />

      {/* Navbar */}
      <nav className="border-b border-slate-800 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-emerald-600 rounded-lg flex items-center justify-center">
            <Clock className="w-5 h-5 text-white" />
          </div>
          <span className="font-bold text-lg">AttendTrack</span>
          <span className="text-xs bg-emerald-600/20 text-emerald-400 border border-emerald-600/30 px-2 py-0.5 rounded-full font-medium">
            EMPLOYEE
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-slate-400 text-sm">{user?.name}</span>
          <button onClick={() => navigate('/employee/history')}
            className="flex items-center gap-2 text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 px-3 py-1.5 rounded-lg text-sm transition-all">
            <History className="w-4 h-4" /> History
          </button>
          <button onClick={() => navigate('/employee/report')}
            className="flex items-center gap-2 text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 px-3 py-1.5 rounded-lg text-sm transition-all">
            <BarChart2 className="w-4 h-4" /> Report
          </button>
          <button onClick={() => navigate('/employee/leaves')}
            className="flex items-center gap-2 text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 px-3 py-1.5 rounded-lg text-sm transition-all">
            <FileText className="w-4 h-4" /> Leaves
          </button>
          <button onClick={handleLogout}
            className="flex items-center gap-2 text-white bg-red-600 hover:bg-red-500 px-3 py-1.5 rounded-lg text-sm font-medium transition-all">
            <LogOut className="w-4 h-4" /> Logout & Clock Out
          </button>
        </div>
      </nav>

      <main className="p-6 max-w-4xl mx-auto">

        {/* Date + Clock */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold">My Attendance</h1>
            <div className="flex items-center gap-2 text-slate-400 mt-1">
              <Calendar className="w-4 h-4" />
              <span className="text-sm">{todayLabel}</span>
            </div>
          </div>
          <div className="text-right">
            <p className="text-3xl font-mono font-bold text-white">
              {currentTime.toLocaleTimeString('en-US', {
                hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true,
              })}
            </p>
            <p className="text-slate-500 text-xs mt-1">Current Time</p>
          </div>
        </div>

        {/* Status Card */}
        <div className={`rounded-2xl border p-8 mb-6 text-center transition-all duration-500
          ${status?.isClockedIn
            ? 'bg-emerald-950/30 border-emerald-700/50'
            : 'bg-slate-900 border-slate-800'}`}
        >
          <div className={`inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-sm font-medium mb-4
            ${status?.isClockedIn
              ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
              : 'bg-slate-700/50 text-slate-400 border border-slate-600'}`}
          >
            <span className={`w-2 h-2 rounded-full
              ${status?.isClockedIn ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'}`} />
            {status?.isClockedIn ? 'Auto Clocked In on Login' : 'Not Clocked In'}
          </div>

          {status?.isClockedIn && status?.activeSession && (
            <div className="mb-4">
              <div className="flex items-center justify-center gap-2 text-emerald-400 mb-2">
                <Timer className="w-5 h-5" />
                <span className="text-sm">Session Duration</span>
              </div>
              <p className="text-5xl font-mono font-bold text-emerald-400">
                {formatElapsed(elapsed)}
              </p>
              <p className="text-slate-500 text-xs mt-2">
                Session started at {formatTime(status.activeSession.clockIn)}
              </p>
            </div>
          )}

          {!status?.isClockedIn && (
            <div className="mb-4">
              <p className="text-slate-400 text-sm mb-1">Attendance paused temporarily.</p>
              <p className="text-slate-500 text-xs">⚡ Will resume automatically when screen is active.</p>
            </div>
          )}

          <div className="mt-4 px-4 py-3 bg-slate-800/60 rounded-xl text-sm text-slate-400">
            ⚡ Your attendance is tracked automatically.
            Clock-out happens when you <span className="text-white font-medium">Logout</span>.
          </div>

          {status?.totalWorked && (
            <p className="text-slate-400 text-sm mt-4">
              Total worked today (completed):&nbsp;
              <span className="text-white font-semibold">
                {status.totalWorked.hours}h {status.totalWorked.minutes}m
              </span>
            </p>
          )}
        </div>

        {/* Today's Sessions */}
        {status?.sessions?.length > 0 && (
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
            <div className="flex items-center gap-2 mb-4">
              <Coffee className="w-5 h-5 text-slate-400" />
              <h2 className="font-semibold text-white">Today's Sessions</h2>
              <span className="text-xs bg-slate-700 text-slate-300 px-2 py-0.5 rounded-full">
                {status.sessions.length} session{status.sessions.length > 1 ? 's' : ''}
              </span>
            </div>
            <div className="space-y-3">
              {status.sessions.map((session, i) => {
                const duration = session.clockOut
                  ? Math.floor((new Date(session.clockOut) - new Date(session.clockIn)) / 60000)
                  : null;
                return (
                  <div key={session.id}
                    className="flex items-center justify-between p-3 bg-slate-800 rounded-xl">
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-slate-500 w-6">#{i + 1}</span>
                      <div>
                        <p className="text-sm text-white font-medium">
                          🟢 {formatTime(session.clockIn)}
                          {session.clockOut && ` → 🔴 ${formatTime(session.clockOut)}`}
                        </p>
                        {duration !== null && (
                          <p className="text-xs text-slate-400">
                            {Math.floor(duration / 60)}h {duration % 60}m
                          </p>
                        )}
                      </div>
                    </div>
                    <span className={`text-xs px-2 py-1 rounded-full font-medium
                      ${session.clockOut
                        ? 'bg-slate-700 text-slate-300'
                        : 'bg-emerald-500/20 text-emerald-400'}`}
                    >
                      {session.clockOut ? 'Completed' : 'Active'}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default EmployeeDashboard;
