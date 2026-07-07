// src/pages/AllAttendanceHistory.jsx
import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import ExcelJS from 'exceljs';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import toast, { Toaster } from 'react-hot-toast';
import {
  ShieldCheck, LogOut, ArrowLeft, Calendar,
  Filter, CheckCircle, AlertCircle, ChevronDown, ChevronUp, Download, FileSpreadsheet,
} from 'lucide-react';

const API = import.meta.env.VITE_API_URL;

const toDateStr = (d) => new Date(d).toLocaleDateString('en-CA');

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

// ── Which calendar dates should we produce columns for? Never future dates ──
const getDatesToEnumerate = (fetchMonth) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

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

  // showSeconds = true for individual sessions
  // showSeconds = false for summary totals
  const formatMs = (ms, showSeconds = false) => {
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    const s = Math.floor((ms % 60000) / 1000);

    // Always show seconds if duration is under 1 hour
    // or if showSeconds explicitly requested
    if (showSeconds || h === 0) {
      return `${h}h ${m}m ${s}s`;
    }
    return `${h}h ${m}m`;
  };

  // Individual session duration — always show seconds
  const getDuration = (clockIn, clockOut) => {
    if (!clockOut) return '—';
    return formatMs(new Date(clockOut) - new Date(clockIn), true);
  };

  // Flag unusual activity — more than 5 sessions in a day
  const isUnusual = (sessions) => sessions.length > 5;

  // ── CSV Export ────────────────────────────────────────────
  const exportCSV = () => {
    if (records.length === 0) {
      toast.error('No records to export.');
      return;
    }

    // Format time as 09:18:00 AM
    const fmtTime = (d) => d
      ? new Date(d).toLocaleTimeString('en-US', {
          hour:   '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: true,
        })
      : '—';

    // Format date WITHOUT commas → 05 Jun 2026
    const fmtDate = (dateStr) => {
      const d = new Date(dateStr + 'T00:00:00');
      const day   = String(d.getDate()).padStart(2, '0');
      const month = d.toLocaleString('en-US', { month: 'short' });
      const year  = d.getFullYear();
      return `${day} ${month} ${year}`;
    };

    // Format duration with seconds
    const fmtDuration = (ms) => {
      if (!ms || ms < 0) return '0h 0m 0s';
      const h = Math.floor(ms / 3600000);
      const m = Math.floor((ms % 3600000) / 60000);
      const s = Math.floor((ms % 60000) / 1000);
      return `${h}h ${m}m ${s}s`;
    };

    // Escape field (wrap in quotes if has comma)
    const esc = (val) => {
      const str = String(val ?? '—');
      return str.includes(',') ? `"${str.replace(/"/g, '""')}"` : str;
    };

    // Headers — simple and clean
    const headers = [
      'Employee Name',
      'Email',
      'Date',
      'Clock In',
      'Clock Out',
      'Duration',
      'Location',
    ];

    const rows = [];

    // One row per session per employee
    grouped.forEach((g) => {
      const sortedSessions = [...g.sessions].sort(
        (a, b) => new Date(a.clockIn) - new Date(b.clockIn)
      );

      sortedSessions.forEach((session) => {
        const sessionMs = session.clockOut
          ? new Date(session.clockOut) - new Date(session.clockIn)
          : null;

        rows.push([
          esc(g.user.name),
          esc(g.user.email),
          fmtDate(g.date),
          fmtTime(session.clockIn),
          session.clockOut ? fmtTime(session.clockOut) : 'Active',
          sessionMs !== null ? fmtDuration(sessionMs) : 'Active',
          esc(session.location || '—'),
        ].join(','));
      });
    });

    const csvContent = [headers.join(','), ...rows].join('\n');
    const blob       = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url        = window.URL.createObjectURL(blob);
    const link       = document.createElement('a');
    const fileName   = filterType === 'month'
      ? `attendance_${month}.csv`
      : `attendance_${startDate}_to_${endDate}.csv`;

    link.href = url;
    link.setAttribute('download', fileName);
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
    toast.success('CSV downloaded!');
  };

  // ── Monthly Summary Export (styled .xlsx: employee rows × day columns) ──
  // Does its own dedicated fetch for the target month's attendance + approved
  // LOP/HD_LOP leaves, independent of whatever filter mode is currently active.
  //
  // Marker priority on a WEEKDAY: approved leave → hours worked → absent.
  //   Weekend (Sat/Sun): worked → P (any hours), otherwise H (holiday)
  //   HD_LOP leave → HD-LOP  |  LOP leave → LOP   (leave always wins)
  //   No leave, finished weekday:  <4h → LOP,  4h–5h → HD-LOP,  5h+ → P
  //   No leave, no clock-in, past weekday → LOP (absent)
  //   Today / still-active session → P (not judged) ;  today, no clock-in → blank
  const exportMonthlySummaryXLSX = async () => {
    const targetMonth = filterType === 'month'
      ? month
      : (startDate ? startDate.slice(0, 7) : month);

    try {
      const params = { month: targetMonth };
      if (selectedUser) params.userId = selectedUser;

      const leaveParams = { status: 'APPROVED' };
      if (selectedUser) leaveParams.userId = selectedUser;

      const [attendanceRes, lopRes, hdLopRes] = await Promise.all([
        axios.get(`${API}/attendance/history/all`, { params }),
        axios.get(`${API}/leaves`, { params: { ...leaveParams, type: 'LOP' } }),
        axios.get(`${API}/leaves`, { params: { ...leaveParams, type: 'HD_LOP' } }),
      ]);

      const monthRecords   = attendanceRes.data.records;
      const monthEmployees = attendanceRes.data.employees;
      const lopLeaves       = [...lopRes.data.leaves, ...hdLopRes.data.leaves];

      // Per employee-day: total worked ms + whether a session is still open.
      // Needed so the summary can judge short days (<4h / 4–5h) by hours worked.
      const attendanceByKey = {};
      monthRecords.forEach((record) => {
        const date = toDateStr(record.clockIn);
        const key  = `${record.userId}_${date}`;
        if (!attendanceByKey[key]) {
          attendanceByKey[key] = { totalMs: 0, hasActive: false };
        }
        const g = attendanceByKey[key];
        if (record.clockOut) {
          g.totalMs += new Date(record.clockOut) - new Date(record.clockIn);
        } else {
          g.hasActive = true;
        }
      });

      const dates = getDatesToEnumerate(targetMonth);
      if (dates.length === 0) {
        toast.error('No days to export for this month.');
        return;
      }

      const filteredEmployees = selectedUser
        ? monthEmployees.filter((e) => e.id === parseInt(selectedUser))
        : monthEmployees;

      const isWeekendCol = dates.map((d) => {
        const day = new Date(d + 'T00:00:00').getDay(); // 0 = Sun, 6 = Sat
        return day === 0 || day === 6;
      });

      const totalCols  = 2 + dates.length;
      const monthTitle = new Date(targetMonth + '-01').toLocaleDateString('en-US', {
        month: 'long', year: 'numeric',
      });

      const workbook = new ExcelJS.Workbook();
      const sheet     = workbook.addWorksheet('Monthly Summary');

      const thinBorder = (color) => ({
        top:    { style: 'thin', color: { argb: color } },
        left:   { style: 'thin', color: { argb: color } },
        bottom: { style: 'thin', color: { argb: color } },
        right:  { style: 'thin', color: { argb: color } },
      });

      // Cell color map — bright base, black-bordered markers.
      // Red severity ramps: approved leave (palest) → short hours → absent (strongest).
      // "label" is the professional name used in the legend table.
      const KIND_STYLE = {
        P:          { bg: 'FFD1FAE5', fg: 'FF047857', label: 'Present',                hardBorder: true  }, // green
        HD_LEAVE:   { bg: 'FFFFF3C4', fg: 'FF92700A', label: 'Half Day (Approved)',    hardBorder: true  }, // pale amber
        HD_WORK:    { bg: 'FFF6A609', fg: 'FF5A3D00', label: 'Half Day (Short Hours)', hardBorder: true  }, // deep amber/orange
        LOP_LEAVE:  { bg: 'FFFDECEA', fg: 'FFB4413A', label: 'LOP (Approved Leave)',   hardBorder: true  }, // pale red
        LOP_SHORT:  { bg: 'FFF2B8B2', fg: 'FF7A2820', label: 'LOP (Short Hours)',      hardBorder: true  }, // medium red
        LOP_ABSENT: { bg: 'FFEF9A93', fg: 'FF7A1C14', label: 'LOP (Absent)',           hardBorder: true  }, // strong red — no-show stands out
        H:          { bg: 'FFDCEAFB', fg: 'FF1D4ED8', label: 'Holiday / Weekend',      hardBorder: false }, // blue (soft border)
      };

      // Title row — indigo
      const titleRow = sheet.addRow([`Attendance Summary — ${monthTitle}`]);
      sheet.mergeCells(titleRow.number, 1, titleRow.number, totalCols);
      titleRow.height = 26;
      const titleCell = titleRow.getCell(1);
      titleCell.font      = { bold: true, size: 13, color: { argb: 'FFFFFFFF' } };
      titleCell.fill       = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF312E81' } }; // indigo-900
      titleCell.alignment  = { horizontal: 'center', vertical: 'middle' };

      // Header row — indigo, weekends in blue; day number + weekday on two lines
      const headerRow = sheet.addRow(['#', 'Employee Email', ...dates.map((d) => {
        const dt      = new Date(d + 'T00:00:00');
        const dayNum  = String(dt.getDate()).padStart(2, '0');
        const weekday = dt.toLocaleDateString('en-US', { weekday: 'short' });
        return `${dayNum}\n${weekday}`;
      })]);
      headerRow.eachCell((cell, colNumber) => {
        const isWeekend = colNumber > 2 && isWeekendCol[colNumber - 3];
        cell.font      = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
        cell.fill       = {
          type: 'pattern', pattern: 'solid',
          fgColor: { argb: isWeekend ? 'FF2563EB' : 'FF4F46E5' }, // blue-600 for weekends, indigo-600 otherwise
        };
        cell.alignment  = { horizontal: 'center', vertical: 'middle', wrapText: true };
        cell.border     = thinBorder(isWeekend ? 'FF334155' : 'FFE2E8F0');
      });
      headerRow.getCell(1).font      = { bold: true, color: { argb: 'FFFFFFFF' } };
      headerRow.getCell(2).font      = { bold: true, color: { argb: 'FFFFFFFF' } };
      headerRow.getCell(2).alignment = { horizontal: 'left', vertical: 'middle' };
      headerRow.height = 30;

      // Data rows
      const todayStr    = toDateStr(new Date());
      const FOUR_HOURS  = 4 * 60 * 60 * 1000; // 14,400,000 ms
      const FIVE_HOURS  = 5 * 60 * 60 * 1000; // 18,000,000 ms

      filteredEmployees.forEach((emp, idx) => {
        // Each entry: { v: display text, kind: style key }
        const cellObjs = dates.map((date, dIdx) => {
          const key           = `${emp.id}_${date}`;
          const attendanceRow = attendanceByKey[key];
          const isWeekend     = isWeekendCol[dIdx];
          const isToday       = date === todayStr;

          // ── Weekend: worked → P (any hours), otherwise Holiday ──
          if (isWeekend) {
            return attendanceRow ? { v: 'P', kind: 'P' } : { v: 'H', kind: 'H' };
          }

          // ── Weekday: approved leave ALWAYS wins (even if they logged in) ──
          const hdLopLeave = lopLeaves.some(
            (leave) => leave.user.id === emp.id
              && leave.type === 'HD_LOP'
              && leaveCoversDate(leave, date)
          );
          if (hdLopLeave) return { v: 'HD-LOP', kind: 'HD_LEAVE' }; // approved half-day leave

          const lopLeave = lopLeaves.some(
            (leave) => leave.user.id === emp.id
              && leave.type === 'LOP'
              && leaveCoversDate(leave, date)
          );
          if (lopLeave) return { v: 'LOP', kind: 'LOP_LEAVE' };

          // ── No leave → judge by clock-in / hours worked ──
          if (attendanceRow) {
            if (isToday || attendanceRow.hasActive) return { v: 'P', kind: 'P' }; // not finished → don't judge yet
            const dur = attendanceRow.totalMs;
            if (dur < FOUR_HOURS) return { v: 'LOP', kind: 'LOP_SHORT' };    // under 4h → short-day LOP
            if (dur < FIVE_HOURS) return { v: 'HD-LOP', kind: 'HD_WORK' };   // 4h–5h   → worked half-day
            return { v: 'P', kind: 'P' };                                    // 5h+     → present
          }

          // ── No leave, no clock-in ──
          if (isToday) return { v: '', kind: '' };          // today, not clocked in yet → pending
          return { v: 'LOP', kind: 'LOP_ABSENT' };          // past weekday, absent → strong red
        });

        const row = sheet.addRow([idx + 1, emp.email, ...cellObjs.map((c) => c.v)]);

        row.getCell(1).font      = { bold: true };
        row.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
        row.getCell(1).border    = thinBorder('FFE2E8F0');

        row.getCell(2).font      = { bold: true };
        row.getCell(2).alignment = { horizontal: 'left', vertical: 'middle' };
        row.getCell(2).border    = thinBorder('FFE2E8F0');

        for (let i = 3; i <= cellObjs.length + 2; i++) {
          const cell      = row.getCell(i);
          const kind      = cellObjs[i - 3].kind;
          const isWeekend = isWeekendCol[i - 3];
          const style     = KIND_STYLE[kind];

          cell.alignment = { horizontal: 'center', vertical: 'middle' };
          cell.border    = thinBorder('FFE2E8F0');

          if (style) {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: style.bg } };
            cell.font = { color: { argb: style.fg }, bold: true };
            if (style.hardBorder) cell.border = thinBorder('FF000000'); // black outline like the grid
          } else if (isWeekend) {
            // Blank weekend cell (rare) — keep the light blue wash for consistency
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCEAFB' } };
            cell.font = { color: { argb: 'FF1D4ED8' }, bold: true };
          }
          // kind '' on a weekday (pending today) → no fill, plain cell
        }
      });

      // ── Legend (styled as a bordered table, matching the grid above) ──
      sheet.addRow([]); // spacer

      // Legend header row (indigo, like the main header)
      const legHeader = sheet.addRow(['Marker', 'Meaning']);
      [1, 2].forEach((c) => {
        const cell = legHeader.getCell(c);
        cell.font      = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
        cell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4F46E5' } }; // indigo-600
        cell.alignment = { horizontal: c === 1 ? 'center' : 'left', vertical: 'middle' };
        cell.border    = thinBorder('FF000000');
      });
      sheet.mergeCells(legHeader.number, 2, legHeader.number, Math.min(8, totalCols));
      legHeader.height = 22;

      const legendItems = [
        { mark: 'P',      kind: 'P'          },
        { mark: 'HD-LOP', kind: 'HD_LEAVE'   },
        { mark: 'HD-LOP', kind: 'HD_WORK'    },
        { mark: 'LOP',    kind: 'LOP_LEAVE'  },
        { mark: 'LOP',    kind: 'LOP_SHORT'  },
        { mark: 'LOP',    kind: 'LOP_ABSENT' },
        { mark: 'H',      kind: 'H'          },
      ];

      legendItems.forEach((item) => {
        const style = KIND_STYLE[item.kind];
        if (!style) return; // safety: skip any kind missing from KIND_STYLE

        const lr = sheet.addRow([item.mark, style.label]);
        lr.height = 20;

        const markCell = lr.getCell(1);
        markCell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: style.bg } };
        markCell.font      = { color: { argb: style.fg }, bold: true };
        markCell.alignment = { horizontal: 'center', vertical: 'middle' };
        markCell.border    = thinBorder('FF000000');

        const descCell = lr.getCell(2);
        descCell.alignment = { horizontal: 'left', vertical: 'middle' };
        descCell.font      = { size: 11, color: { argb: 'FF334155' } };
        descCell.border    = thinBorder('FF000000');
        sheet.mergeCells(lr.number, 2, lr.number, Math.min(8, totalCols));
      });

      // Column widths
      sheet.getColumn(1).width = 8;
      sheet.getColumn(2).width = 26;
      for (let i = 3; i <= dates.length + 2; i++) {
        sheet.getColumn(i).width = 8; // HD-LOP needs the extra room
      }

      // Freeze title row + header row + first two columns (serial number + employee email)
      sheet.views = [{ state: 'frozen', xSplit: 2, ySplit: 2 }];

      const buffer = await workbook.xlsx.writeBuffer();
      const blob   = new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const url  = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href  = url;
      link.setAttribute('download', `monthly_summary_${targetMonth}${selectedUser ? `_emp${selectedUser}` : ''}.xlsx`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      toast.success('Monthly summary Excel downloaded!');
    } catch {
      toast.error('Failed to generate monthly summary.');
    }
  };

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
        <div className="flex items-center justify-between gap-3 mb-6">
          <div className="flex items-center gap-3">
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
          <div className="flex items-center gap-3">
            <button onClick={exportMonthlySummaryXLSX}
              className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700
                         text-white px-4 py-2.5 rounded-xl text-sm font-semibold
                         transition-all border border-slate-700">
              <FileSpreadsheet className="w-4 h-4" />
              Monthly Summary
            </button>
            <button onClick={exportCSV} disabled={records.length === 0}
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

                      {/* Last Out — show Active if still open ✅ */}
                      <div className="text-sm text-slate-300 w-24">
                        {g.hasActive
                          ? '🟡 Active'
                          : g.lastClockOut
                            ? `🔴 ${formatTime(g.lastClockOut)}`
                            : '—'}
                      </div>

                      {/* Total Hours — active sessions show In Progress ✅ */}
                      <div className="text-sm font-bold text-white w-20">
                        {g.hasActive && g.totalMs === 0
                          ? <span className="text-amber-400 text-xs">In progress</span>
                          : formatMs(g.totalMs)}
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
                                    {formatMs(block.totalMs, true)}
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
