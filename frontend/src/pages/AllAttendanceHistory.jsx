// src/pages/AllAttendanceHistory.jsx
import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import toast, { Toaster } from 'react-hot-toast';
import {
  ShieldCheck, LogOut, ArrowLeft, Calendar,
  Filter, CheckCircle, AlertCircle, ChevronDown, ChevronUp,
} from 'lucide-react';

const API = import.meta.env.VITE_API_URL;

// ── Group raw records by employee + date ──────────────────
const groupRecords = (records) => {
  const grouped = {};

  records.forEach((record) => {
    const date = new Date(record.clockIn).toLocaleDateString('en-CA');
    const key  = `${record.userId}_${date}`;

    if (!grouped[key]) {
      grouped[key] = {
        key,
        user:         record.user,
        date,
        sessions:     [],
        firstClockIn: record.clockIn,
        lastClockOut: record.clockOut,
        totalMs:      0,
        hasActive:    false,
      };
    }

    const g = grouped[key];
    g.sessions.push(record);

    // Track first clock in
    if (new Date(record.clockIn) < new Date(g.firstClockIn)) {
      g.firstClockIn = record.clockIn;
    }

    // Track last clock out
    if (record.clockOut) {
      if (!g.lastClockOut || new Date(record.clockOut) > new Date(g.lastClockOut)) {
        g.lastClockOut = record.clockOut;
      }
      // Sum actual session durations only — gap time excluded ✅
      g.totalMs += new Date(record.clockOut) - new Date(record.clockIn);
    } else {
      g.hasActive = true;
    }
  });

  return Object.values(grouped).sort(
    (a, b) => new Date(b.date) - new Date(a.date)
  );
};

// ── Group sessions into work blocks (gap < 30 mins = same block) ─
const buildWorkBlocks = (sessions) => {
  if (!sessions.length) return [];

  const sorted = [...sessions].sort(
    (a, b) => new Date(a.clockIn) - new Date(b.clockIn)
  );

  const blocks  = [];
  let   current = null;

  sorted.forEach((session) => {
    if (!current) {
      current = {
        sessions:     [session],
        firstClockIn: session.clockIn,
        lastClockOut: session.clockOut,
        totalMs:      session.clockOut
          ? new Date(session.clockOut) - new Date(session.clockIn)
          : 0,
        hasActive: !session.clockOut,
      };
      return;
    }

    const lastEnd    = current.lastClockOut ? new Date(current.lastClockOut) : null;
    const gapMinutes = lastEnd
      ? Math.floor((new Date(session.clockIn) - lastEnd) / 60000)
      : Infinity;

    if (gapMinutes < 30) {
      // Same block — gap < 30 mins
      current.sessions.push(session);
      if (session.clockOut) {
        // Add session duration only — NOT the gap ✅
        current.totalMs += new Date(session.clockOut) - new Date(session.clockIn);
        if (!current.lastClockOut ||
            new Date(session.clockOut) > new Date(current.lastClockOut)) {
          current.lastClockOut = session.clockOut;
        }
      } else {
        current.hasActive = true;
      }
    } else {
      // Gap >= 30 mins — new block (lunch break etc)
      blocks.push(current);
      current = {
        sessions:     [session],
        firstClockIn: session.clockIn,
        lastClockOut: session.clockOut,
        totalMs:      session.clockOut
          ? new Date(session.clockOut) - new Date(session.clockIn)
          : 0,
        hasActive: !session.clockOut,
      };
    }
  });

  if (current) blocks.push(current);
  return blocks;
};

const AllAttendanceHistory = () => {
  const { user, logout } = useAuth();
  const navigate         = useNavigate();

  const now          = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  const [filterType,   setFilterType]   = useState('month');
  const [month,        setMonth]        = useState(currentMonth);
  const [startDate,    setStartDate]    = useState('');
  const [endDate,      setEndDate]      = useState('');
  const [selectedUser, setSelectedUser] = useState('');
  const [records,      setRecords]      = useState([]);
  const [employees,    setEmployees]    = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [expanded,     setExpanded]     = useState({});

  const fetchHistory = useCallback(async () => {
    setLoading(true);
    try {
      let params = {};
      if (filterType === 'month') {
        params.month = month;
      } else {
        if (!startDate || !endDate) return;
        params.startDate = startDate;
        params.endDate   = endDate;
      }
      if (selectedUser) params.userId = selectedUser;

      const { data } = await axios.get(`${API}/attendance/history/all`, { params });
      setRecords(data.records);
      setEmployees(data.employees);
    } catch {
      toast.error('Failed to load records.');
    } finally {
      setLoading(false);
    }
  }, [filterType, month, startDate, endDate, selectedUser]);

  useEffect(() => { fetchHistory(); }, [fetchHistory]);

  const toggleExpand = (key) =>
    setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));

  const formatTime = (date) => date
    ? new Date(date).toLocaleTimeString('en-US', {
        hour: '2-digit', minute: '2-digit', hour12: true,
      })
    : '—';

  const formatDate = (dateStr) =>
    new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric',
    });

  const formatMs = (ms) => {
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    return `${h}h ${m}m`;
  };

  const getDuration = (clockIn, clockOut) => {
    if (!clockOut) return '—';
    return formatMs(new Date(clockOut) - new Date(clockIn));
  };

  // Flag unusual activity — more than 5 sessions in a day
  const isUnusual = (sessions) => sessions.length > 5;

  const grouped = groupRecords(records);

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <Toaster position="top-right" />

      {/* Navbar */}
      <nav className="border-b border-slate-800 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center">
            <ShieldCheck className="w-5 h-5 text-white" />
          </div>
          <span className="font-bold text-lg">AttendTrack</span>
          <span className="text-xs bg-indigo-600/20 text-indigo-400 border border-indigo-600/30 px-2 py-0.5 rounded-full font-medium">
            ADMIN
          </span>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-slate-400 text-sm">{user?.name}</span>
          <button onClick={async () => await logout()}
            className="flex items-center gap-2 text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 px-3 py-1.5 rounded-lg text-sm transition-all">
            <LogOut className="w-4 h-4" /> Logout
          </button>
        </div>
      </nav>

      <main className="p-6 max-w-6xl mx-auto">

        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <button onClick={() => navigate('/admin/dashboard')}
            className="p-2 hover:bg-slate-800 rounded-lg transition-all text-slate-400 hover:text-white">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-2xl font-bold">All Attendance Records</h1>
            <p className="text-slate-400 text-sm">
              Daily summary — click any row to see work blocks
            </p>
          </div>
        </div>

        {/* Filters */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 mb-6">
          <div className="flex items-center gap-2 mb-4">
            <Filter className="w-4 h-4 text-slate-400" />
            <span className="text-sm font-medium text-slate-300">Filter Records</span>
          </div>
          <div className="flex gap-2 mb-4">
            {['month', 'range'].map((type) => (
              <button key={type} onClick={() => setFilterType(type)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-all
                  ${filterType === type
                    ? 'bg-indigo-600 text-white'
                    : 'bg-slate-800 text-slate-400 hover:text-white'}`}>
                {type === 'month' ? '📅 By Month' : '📆 Date Range'}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-3 items-end">
            {filterType === 'month' ? (
              <input type="month" value={month}
                onChange={(e) => setMonth(e.target.value)}
                className="px-4 py-2 bg-slate-800 border border-slate-700 rounded-xl
                           text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            ) : (
              <>
                <div className="flex items-center gap-2">
                  <span className="text-slate-400 text-sm">From</span>
                  <input type="date" value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="px-4 py-2 bg-slate-800 border border-slate-700 rounded-xl
                               text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-slate-400 text-sm">To</span>
                  <input type="date" value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="px-4 py-2 bg-slate-800 border border-slate-700 rounded-xl
                               text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                </div>
              </>
            )}
            <select value={selectedUser}
              onChange={(e) => setSelectedUser(e.target.value)}
              className="px-4 py-2 bg-slate-800 border border-slate-700 rounded-xl
                         text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
              <option value="">All Employees</option>
              {employees.map((emp) => (
                <option key={emp.id} value={emp.id}>{emp.name}</option>
              ))}
            </select>
            {filterType === 'range' && (
              <button onClick={fetchHistory}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500
                           text-white text-sm rounded-xl transition-all">
                Apply
              </button>
            )}
          </div>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          {[
            { label: 'Total Days',      value: grouped.length },
            { label: 'Complete',        value: grouped.filter((g) => !g.hasActive).length, color: 'text-emerald-400' },
            { label: 'Still Active',    value: grouped.filter((g) =>  g.hasActive).length, color: 'text-amber-400'   },
            { label: 'Unusual Activity',value: grouped.filter((g) => isUnusual(g.sessions)).length, color: 'text-red-400' },
          ].map(({ label, value, color = 'text-white' }) => (
            <div key={label} className="bg-slate-900 border border-slate-800 rounded-xl p-4">
              <p className="text-slate-400 text-xs">{label}</p>
              <p className={`text-2xl font-bold mt-1 ${color}`}>{value}</p>
            </div>
          ))}
        </div>

        {/* Table */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-800 flex items-center gap-2">
            <Calendar className="w-5 h-5 text-slate-400" />
            <h2 className="font-semibold">Daily Summary</h2>
            <span className="text-xs bg-slate-700 text-slate-300 px-2 py-0.5 rounded-full">
              {grouped.length} days
            </span>
            <span className="text-xs text-slate-500 ml-2">
              👆 Click row to see work blocks
            </span>
          </div>

          {loading ? (
            <div className="flex justify-center py-12">
              <div className="w-8 h-8 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : grouped.length === 0 ? (
            <div className="text-center py-12 text-slate-500">
              <Calendar className="w-10 h-10 mx-auto mb-2 opacity-30" />
              <p>No records found.</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-800">
              {grouped.map((g) => {
                const workBlocks = buildWorkBlocks(g.sessions);
                const unusual    = isUnusual(g.sessions);

                return (
                  <div key={g.key}>

                    {/* ── Summary Row — clickable ── */}
                    <div
                      onClick={() => toggleExpand(g.key)}
                      className={`flex items-center justify-between px-6 py-4
                                 cursor-pointer transition-colors
                                 ${unusual
                                   ? 'hover:bg-red-950/20 border-l-2 border-red-500/50'
                                   : 'hover:bg-slate-800/50'}`}
                    >
                      {/* Employee */}
                      <div className="flex items-center gap-3 w-48">
                        <div className="w-9 h-9 bg-indigo-600 rounded-full flex items-center justify-center font-bold text-sm flex-shrink-0">
                          {g.user.name.charAt(0)}
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-medium text-white">{g.user.name}</p>
                            {unusual && (
                              <span className="text-xs text-red-400" title="Unusual activity">
                                ⚠️
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-slate-400">{g.user.email}</p>
                        </div>
                      </div>

                      {/* Date */}
                      <div className="text-sm text-slate-300 w-28">
                        {formatDate(g.date)}
                      </div>

                      {/* First In */}
                      <div className="text-sm text-slate-300 w-24">
                        🟢 {formatTime(g.firstClockIn)}
                      </div>

                      {/* Last Out */}
                      <div className="text-sm text-slate-300 w-24">
                        {g.lastClockOut
                          ? `🔴 ${formatTime(g.lastClockOut)}`
                          : '🟡 Active'}
                      </div>

                      {/* Total Hours — gap excluded ✅ */}
                      <div className="text-sm font-bold text-white w-20">
                        {formatMs(g.totalMs)}
                      </div>

                      {/* Sessions count */}
                      <div className={`text-xs w-24 ${unusual ? 'text-red-400' : 'text-slate-400'}`}>
                        {g.sessions.length} session{g.sessions.length > 1 ? 's' : ''}
                        {unusual && ' ⚠️'}
                      </div>

                      {/* Status */}
                      <div className="w-24">
                        {g.hasActive ? (
                          <span className="inline-flex items-center gap-1.5 text-xs bg-amber-500/20 text-amber-400 border border-amber-500/30 px-2.5 py-1 rounded-full">
                            <AlertCircle className="w-3 h-3" /> Active
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 text-xs bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 px-2.5 py-1 rounded-full">
                            <CheckCircle className="w-3 h-3" /> Complete
                          </span>
                        )}
                      </div>

                      {/* Expand icon */}
                      <div className="text-slate-400 w-6">
                        {expanded[g.key]
                          ? <ChevronUp className="w-4 h-4" />
                          : <ChevronDown className="w-4 h-4" />}
                      </div>
                    </div>

                    {/* ── Expanded Work Blocks ── */}
                    {expanded[g.key] && (
                      <div className="bg-slate-950 border-t border-slate-800 px-6 py-4">

                        {/* Unusual warning */}
                        {unusual && (
                          <div className="mb-4 px-4 py-3 bg-red-500/10 border border-red-500/20 rounded-xl">
                            <p className="text-red-400 text-sm font-medium">
                              ⚠️ Unusual Activity
                            </p>
                            <p className="text-slate-400 text-xs mt-1">
                              {g.sessions.length} sessions in one day.
                              All sessions are recorded accurately.
                              Review if needed.
                            </p>
                          </div>
                        )}

                        <p className="text-xs text-slate-500 uppercase tracking-widest mb-4">
                          Work Blocks — {formatDate(g.date)}
                        </p>

                        <div className="space-y-4">
                          {workBlocks.map((block, bi) => (
                            <div key={bi}
                              className="bg-slate-900 rounded-xl overflow-hidden">

                              {/* Block header */}
                              <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
                                <div className="flex items-center gap-3">
                                  <span className="text-xs font-bold text-indigo-400 bg-indigo-500/20 px-2 py-0.5 rounded-full">
                                    Block {bi + 1}
                                  </span>
                                  <span className="text-sm text-slate-300">
                                    🟢 {formatTime(block.firstClockIn)}
                                    &nbsp;→&nbsp;
                                    {block.lastClockOut
                                      ? `🔴 ${formatTime(block.lastClockOut)}`
                                      : '🟡 Active'}
                                  </span>
                                </div>
                                <div className="text-right">
                                  <span className="text-sm font-bold text-white">
                                    {formatMs(block.totalMs)}
                                  </span>
                                  <p className="text-xs text-slate-500">
                                    gaps not counted
                                  </p>
                                </div>
                              </div>

                              {/* All sessions in block — raw, no greying ✅ */}
                              <div className="divide-y divide-slate-800/50">
                                {block.sessions.map((session, si) => (
                                  <div key={session.id}
                                    className="flex items-center gap-4 px-4 py-2.5">
                                    <span className="text-xs text-slate-600 w-5">
                                      {si + 1}
                                    </span>
                                    <span className="text-xs text-slate-400">
                                      {formatTime(session.clockIn)}
                                      &nbsp;→&nbsp;
                                      {session.clockOut
                                        ? formatTime(session.clockOut)
                                        : 'Active'}
                                    </span>
                                    <span className="text-xs font-medium text-slate-300">
                                      {getDuration(session.clockIn, session.clockOut)}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>

                        {/* Day total */}
                        <div className="mt-4 pt-3 border-t border-slate-800 flex justify-between items-center">
                          <span className="text-xs text-slate-500">
                            {g.sessions.length} raw session{g.sessions.length > 1 ? 's' : ''}
                            &nbsp;→&nbsp;
                            {workBlocks.length} work block{workBlocks.length > 1 ? 's' : ''}
                          </span>
                          <span className="text-sm text-slate-400">
                            Total worked:&nbsp;
                            <span className="text-white font-bold">
                              {formatMs(g.totalMs)}
                            </span>
                          </span>
                        </div>
                      </div>
                    )}

                  </div>
                );
              })}
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

export default AllAttendanceHistory;
