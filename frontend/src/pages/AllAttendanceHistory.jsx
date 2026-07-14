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

// Leave types that have a yearly balance (LOP / HD_LOP are unpaid → no limit)
const BALANCE_TYPES = ['SL', 'CL', 'PL'];

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

    if (new Date(record.clockIn) < new Date(g.firstClockIn)) {
      g.firstClockIn = record.clockIn;
    }

    if (record.clockOut) {
      if (!g.lastClockOut || new Date(record.clockOut) > new Date(g.lastClockOut)) {
        g.lastClockOut = record.clockOut;
      }
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
      current.sessions.push(session);
      if (session.clockOut) {
        current.totalMs += new Date(session.clockOut) - new Date(session.clockIn);
        if (!current.lastClockOut ||
            new Date(session.clockOut) > new Date(current.lastClockOut)) {
          current.lastClockOut = session.clockOut;
        }
      } else {
        current.hasActive = true;
      }
    } else {
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

  const formatMs = (ms, showSeconds = false) => {
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    if (showSeconds || h === 0) return `${h}h ${m}m ${s}s`;
    return `${h}h ${m}m`;
  };

  const getDuration = (clockIn, clockOut) => {
    if (!clockOut) return '—';
    return formatMs(new Date(clockOut) - new Date(clockIn), true);
  };

  const isUnusual = (sessions) => sessions.length > 5;

  // ── CSV Export ────────────────────────────────────────────
  // One row per session. Columns:
  //   Date, Employee Name, Email, Clock In, Clock Out, Duration, Location
  const exportCSV = () => {
    if (records.length === 0) {
      toast.error('No records to export.');
      return;
    }

    const fmtTime = (d) => d
      ? new Date(d).toLocaleTimeString('en-US', {
          hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true,
        })
      : '—';

    const fmtDate = (dateStr) => {
      const d     = new Date(dateStr + 'T00:00:00');
      const day   = String(d.getDate()).padStart(2, '0');
      const month = d.toLocaleString('en-US', { month: 'short' });
      const year  = d.getFullYear();
      return `${day} ${month} ${year}`;
    };

    const fmtDuration = (ms) => {
      if (!ms || ms < 0) return '0h 0m 0s';
      const h = Math.floor(ms / 3600000);
      const m = Math.floor((ms % 3600000) / 60000);
      const s = Math.floor((ms % 60000) / 1000);
      return `${h}h ${m}m ${s}s`;
    };

    const esc = (val) => {
      const str = String(val ?? '—');
      return str.includes(',') ? `"${str.replace(/"/g, '""')}"` : str;
    };

    const headers = [
      'Date', 'Employee Name', 'Email',
      'Clock In', 'Clock Out', 'Duration', 'Location',
    ];

    const rows = [];

    grouped.forEach((g) => {
      const sortedSessions = [...g.sessions].sort(
        (a, b) => new Date(a.clockIn) - new Date(b.clockIn)
      );

      sortedSessions.forEach((session) => {
        const sessionMs = session.clockOut
          ? new Date(session.clockOut) - new Date(session.clockIn)
          : null;

        rows.push([
          fmtDate(g.date),
          esc(g.user.name),
          esc(g.user.email),
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
  //
  // Day markers (weekday priority: approved leave → hours worked → absent):
  //   Weekend: worked → P, otherwise H
  //   HD_LOP leave → HD-LOP  |  LOP leave → LOP   (leave always wins)
  //   No leave, finished weekday:  <4h → LOP,  4h–5h → HD-LOP,  5h+ → P
  //   No leave, no clock-in, past weekday → LOP (absent)
  //   Today / still-active → P ;  today, no clock-in → blank
  //
  // After the day grid, three LEAVE BALANCE columns (SL / CL / PL) show the
  // employee's YEARLY position as "used / allowed" — same numbers as the
  // Leave Balances page. Used is counted in working days (weekends skipped).
  const exportMonthlySummaryXLSX = async () => {
    const targetMonth = filterType === 'month'
      ? month
      : (startDate ? startDate.slice(0, 7) : month);

    try {
      const year = parseInt(targetMonth.slice(0, 4), 10);

      const params = { month: targetMonth };
      if (selectedUser) params.userId = selectedUser;

      const leaveParams = { status: 'APPROVED' };
      if (selectedUser) leaveParams.userId = selectedUser;

      const [attendanceRes, lopRes, hdLopRes, balanceRes] = await Promise.all([
        axios.get(`${API}/attendance/history/all`, { params }),
        axios.get(`${API}/leaves`, { params: { ...leaveParams, type: 'LOP' } }),
        axios.get(`${API}/leaves`, { params: { ...leaveParams, type: 'HD_LOP' } }),
        // Leave balances are optional — if this fails, the export still works
        axios.get(`${API}/leave-balances`, { params: { year } }).catch(() => null),
      ]);

      const monthRecords   = attendanceRes.data.records;
      const monthEmployees = attendanceRes.data.employees;
      const lopLeaves      = [...lopRes.data.leaves, ...hdLopRes.data.leaves];

      // userId -> { SL: {allowed, used, remaining}, CL: {...}, PL: {...} }
      const balanceByUser = {};
      if (balanceRes?.data?.rows) {
        balanceRes.data.rows.forEach((r) => { balanceByUser[r.id] = r.balances || {}; });
      }

      // Per employee-day: total worked ms + whether a session is still open.
      const attendanceByKey = {};
      monthRecords.forEach((record) => {
        const date = toDateStr(record.clockIn);
        const key  = `${record.userId}_${date}`;
        if (!attendanceByKey[key]) attendanceByKey[key] = { totalMs: 0, hasActive: false };
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

      const FIRST_BAL_COL = 2 + dates.length + 1;             // first SL column
      const totalCols     = 2 + dates.length + BALANCE_TYPES.length;
      const monthTitle    = new Date(targetMonth + '-01').toLocaleDateString('en-US', {
        month: 'long', year: 'numeric',
      });

      const workbook = new ExcelJS.Workbook();
      const sheet    = workbook.addWorksheet('Monthly Summary');

      const thinBorder = (color) => ({
        top:    { style: 'thin', color: { argb: color } },
        left:   { style: 'thin', color: { argb: color } },
        bottom: { style: 'thin', color: { argb: color } },
        right:  { style: 'thin', color: { argb: color } },
      });

      const KIND_STYLE = {
        P:          { bg: 'FFD1FAE5', fg: 'FF047857', label: 'Present',                hardBorder: true  },
        HD_LEAVE:   { bg: 'FFFFF3C4', fg: 'FF92700A', label: 'Half Day (Approved)',    hardBorder: true  },
        HD_WORK:    { bg: 'FFF6A609', fg: 'FF5A3D00', label: 'Half Day (Short Hours)', hardBorder: true  },
        LOP_LEAVE:  { bg: 'FFFDECEA', fg: 'FFB4413A', label: 'LOP (Approved Leave)',   hardBorder: true  },
        LOP_SHORT:  { bg: 'FFF2B8B2', fg: 'FF7A2820', label: 'LOP (Short Hours)',      hardBorder: true  },
        LOP_ABSENT: { bg: 'FFEF9A93', fg: 'FF7A1C14', label: 'LOP (Absent)',           hardBorder: true  },
        H:          { bg: 'FFDCEAFB', fg: 'FF1D4ED8', label: 'Holiday / Weekend',      hardBorder: false },
      };

      // Header colour for the balance columns (violet, distinct from the day grid)
      const BAL_HEADER_BG = 'FF7C3AED';   // violet-600

      // Title row
      const titleRow = sheet.addRow([`Attendance Summary — ${monthTitle}`]);
      sheet.mergeCells(titleRow.number, 1, titleRow.number, totalCols);
      titleRow.height = 26;
      const titleCell = titleRow.getCell(1);
      titleCell.font      = { bold: true, size: 13, color: { argb: 'FFFFFFFF' } };
      titleCell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF312E81' } };
      titleCell.alignment = { horizontal: 'center', vertical: 'middle' };

      // Header row — days, then the three balance columns
      const headerRow = sheet.addRow([
        '#',
        'Employee Email',
        ...dates.map((d) => {
          const dt      = new Date(d + 'T00:00:00');
          const dayNum  = String(dt.getDate()).padStart(2, '0');
          const weekday = dt.toLocaleDateString('en-US', { weekday: 'short' });
          return `${dayNum}\n${weekday}`;
        }),
        ...BALANCE_TYPES.map((t) => `${t}\nused/total`),
      ]);

      headerRow.eachCell((cell, colNumber) => {
        const isBalanceCol = colNumber >= FIRST_BAL_COL;
        const isWeekend    = !isBalanceCol && colNumber > 2 && isWeekendCol[colNumber - 3];

        cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
        cell.fill = {
          type: 'pattern', pattern: 'solid',
          fgColor: {
            argb: isBalanceCol ? BAL_HEADER_BG
                 : isWeekend   ? 'FF2563EB'   // blue-600 weekends
                 : 'FF4F46E5',                // indigo-600 weekdays
          },
        };
        cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
        cell.border    = thinBorder(
          isBalanceCol ? 'FF000000' : (isWeekend ? 'FF334155' : 'FFE2E8F0')
        );
      });
      headerRow.getCell(1).font      = { bold: true, color: { argb: 'FFFFFFFF' } };
      headerRow.getCell(2).font      = { bold: true, color: { argb: 'FFFFFFFF' } };
      headerRow.getCell(2).alignment = { horizontal: 'left', vertical: 'middle' };
      headerRow.height = 32;

      // Data rows
      const todayStr   = toDateStr(new Date());
      const FOUR_HOURS = 4 * 60 * 60 * 1000;
      const FIVE_HOURS = 5 * 60 * 60 * 1000;

      filteredEmployees.forEach((emp, idx) => {
        const cellObjs = dates.map((date, dIdx) => {
          const key           = `${emp.id}_${date}`;
          const attendanceRow = attendanceByKey[key];
          const isWeekend     = isWeekendCol[dIdx];
          const isToday       = date === todayStr;

          if (isWeekend) {
            return attendanceRow ? { v: 'P', kind: 'P' } : { v: 'H', kind: 'H' };
          }

          const hdLopLeave = lopLeaves.some(
            (leave) => leave.user.id === emp.id
              && leave.type === 'HD_LOP'
              && leaveCoversDate(leave, date)
          );
          if (hdLopLeave) return { v: 'HD-LOP', kind: 'HD_LEAVE' };

          const lopLeave = lopLeaves.some(
            (leave) => leave.user.id === emp.id
              && leave.type === 'LOP'
              && leaveCoversDate(leave, date)
          );
          if (lopLeave) return { v: 'LOP', kind: 'LOP_LEAVE' };

          if (attendanceRow) {
            if (isToday || attendanceRow.hasActive) return { v: 'P', kind: 'P' };
            const dur = attendanceRow.totalMs;
            if (dur < FOUR_HOURS) return { v: 'LOP',    kind: 'LOP_SHORT' };
            if (dur < FIVE_HOURS) return { v: 'HD-LOP', kind: 'HD_WORK'   };
            return { v: 'P', kind: 'P' };
          }

          if (isToday) return { v: '', kind: '' };
          return { v: 'LOP', kind: 'LOP_ABSENT' };
        });

        // ── Leave balance cells: "used / allowed" per type ──
        const bal = balanceByUser[emp.id] || {};
        const balCells = BALANCE_TYPES.map((t) => {
          const b = bal[t];
          if (!b || b.allowed === null || b.allowed === undefined) {
            // No allowance set — still show what they've used, if anything
            return { v: b?.used ? `${b.used} / —` : '—', state: 'unset' };
          }
          const state = b.remaining < 0 ? 'over'
                      : b.remaining <= 2 ? 'low'
                      : 'ok';
          return { v: `${b.used} / ${b.allowed}`, state };
        });

        const row = sheet.addRow([
          idx + 1,
          emp.email,
          ...cellObjs.map((c) => c.v),
          ...balCells.map((c) => c.v),
        ]);

        row.getCell(1).font      = { bold: true };
        row.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
        row.getCell(1).border    = thinBorder('FFE2E8F0');

        row.getCell(2).font      = { bold: true };
        row.getCell(2).alignment = { horizontal: 'left', vertical: 'middle' };
        row.getCell(2).border    = thinBorder('FFE2E8F0');

        // Day cells
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
            if (style.hardBorder) cell.border = thinBorder('FF000000');
          } else if (isWeekend) {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCEAFB' } };
            cell.font = { color: { argb: 'FF1D4ED8' }, bold: true };
          }
        }

        // Balance cells — coloured by how much is left
        const BAL_STATE_STYLE = {
          ok:    { bg: 'FFEDE9FE', fg: 'FF5B21B6' },  // violet tint — healthy
          low:   { bg: 'FFFEF3C7', fg: 'FF92700A' },  // amber — 2 or fewer left
          over:  { bg: 'FFFECACA', fg: 'FF991B1B' },  // red — over the limit
          unset: { bg: 'FFF1F5F9', fg: 'FF94A3B8' },  // grey — no allowance set
        };

        balCells.forEach((c, bIdx) => {
          const cell  = row.getCell(FIRST_BAL_COL + bIdx);
          const style = BAL_STATE_STYLE[c.state];
          cell.alignment = { horizontal: 'center', vertical: 'middle' };
          cell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: style.bg } };
          cell.font      = { color: { argb: style.fg }, bold: true, size: 10 };
          cell.border    = thinBorder('FF000000');
        });
      });

      // ── Legend ──
      sheet.addRow([]); // spacer

      const legHeader = sheet.addRow(['Marker', 'Meaning']);
      [1, 2].forEach((c) => {
        const cell = legHeader.getCell(c);
        cell.font      = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
        cell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4F46E5' } };
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
        if (!style) return;

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

      // Leave-balance note under the legend
      sheet.addRow([]);
      const balNote = sheet.addRow([
        'SL / CL / PL',
        `Leave balance for ${year} — shown as "used / total". Remaining = total - used. `
        + 'Counted in working days (weekends excluded). "—" means no allowance has been set. '
        + 'LOP and HD-LOP are unpaid and have no balance.',
      ]);
      balNote.height = 32;
      const bnMark = balNote.getCell(1);
      bnMark.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEDE9FE' } };
      bnMark.font      = { color: { argb: 'FF5B21B6' }, bold: true };
      bnMark.alignment = { horizontal: 'center', vertical: 'middle' };
      bnMark.border    = thinBorder('FF000000');

      const bnDesc = balNote.getCell(2);
      bnDesc.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
      bnDesc.font      = { size: 10, color: { argb: 'FF334155' } };
      bnDesc.border    = thinBorder('FF000000');
      sheet.mergeCells(balNote.number, 2, balNote.number, Math.min(10, totalCols));

      // Column widths
      sheet.getColumn(1).width = 8;
      sheet.getColumn(2).width = 26;
      for (let i = 3; i <= dates.length + 2; i++) sheet.getColumn(i).width = 8;
      for (let i = 0; i < BALANCE_TYPES.length; i++) {
        sheet.getColumn(FIRST_BAL_COL + i).width = 11;   // "12 / 12" needs room
      }

      // Freeze title + header rows and the first two columns
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
                    <div
                      onClick={() => toggleExpand(g.key)}
                      className={`flex items-center justify-between px-6 py-4
                                 cursor-pointer transition-colors
                                 ${unusual
                                   ? 'hover:bg-red-950/20 border-l-2 border-red-500/50'
                                   : 'hover:bg-slate-800/50'}`}
                    >
                      <div className="flex items-center gap-3 w-48">
                        <div className="w-9 h-9 bg-indigo-600 rounded-full flex items-center justify-center font-bold text-sm flex-shrink-0">
                          {g.user.name.charAt(0)}
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-medium text-white">{g.user.name}</p>
                            {unusual && (
                              <span className="text-xs text-red-400" title="Unusual activity">⚠️</span>
                            )}
                          </div>
                          <p className="text-xs text-slate-400">{g.user.email}</p>
                        </div>
                      </div>

                      <div className="text-sm text-slate-300 w-28">{formatDate(g.date)}</div>

                      <div className="text-sm text-slate-300 w-24">
                        🟢 {formatTime(g.firstClockIn)}
                      </div>

                      <div className="text-sm text-slate-300 w-24">
                        {g.hasActive
                          ? '🟡 Active'
                          : g.lastClockOut
                            ? `🔴 ${formatTime(g.lastClockOut)}`
                            : '—'}
                      </div>

                      <div className="text-sm font-bold text-white w-20">
                        {g.hasActive && g.totalMs === 0
                          ? <span className="text-amber-400 text-xs">In progress</span>
                          : formatMs(g.totalMs)}
                      </div>

                      <div className={`text-xs w-24 ${unusual ? 'text-red-400' : 'text-slate-400'}`}>
                        {g.sessions.length} session{g.sessions.length > 1 ? 's' : ''}
                        {unusual && ' ⚠️'}
                      </div>

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

                      <div className="text-slate-400 w-6">
                        {expanded[g.key]
                          ? <ChevronUp className="w-4 h-4" />
                          : <ChevronDown className="w-4 h-4" />}
                      </div>
                    </div>

                    {expanded[g.key] && (
                      <div className="bg-slate-950 border-t border-slate-800 px-6 py-4">
                        {unusual && (
                          <div className="mb-4 px-4 py-3 bg-red-500/10 border border-red-500/20 rounded-xl">
                            <p className="text-red-400 text-sm font-medium">⚠️ Unusual Activity</p>
                            <p className="text-slate-400 text-xs mt-1">
                              {g.sessions.length} sessions in one day.
                              All sessions are recorded accurately. Review if needed.
                            </p>
                          </div>
                        )}

                        <p className="text-xs text-slate-500 uppercase tracking-widest mb-4">
                          Work Blocks — {formatDate(g.date)}
                        </p>

                        <div className="space-y-4">
                          {workBlocks.map((block, bi) => (
                            <div key={bi} className="bg-slate-900 rounded-xl overflow-hidden">
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
                                  <p className="text-xs text-slate-500">gaps not counted</p>
                                </div>
                              </div>

                              <div className="divide-y divide-slate-800/50">
                                {block.sessions.map((session, si) => (
                                  <div key={session.id} className="flex items-center gap-4 px-4 py-2.5">
                                    <span className="text-xs text-slate-600 w-5">{si + 1}</span>
                                    <span className="text-xs text-slate-400">
                                      {formatTime(session.clockIn)}
                                      &nbsp;→&nbsp;
                                      {session.clockOut ? formatTime(session.clockOut) : 'Active'}
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

                        <div className="mt-4 pt-3 border-t border-slate-800 flex justify-between items-center">
                          <span className="text-xs text-slate-500">
                            {g.sessions.length} raw session{g.sessions.length > 1 ? 's' : ''}
                            &nbsp;→&nbsp;
                            {workBlocks.length} work block{workBlocks.length > 1 ? 's' : ''}
                          </span>
                          <span className="text-sm text-slate-400">
                            Total worked:&nbsp;
                            <span className="text-white font-bold">{formatMs(g.totalMs)}</span>
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