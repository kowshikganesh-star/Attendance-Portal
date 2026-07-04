// src/pages/AllReports.jsx
import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import toast, { Toaster } from 'react-hot-toast';
import ExcelJS from 'exceljs';
import {
  ShieldCheck, LogOut, ArrowLeft,
  Download, Calendar, Filter, TrendingUp, X, FileSpreadsheet,
} from 'lucide-react';

const API = import.meta.env.VITE_API_URL;

const toDateStr = (d) => new Date(d).toLocaleDateString('en-CA');

// ── Group raw attendance records by employee + date, keyed for fast lookup ──
const groupByDay = (records) => {
  const grouped = {};

  records.forEach((record) => {
    const date = toDateStr(record.clockIn);
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

  return grouped; // keyed object: `${userId}_${date}` -> row
};

// ── Which calendar dates should we produce rows for? Never enumerates future dates ──
const getDatesToEnumerate = (fetchMonth, selectedDate) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  if (selectedDate) {
    const d = new Date(selectedDate + 'T00:00:00');
    return d > today ? [] : [selectedDate];
  }

  const [year, mon] = fetchMonth.split('-').map(Number);
  const daysInMonth   = new Date(year, mon, 0).getDate();
  const isFutureMonth = new Date(year, mon - 1, 1) > today;
  if (isFutureMonth) return [];

  const isCurrentMonth = year === today.getFullYear() && mon === today.getMonth() + 1;
  const lastDay = isCurrentMonth ? today.getDate() : daysInMonth;

  const dates = [];
  for (let day = 1; day <= lastDay; day++) {
    dates.push(`${year}-${String(mon).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
  }
  return dates;
};

// ── Does this leave cover this date? ───────────────────────
const leaveCoversDate = (leave, dateStr) => {
  const from = new Date(leave.fromDate); from.setHours(0, 0, 0, 0);
  const to   = new Date(leave.toDate);   to.setHours(0, 0, 0, 0);
  const d    = new Date(dateStr + 'T00:00:00');
  return d >= from && d <= to;
};

// ── Build one row per employee per date ────────────────────
// P    = clocked in that day
// LOP  = no clock-in, but an approved LOP/HD_LOP leave covers that day
// ''   = no clock-in and no leave (did not sign in) — row stays, fields blank
const buildReportRows = (attendanceByKey, lopLeaves, employees, dates, selectedUser) => {
  const filteredEmployees = selectedUser
    ? employees.filter((e) => e.id === parseInt(selectedUser))
    : employees;

  const rows = [];

  dates.forEach((date) => {
    filteredEmployees.forEach((emp) => {
      const key = `${emp.id}_${date}`;
      const attendanceRow = attendanceByKey[key];

      if (attendanceRow) {
        rows.push({ ...attendanceRow, attendance: 'P' });
        return;
      }

      const onLeave = lopLeaves.some(
        (leave) => leave.user.id === emp.id && leaveCoversDate(leave, date)
      );

      rows.push({
        key,
        userId:        emp.id,
        name:          emp.name,
        email:         emp.email,
        date,
        firstClockIn:  null,
        lastClockOut:  null,
        firstLocation: null,
        totalMs:       0,
        hasActive:     false,
        attendance:    onLeave ? 'LOP' : '',
      });
    });
  });

  return rows.sort(
    (a, b) => new Date(b.date) - new Date(a.date) || a.name.localeCompare(b.name)
  );
};

const AllReports = () => {
  const { user, logout } = useAuth();
  const navigate         = useNavigate();

  const today        = toDateStr(new Date());
  const currentMonth  = today.slice(0, 7);

  const [month,        setMonth]        = useState(currentMonth);
  const [selectedDate, setSelectedDate] = useState(''); // optional — overrides month when set
  const [selectedUser, setSelectedUser] = useState('');
  const [records,      setRecords]      = useState([]);
  const [lopLeaves,    setLopLeaves]    = useState([]);
  const [employees,    setEmployees]    = useState([]);
  const [loading,      setLoading]      = useState(true);

  // The month we actually need attendance data for
  const fetchMonth = selectedDate ? selectedDate.slice(0, 7) : month;

  // ── Fetch records ─────────────────────────────────────────
  const fetchRecords = useCallback(async () => {
    setLoading(true);
    try {
      const params = { month: fetchMonth };
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
  }, [fetchMonth, selectedUser]);

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
    const mon   = d.toLocaleString('en-US', { month: 'short' });
    const year  = d.getFullYear();
    const week  = d.toLocaleString('en-US', { weekday: 'short' });
    return `${week} ${day} ${mon} ${year}`;
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
      : '';

    const fmtDateCSV = (dateStr) => {
      const d   = new Date(dateStr + 'T00:00:00');
      const day = String(d.getDate()).padStart(2, '0');
      const mon = d.toLocaleString('en-US', { month: 'short' });
      return `${day} ${mon} ${d.getFullYear()}`;
    };

    const fmtDurCSV = (ms) => {
      if (!ms || ms <= 0) return '';
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
      'Status',
      'Total Duration',
      'Location',
    ];

    const rows = grouped.map((g) => [
      fmtDateCSV(g.date),
      esc(g.name),
      esc(g.email),
      g.attendance === 'P' ? fmtTimeCSV(g.firstClockIn) : '',
      g.attendance === 'P' ? (g.lastClockOut ? fmtTimeCSV(g.lastClockOut) : 'Active') : '',
      g.attendance, // 'P', 'LOP', or blank
      g.attendance === 'P' ? (g.hasActive ? 'Active' : 'Complete') : '',
      g.attendance === 'P' ? fmtDurCSV(g.totalMs) : '',
      g.attendance === 'P' ? esc(g.firstLocation || '—') : '',
    ].join(','));

    const csv  = [headers.join(','), ...rows].join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url  = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href  = url;
    const filenameTag = selectedDate || month;
    link.setAttribute('download', `report_${filenameTag}${selectedUser ? `_emp${selectedUser}` : ''}.csv`);
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
    toast.success('CSV downloaded!');
  };

  // ── Monthly Summary Export (styled .xlsx: employee rows × day columns) ──
  const exportMonthlySummaryXLSX = async () => {
    const dates = getDatesToEnumerate(fetchMonth, ''); // full month, ignoring the date filter

    if (dates.length === 0) {
      toast.error('No days to export for this month.');
      return;
    }

    const filteredEmployees = selectedUser
      ? employees.filter((e) => e.id === parseInt(selectedUser))
      : employees;

    const dayNumbers  = dates.map((d) => parseInt(d.slice(8, 10), 10));
    const isWeekendCol = dates.map((d) => {
      const day = new Date(d + 'T00:00:00').getDay(); // 0 = Sun, 6 = Sat
      return day === 0 || day === 6;
    });

    const workbook = new ExcelJS.Workbook();
    const sheet     = workbook.addWorksheet('Monthly Summary');

    const thinBorder = (color) => ({
      top:    { style: 'thin', color: { argb: color } },
      left:   { style: 'thin', color: { argb: color } },
      bottom: { style: 'thin', color: { argb: color } },
      right:  { style: 'thin', color: { argb: color } },
    });

    // Header row
    const headerRow = sheet.addRow(['Employee Name', ...dayNumbers]);
    headerRow.eachCell((cell, colNumber) => {
      const isWeekend = colNumber > 1 && isWeekendCol[colNumber - 2];
      cell.font      = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill       = {
        type: 'pattern', pattern: 'solid',
        fgColor: { argb: isWeekend ? 'FF2563EB' : 'FF4F46E5' }, // blue-600 for weekends, indigo-600 otherwise
      };
      cell.alignment  = { horizontal: 'center', vertical: 'middle' };
      cell.border     = thinBorder('FF334155');
    });
    headerRow.getCell(1).alignment = { horizontal: 'left', vertical: 'middle' };
    headerRow.height = 22;

    // Data rows
    filteredEmployees.forEach((emp) => {
      const cells = dates.map((date) => {
        const key = `${emp.id}_${date}`;
        if (attendanceByKey[key]) return 'p';
        const onLeave = lopLeaves.some(
          (leave) => leave.user.id === emp.id && leaveCoversDate(leave, date)
        );
        return onLeave ? 'lop' : '';
      });

      const row = sheet.addRow([emp.name, ...cells]);

      row.getCell(1).font      = { bold: true };
      row.getCell(1).alignment = { horizontal: 'left', vertical: 'middle' };
      row.getCell(1).border    = thinBorder('FFE2E8F0');

      for (let i = 2; i <= cells.length + 1; i++) {
        const cell      = row.getCell(i);
        const isWeekend = isWeekendCol[i - 2];
        cell.alignment  = { horizontal: 'center', vertical: 'middle' };
        cell.border     = thinBorder('FFE2E8F0');

        if (isWeekend) {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCEAFB' } }; // blue-100
          cell.font = { color: { argb: 'FF1D4ED8' }, bold: true }; // blue-700
        } else if (cell.value === 'p') {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD1FAE5' } };
          cell.font = { color: { argb: 'FF047857' }, bold: true };
        } else if (cell.value === 'lop') {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEE2E2' } };
          cell.font = { color: { argb: 'FFB91C1C' }, bold: true };
        }
      }
    });

    // Column widths
    sheet.getColumn(1).width = 26;
    for (let i = 2; i <= dayNumbers.length + 1; i++) {
      sheet.getColumn(i).width = 6;
    }

    // Freeze header row + employee name column
    sheet.views = [{ state: 'frozen', xSplit: 1, ySplit: 1 }];

    const buffer = await workbook.xlsx.writeBuffer();
    const blob   = new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const url  = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href  = url;
    link.setAttribute('download', `monthly_summary_${fetchMonth}${selectedUser ? `_emp${selectedUser}` : ''}.xlsx`);
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
    toast.success('Monthly summary Excel downloaded!');
  };

  const attendanceByKey = groupByDay(records);
  const datesToShow     = getDatesToEnumerate(fetchMonth, selectedDate);
  const grouped         = buildReportRows(attendanceByKey, lopLeaves, employees, datesToShow, selectedUser);

  // Summary stats
  const totalDays      = grouped.length;
  const totalEmployees = [...new Set(grouped.map((g) => g.userId))].length;
  const totalMs        = grouped.reduce((acc, g) => acc + g.totalMs, 0);
  const activeDays     = grouped.filter((g) => g.hasActive).length;

  const monthLabel = new Date(month + '-01').toLocaleDateString('en-US', {
    month: 'long', year: 'numeric',
  });

  const dateLabel = selectedDate
    ? new Date(selectedDate + 'T00:00:00').toLocaleDateString('en-US', {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
      })
    : null;

  const rangeLabel = dateLabel || monthLabel;

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
                Daily records — {rangeLabel}
                {selectedUser && employees.find(e => e.id === parseInt(selectedUser))
                  ? ` — ${employees.find(e => e.id === parseInt(selectedUser)).name}`
                  : ''}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={exportMonthlySummaryXLSX} disabled={employees.length === 0}
              className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700
                         disabled:opacity-50 disabled:cursor-not-allowed
                         text-white px-4 py-2.5 rounded-xl text-sm font-semibold
                         transition-all border border-slate-700">
              <FileSpreadsheet className="w-4 h-4" />
              Monthly Summary
            </button>
            <button onClick={exportCSV} disabled={grouped.length === 0}
              className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500
                         disabled:opacity-50 disabled:cursor-not-allowed
                         text-white px-4 py-2.5 rounded-xl text-sm font-semibold
                         transition-all shadow-lg shadow-indigo-600/20">
              <Download className="w-4 h-4" />
              Export CSV
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 mb-6">
          <div className="flex items-center gap-2 mb-4">
            <Filter className="w-4 h-4 text-slate-400" />
            <span className="text-sm font-medium text-slate-300">Filter Records</span>
          </div>
          <div className="flex flex-wrap gap-3 items-center">
            <input type="month" value={month}
              disabled={!!selectedDate}
              onChange={(e) => setMonth(e.target.value)}
              className="px-4 py-2 bg-slate-800 border border-slate-700 rounded-xl
                         text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500
                         disabled:opacity-50" />

            <div className="flex items-center gap-2">
              <input type="date" value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="px-4 py-2 bg-slate-800 border border-slate-700 rounded-xl
                           text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              {selectedDate && (
                <button onClick={() => setSelectedDate('')}
                  className="p-2 bg-slate-800 hover:bg-slate-700 rounded-xl text-slate-400 hover:text-white transition-all"
                  title="Clear date — back to month view">
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

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
              <p>No records found for {rangeLabel}.</p>
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
                        {g.attendance === 'P'
                          ? <>🟢 {formatTime(g.firstClockIn)}</>
                          : <span className="text-slate-600">—</span>}
                      </td>

                      {/* Last Clock Out */}
                      <td className="px-5 py-4 text-sm text-slate-300 whitespace-nowrap">
                        {g.attendance !== 'P'
                          ? <span className="text-slate-600">—</span>
                          : g.hasActive
                            ? <span className="text-amber-400">🟡 Active</span>
                            : g.lastClockOut
                              ? `🔴 ${formatTime(g.lastClockOut)}`
                              : '—'}
                      </td>

                      {/* Attendance */}
                      <td className="px-5 py-4">
                        {g.attendance === 'P' ? (
                          <span className="inline-flex items-center gap-1 text-xs bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 px-2.5 py-1 rounded-full font-medium">
                            P
                          </span>
                        ) : g.attendance === 'LOP' ? (
                          <span className="inline-flex items-center gap-1 text-xs bg-red-500/20 text-red-400 border border-red-500/30 px-2.5 py-1 rounded-full font-medium">
                            LOP
                          </span>
                        ) : (
                          <span className="text-slate-600 text-xs">—</span>
                        )}
                      </td>

                      {/* Total Duration */}
                      <td className="px-5 py-4">
                        <span className={`text-sm font-bold
                          ${g.totalMs > 0 ? 'text-white' : 'text-slate-500'}`}>
                          {g.attendance !== 'P'
                            ? <span className="text-slate-600">—</span>
                            : g.hasActive && g.totalMs === 0
                              ? <span className="text-amber-400 text-xs font-normal">In progress</span>
                              : formatMs(g.totalMs, true)}
                        </span>
                      </td>

                      {/* Location */}
                      <td className="px-5 py-4 text-sm text-slate-400 max-w-xs">
                        {g.attendance === 'P' && g.firstLocation
                          ? <span className="truncate block max-w-48" title={g.firstLocation}>
                              📍 {g.firstLocation}
                            </span>
                          : <span className="text-slate-600">—</span>}
                      </td>

                      {/* Status */}
                      <td className="px-5 py-4">
                        {g.attendance !== 'P' ? (
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
