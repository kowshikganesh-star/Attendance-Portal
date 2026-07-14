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

// Leave types that have a yearly balance (LOP / HD_LOP are unpaid → no limit)
const BALANCE_TYPES = ['SL', 'CL', 'PL'];

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
        firstLocation: record.location || null,
        totalMs:       0,
        hasActive:     false,
      };
    }

    const g = grouped[key];

    if (new Date(record.clockIn) < new Date(g.firstClockIn)) {
      g.firstClockIn  = record.clockIn;
      g.firstLocation = record.location || null;
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

  return grouped;
};

// ── Which calendar dates should we produce rows for? Never future dates ──
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
// Still builds every combination (the exports rely on this), but the on-screen
// table below only DISPLAYS the rows where the employee actually signed in.
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
  const currentMonth = today.slice(0, 7);

  const [month,        setMonth]        = useState(currentMonth);
  const [selectedDate, setSelectedDate] = useState('');
  const [selectedUser, setSelectedUser] = useState('');
  const [records,      setRecords]      = useState([]);
  const [lopLeaves,    setLopLeaves]    = useState([]);
  const [employees,    setEmployees]    = useState([]);
  const [loading,      setLoading]      = useState(true);

  const fetchMonth = selectedDate ? selectedDate.slice(0, 7) : month;

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

  // ── CSV Export (unchanged — already exports sign-ins only) ──
  const exportCSV = () => {
    const signedInRows = grouped.filter((g) => g.attendance === 'P');

    if (signedInRows.length === 0) {
      toast.error('No sign-ins to export.');
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
      'Date', 'Employee Name', 'Email', 'Attendance',
      'First Clock In', 'Last Clock Out', 'Status', 'Total Duration', 'Location',
    ];

    const rows = signedInRows.map((g) => [
      fmtDateCSV(g.date),
      esc(g.name),
      esc(g.email),
      g.attendance,
      fmtTimeCSV(g.firstClockIn),
      g.lastClockOut ? fmtTimeCSV(g.lastClockOut) : 'Active',
      g.hasActive ? 'Active' : 'Complete',
      fmtDurCSV(g.totalMs) || '—',
      esc(g.firstLocation || '—'),
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

  // ── Monthly Summary Export (unchanged — still covers every employee/day) ──
  //
  // Day markers (weekday priority: approved leave → hours worked → absent):
  //   Weekend: worked → P, otherwise H
  //   HD_LOP leave → HD-LOP  |  LOP leave → LOP   (leave always wins)
  //   No leave, finished weekday:  <4h → LOP,  4h–5h → HD-LOP,  5h+ → P
  //   No leave, no clock-in, past weekday → LOP (absent)
  //   Today / still-active → P ;  today, no clock-in → blank
  //
  // After the day grid, three LEAVE BALANCE columns (SL / CL / PL) show the
  // employee's YEARLY position as "used / allowed".
  const exportMonthlySummaryXLSX = async () => {
    const dates = getDatesToEnumerate(fetchMonth, ''); // full month, ignoring the date filter

    if (dates.length === 0) {
      toast.error('No days to export for this month.');
      return;
    }

    try {
      const year = parseInt(fetchMonth.slice(0, 4), 10);

      const balanceRes = await axios
        .get(`${API}/leave-balances`, { params: { year } })
        .catch(() => null);

      const balanceByUser = {};
      if (balanceRes?.data?.rows) {
        balanceRes.data.rows.forEach((r) => { balanceByUser[r.id] = r.balances || {}; });
      }

      const filteredEmployees = selectedUser
        ? employees.filter((e) => e.id === parseInt(selectedUser))
        : employees;

      const isWeekendCol = dates.map((d) => {
        const day = new Date(d + 'T00:00:00').getDay(); // 0 = Sun, 6 = Sat
        return day === 0 || day === 6;
      });

      const FIRST_BAL_COL = 2 + dates.length + 1;
      const totalCols     = 2 + dates.length + BALANCE_TYPES.length;
      const monthTitle    = new Date(fetchMonth + '-01').toLocaleDateString('en-US', {
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

      const BAL_HEADER_BG = 'FF7C3AED';

      const titleRow = sheet.addRow([`Attendance Summary — ${monthTitle}`]);
      sheet.mergeCells(titleRow.number, 1, titleRow.number, totalCols);
      titleRow.height = 26;
      const titleCell = titleRow.getCell(1);
      titleCell.font      = { bold: true, size: 13, color: { argb: 'FFFFFFFF' } };
      titleCell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF312E81' } };
      titleCell.alignment = { horizontal: 'center', vertical: 'middle' };

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
            argb: isBalanceCol ? BAL_HEADER_BG : isWeekend ? 'FF2563EB' : 'FF4F46E5',
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

        const bal = balanceByUser[emp.id] || {};
        const balCells = BALANCE_TYPES.map((t) => {
          const b = bal[t];
          if (!b || b.allowed === null || b.allowed === undefined) {
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

        const BAL_STATE_STYLE = {
          ok:    { bg: 'FFEDE9FE', fg: 'FF5B21B6' },
          low:   { bg: 'FFFEF3C7', fg: 'FF92700A' },
          over:  { bg: 'FFFECACA', fg: 'FF991B1B' },
          unset: { bg: 'FFF1F5F9', fg: 'FF94A3B8' },
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
      sheet.addRow([]);

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

      sheet.getColumn(1).width = 8;
      sheet.getColumn(2).width = 26;
      for (let i = 3; i <= dates.length + 2; i++) sheet.getColumn(i).width = 8;
      for (let i = 0; i < BALANCE_TYPES.length; i++) {
        sheet.getColumn(FIRST_BAL_COL + i).width = 11;
      }

      sheet.views = [{ state: 'frozen', xSplit: 2, ySplit: 2 }];

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
    } catch {
      toast.error('Failed to generate monthly summary.');
    }
  };

  const attendanceByKey = groupByDay(records);
  const datesToShow     = getDatesToEnumerate(fetchMonth, selectedDate);
  const grouped         = buildReportRows(attendanceByKey, lopLeaves, employees, datesToShow, selectedUser);

  // ── UI ONLY: the on-screen table shows sign-ins only. ──
  // The exports above still use `grouped` (every employee × every day), so
  // nothing about the Excel / CSV output changes.
  const signedIn = grouped.filter((g) => g.attendance === 'P');

  // Summary stats — based on the sign-ins actually shown in the table
  const totalDays      = signedIn.length;
  const totalEmployees = [...new Set(signedIn.map((g) => g.userId))].length;
  const totalMs        = signedIn.reduce((acc, g) => acc + g.totalMs, 0);
  const activeDays     = signedIn.filter((g) => g.hasActive).length;

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
                Sign-in records — {rangeLabel}
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
            <button onClick={exportCSV} disabled={signedIn.length === 0}
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
            { label: 'Sign-in Records', value: totalDays,         color: 'text-white'       },
            { label: 'Employees',       value: totalEmployees,    color: 'text-indigo-400'  },
            { label: 'Total Hours',     value: formatMs(totalMs), color: 'text-emerald-400' },
            { label: 'Still Active',    value: activeDays,        color: 'text-amber-400'   },
          ].map(({ label, value, color }) => (
            <div key={label} className="bg-slate-900 border border-slate-800 rounded-xl p-5">
              <p className="text-slate-400 text-xs mb-1">{label}</p>
              <p className={`text-2xl font-bold ${color}`}>{value}</p>
            </div>
          ))}
        </div>

        {/* Table — sign-ins only */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-800 flex items-center gap-2 flex-wrap">
            <TrendingUp className="w-5 h-5 text-slate-400" />
            <h2 className="font-semibold">Daily Records</h2>
            <span className="text-xs bg-slate-700 text-slate-300 px-2 py-0.5 rounded-full">
              {signedIn.length} records
            </span>
            <span className="text-xs text-slate-500 ml-2">
              only employees who signed in
            </span>
          </div>

          {loading ? (
            <div className="flex justify-center py-12">
              <div className="w-8 h-8 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : signedIn.length === 0 ? (
            <div className="text-center py-12 text-slate-500">
              <Calendar className="w-10 h-10 mx-auto mb-2 opacity-30" />
              <p>No sign-ins found for {rangeLabel}.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-800 text-left">
                    {[
                      'Employee', 'Date', 'First Clock In', 'Last Clock Out',
                      'Attendance', 'Total Duration', 'Location', 'Status',
                    ].map((h) => (
                      <th key={h}
                        className="px-5 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {signedIn.map((g) => (
                    <tr key={g.key} className="hover:bg-slate-800/50 transition-colors">

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

                      <td className="px-5 py-4 text-sm text-slate-300 whitespace-nowrap">
                        {formatDate(g.date)}
                      </td>

                      <td className="px-5 py-4 text-sm font-medium text-emerald-400 whitespace-nowrap">
                        🟢 {formatTime(g.firstClockIn)}
                      </td>

                      <td className="px-5 py-4 text-sm text-slate-300 whitespace-nowrap">
                        {g.hasActive
                          ? <span className="text-amber-400">🟡 Active</span>
                          : g.lastClockOut
                            ? `🔴 ${formatTime(g.lastClockOut)}`
                            : '—'}
                      </td>

                      <td className="px-5 py-4">
                        <span className="inline-flex items-center gap-1 text-xs bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 px-2.5 py-1 rounded-full font-medium">
                          P
                        </span>
                      </td>

                      <td className="px-5 py-4">
                        <span className={`text-sm font-bold
                          ${g.totalMs > 0 ? 'text-white' : 'text-slate-500'}`}>
                          {g.hasActive && g.totalMs === 0
                            ? <span className="text-amber-400 text-xs font-normal">In progress</span>
                            : formatMs(g.totalMs, true)}
                        </span>
                      </td>

                      <td className="px-5 py-4 text-sm text-slate-400 max-w-xs">
                        {g.firstLocation
                          ? <span className="truncate block max-w-48" title={g.firstLocation}>
                              📍 {g.firstLocation}
                            </span>
                          : <span className="text-slate-600">—</span>}
                      </td>

                      <td className="px-5 py-4">
                        {g.hasActive ? (
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