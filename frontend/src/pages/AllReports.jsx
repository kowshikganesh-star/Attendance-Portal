// src/pages/AllReports.jsx
import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import toast, { Toaster } from 'react-hot-toast';
import {
  ShieldCheck, LogOut, ArrowLeft,
  Download, Calendar, Filter, TrendingUp,
} from 'lucide-react';

const API = import.meta.env.VITE_API_URL;

// ── Group raw records by employee + date ──────────────────
const groupByDay = (records) => {
  const grouped = {};

  records.forEach((record) => {
    const date = new Date(record.clockIn).toLocaleDateString('en-CA');
    const key  = `${record.userId}_${date}`;

    if (!grouped[key]) {
      grouped[key] = {
        key,
        userId:        record.user.id,
        name:          record.user.name,
        email:         record.user.email,
        date,
        firstClockIn:  record.clockIn,
        lastClockOut:  record.clockOut || null,
        firstLocation: record.location || null, // ← first login location
        totalMs:       0,
        hasActive:     false,
      };
    }

    const g = grouped[key];

    // Track first clock in + its location
    if (new Date(record.clockIn) < new Date(g.firstClockIn)) {
      g.firstClockIn  = record.clockIn;
      g.firstLocation = record.location || null;
    }

    // Track last clock out
    if (record.clockOut) {
      if (!g.lastClockOut || new Date(record.clockOut) > new Date(g.lastClockOut)) {
        g.lastClockOut = record.clockOut;
      }
      g.totalMs += new Date(record.clockOut) - new Date(record.clockIn);
    } else {
      g.hasActive = true;
    }
  });

  return Object.values(grouped);
};

// ── Expand approved LOP / HD_LOP leaves into per-day rows for the selected month ──
const expandLopDays = (leaves, month) => {
  const days = [];

  leaves.forEach((leave) => {
    const cur = new Date(leave.fromDate);
    cur.setHours(0, 0, 0, 0);
    const end = new Date(leave.toDate);
    end.setHours(0, 0, 0, 0);

    while (cur <= end) {
      const dateStr = cur.toLocaleDateString('en-CA');
      if (dateStr.startsWith(month)) {
        days.push({
          key:           `${leave.user.id}_${dateStr}`,
          userId:        leave.user.id,
          name:          leave.user.name,
          email:         leave.user.email,
          date:          dateStr,
          firstClockIn:  null,
          lastClockOut:  null,
          firstLocation: null,
          totalMs:       0,
          hasActive:     false,
          attendance:    'LOP',
        });
      }
      cur.setDate(cur.getDate() + 1);
    }
  });

  return days;
};

// ── Merge attendance rows (marked 'P') with LOP-only rows, skipping duplicates ──
const mergeAttendanceAndLop = (attendanceGrouped, lopDays) => {
  const existingKeys = new Set(attendanceGrouped.map((g) => g.key));
  const lopOnly       = lopDays.filter((d) => !existingKeys.has(d.key));
  const withAttendance = attendanceGrouped.map((g) => ({ ...g, attendance: 'P' }));

  return [...withAttendance, ...lopOnly].sort(
    (a, b) => new Date(b.date) - new Date(a.date)
  );
};

const AllReports = () => {
  const { user, logout } = useAuth();
  const navigate         = useNavigate();

  const now          = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  const [month,        setMonth]        = useState(currentMonth);
  const [selectedUser, setSelectedUser] = useState('');
  const [records,      setRecords]      = useState([]);
  const [lopLeaves,    setLopLeaves]    = useState([]);
  const [employees,    setEmployees]    = useState([]);
  const [loading,      setLoading]      = useState(true);

  // ── Fetch records ─────────────────────────────────────────
  const fetchRecords = useCallback(async () => {
    setLoading(true);
    try {
      const params = { month };
      if (selectedUser) params.userId = selectedUser;

      const leaveParams = { status: 'APPROVED' };
      if (selectedUser) leaveParams.userId = selectedUser;

      const [attendanceRes, lopRes, hdLopRes] = await Promise.all([
        axios.get(`${API}/attendance/history/all`, { params }),
        axios.get(`${API}/leaves`, { params: { ...leaveParams, type: 'LOP' } }),
        axios.get(`${API}/leaves`, { params: { ...leaveParams, type: 'HD_LOP' } }),
      ]);

      setRecords(attendanceRes.data.records);
      setEmployees(attendanceRes.data.employees);
      setLopLeaves([...lopRes.data.leaves, ...hdLopRes.data.leaves]);
    } catch {
      toast.error('Failed to load report.');
    } finally {
      setLoading(false);
    }
  }, [month, selectedUser]);

  useEffect(() => { fetchRecords(); }, [fetchRecords]);

  // ── Format helpers ────────────────────────────────────────
  const formatTime = (d) => d
    ? new Date(d).toLocaleTimeString('en-US', {
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true,
      })
    : '—';

  const formatDate = (dateStr) => {
    const d     = new Date(dateStr + 'T00:00:00');
    const day   = String(d.getDate()).padStart(2, '0');
    const month = d.toLocaleString('en-US', { month: 'short' });
    const year  = d.getFullYear();
    const week  = d.toLocaleString('en-US', { weekday: 'short' });
    return `${week} ${day} ${month} ${year}`;
  };

  const formatMs = (ms, showSeconds = false) => {
    if (!ms || ms <= 0) return '0h 0m';
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    if (showSeconds || h === 0) return `${h}h ${m}m ${s}s`;
    return `${h}h ${m}m`;
  };

  // ── CSV Export ────────────────────────────────────────────
  const exportCSV = () => {
    if (grouped.length === 0) {
      toast.error('No records to export.');
      return;
    }

    const esc = (val) => {
      const str = String(val ?? '—');
      return str.includes(',') ? `"${str.replace(/"/g, '""')}"` : str;
    };

    const fmtTimeCSV = (d) => d
      ? new Date(d).toLocaleTimeString('en-US', {
          hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true,
        })
      : '—';

    const fmtDateCSV = (dateStr) => {
      const d     = new Date(dateStr + 'T00:00:00');
      const day   = String(d.getDate()).padStart(2, '0');
      const month = d.toLocaleString('en-US', { month: 'short' });
      return `${day} ${month} ${d.getFullYear()}`;
    };

    const fmtDurCSV = (ms) => {
      if (!ms || ms <= 0) return '0h 0m 0s';
      const h = Math.floor(ms / 3600000);
      const m = Math.floor((ms % 3600000) / 60000);
      const s = Math.floor((ms % 60000) / 1000);
      return `${h}h ${m}m ${s}s`;
    };

    const headers = [
      'Date',
      'Employee Name',
      'Email',
      'First Clock In',
      'Last Clock Out',
      'Attendance',
      'Total Duration',
      'Location',
      'Status',
    ];

    const rows = grouped.map((g) => [
      fmtDateCSV(g.date),
      esc(g.name),
      esc(g.email),
      g.attendance === 'LOP' ? '—' : fmtTimeCSV(g.firstClockIn),
      g.attendance === 'LOP' ? '—' : (g.lastClockOut ? fmtTimeCSV(g.lastClockOut) : 'Active'),
      g.attendance,
      g.attendance === 'LOP' ? '—' : fmtDurCSV(g.totalMs),
      esc(g.firstLocation || '—'),
      g.attendance === 'LOP' ? '—' : (g.hasActive ? 'Active' : 'Complete'),
    ].join(','));

    const csv  = [headers.join(','), ...rows].join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url  = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href  = url;
    link.setAttribute('download', `report_${month}${selectedUser ? `_emp${selectedUser}` : ''}.csv`);
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
    toast.success('CSV downloaded!');
  };

  const grouped = mergeAttendanceAndLop(groupByDay(records), expandLopDays(lopLeaves, month));

  // Summary stats
  const totalDays      = grouped.length;
  const totalEmployees = [...new Set(grouped.map((g) => g.userId))].length;
  const totalMs        = grouped.reduce((acc, g) => acc + g.totalMs, 0);
  const activeDays     = grouped.filter((g) => g.hasActive).length;

  const monthLabel = new Date(month + '-01').toLocaleDateString('en-US', {
    month: 'long', year: 'numeric',
  });

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

      <main className="p-6 max-w-7xl mx-auto">

        {/* Header */}
        <div className="flex items-center justify-between mb-6 flex-wrap gap-4">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate('/admin/dashboard')}
              className="p-2 hover:bg-slate-800 rounded-lg transition-all text-slate-400 hover:text-white">
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div>
              <h1 className="text-2xl font-bold">Attendance Reports</h1>
              <p className="text-slate-400 text-sm">
                Daily records — {monthLabel}
                {selectedUser && employees.find(e => e.id === parseInt(selectedUser))
                  ? ` — ${employees.find(e => e.id === parseInt(selectedUser)).name}`
                  : ''}
              </p>
            </div>
          </div>
          <button onClick={exportCSV} disabled={grouped.length === 0}
            className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500
                       disabled:opacity-50 disabled:cursor-not-allowed
                       text-white px-4 py-2.5 rounded-xl text-sm font-semibold
                       transition-all shadow-lg shadow-indigo-600/20">
            <Download className="w-4 h-4" />
            Export CSV
          </button>
        </div>

        {/* Filters */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 mb-6">
          <div className="flex items-center gap-2 mb-4">
            <Filter className="w-4 h-4 text-slate-400" />
            <span className="text-sm font-medium text-slate-300">Filter Records</span>
          </div>
          <div className="flex flex-wrap gap-3 items-center">
            <input type="month" value={month}
              onChange={(e) => setMonth(e.target.value)}
              className="px-4 py-2 bg-slate-800 border border-slate-700 rounded-xl
                         text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            <select value={selectedUser}
              onChange={(e) => setSelectedUser(e.target.value)}
              className="px-4 py-2 bg-slate-800 border border-slate-700 rounded-xl
                         text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
              <option value="">All Employees</option>
              {employees.map((emp) => (
                <option key={emp.id} value={emp.id}>{emp.name}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          {[
            { label: 'Total Records',    value: totalDays,      color: 'text-white'       },
            { label: 'Employees',        value: totalEmployees, color: 'text-indigo-400'  },
            { label: 'Total Hours',      value: formatMs(totalMs), color: 'text-emerald-400' },
            { label: 'Still Active',     value: activeDays,     color: 'text-amber-400'   },
          ].map(({ label, value, color }) => (
            <div key={label} className="bg-slate-900 border border-slate-800 rounded-xl p-5">
              <p className="text-slate-400 text-xs mb-1">{label}</p>
              <p className={`text-2xl font-bold ${color}`}>{value}</p>
            </div>
          ))}
        </div>

        {/* Table */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-800 flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-slate-400" />
            <h2 className="font-semibold">Daily Records</h2>
            <span className="text-xs bg-slate-700 text-slate-300 px-2 py-0.5 rounded-full">
              {grouped.length} records
            </span>
            <span className="text-xs text-slate-500 ml-2">
              1 row per employee per day
            </span>
          </div>

          {loading ? (
            <div className="flex justify-center py-12">
              <div className="w-8 h-8 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : grouped.length === 0 ? (
            <div className="text-center py-12 text-slate-500">
              <Calendar className="w-10 h-10 mx-auto mb-2 opacity-30" />
              <p>No records found for {monthLabel}.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-800 text-left">
                    {[
                      'Employee',
                      'Date',
                      'First Clock In',
                      'Last Clock Out',
                      'Attendance',
                      'Total Duration',
                      'Location',
                      'Status',
                    ].map((h) => (
                      <th key={h}
                        className="px-5 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {grouped.map((g) => (
                    <tr key={g.key}
                      className="hover:bg-slate-800/50 transition-colors">

                      {/* Employee */}
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 bg-indigo-600 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0">
                            {g.name.charAt(0)}
                          </div>
                          <div>
                            <p className="text-sm font-medium text-white">{g.name}</p>
                            <p className="text-xs text-slate-400">{g.email}</p>
                          </div>
                        </div>
                      </td>

                      {/* Date */}
                      <td className="px-5 py-4 text-sm text-slate-300 whitespace-nowrap">
                        {formatDate(g.date)}
                      </td>

                      {/* First Clock In */}
                      <td className="px-5 py-4 text-sm font-medium text-emerald-400 whitespace-nowrap">
                        {g.attendance === 'LOP'
                          ? <span className="text-slate-600">—</span>
                          : <>🟢 {formatTime(g.firstClockIn)}</>}
                      </td>

                      {/* Last Clock Out */}
                      <td className="px-5 py-4 text-sm text-slate-300 whitespace-nowrap">
                        {g.attendance === 'LOP'
                          ? <span className="text-slate-600">—</span>
                          : g.hasActive
                            ? <span className="text-amber-400">🟡 Active</span>
                            : g.lastClockOut
                              ? `🔴 ${formatTime(g.lastClockOut)}`
                              : '—'}
                      </td>

                      {/* Attendance */}
                      <td className="px-5 py-4">
                        {g.attendance === 'LOP' ? (
                          <span className="inline-flex items-center gap-1 text-xs bg-red-500/20 text-red-400 border border-red-500/30 px-2.5 py-1 rounded-full font-medium">
                            LOP
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 px-2.5 py-1 rounded-full font-medium">
                            P
                          </span>
                        )}
                      </td>

                      {/* Total Duration */}
                      <td className="px-5 py-4">
                        <span className={`text-sm font-bold
                          ${g.totalMs > 0 ? 'text-white' : 'text-slate-500'}`}>
                          {g.attendance === 'LOP'
                            ? <span className="text-slate-600">—</span>
                            : g.hasActive && g.totalMs === 0
                              ? <span className="text-amber-400 text-xs font-normal">In progress</span>
                              : formatMs(g.totalMs, true)}
                        </span>
                      </td>

                      {/* Location */}
                      <td className="px-5 py-4 text-sm text-slate-400 max-w-xs">
                        {g.firstLocation
                          ? <span className="truncate block max-w-48" title={g.firstLocation}>
                              📍 {g.firstLocation}
                            </span>
                          : <span className="text-slate-600">—</span>}
                      </td>

                      {/* Status */}
                      <td className="px-5 py-4">
                        {g.attendance === 'LOP' ? (
                          <span className="text-slate-600 text-xs">—</span>
                        ) : g.hasActive ? (
                          <span className="inline-flex items-center gap-1 text-xs bg-amber-500/20 text-amber-400 border border-amber-500/30 px-2.5 py-1 rounded-full">
                            Active
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 px-2.5 py-1 rounded-full">
                            Complete
                          </span>
                        )}
                      </td>

                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

      </main>
    </div>
  );
};

export default AllReports;
