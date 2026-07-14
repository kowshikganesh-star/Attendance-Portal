// src/pages/LeaveBalances.jsx
import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import ExcelJS from 'exceljs';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import toast, { Toaster } from 'react-hot-toast';
import {
  ShieldCheck, LogOut, ArrowLeft, Search, Scale,
  Edit2, Users, X, AlertTriangle, Upload, FileSpreadsheet, Download,
} from 'lucide-react';

const API = import.meta.env.VITE_API_URL;

const TYPES = ['SL', 'CL', 'PL'];
const TYPE_LABEL = {
  SL: 'SL — Sick Leave',
  CL: 'CL — Casual Leave',
  PL: 'PL — Privileged Leave',
};
const TYPE_COLOR = {
  SL: 'text-rose-400',
  CL: 'text-indigo-400',
  PL: 'text-violet-400',
};

const Modal = ({ title, onClose, children, wide = false }) => (
  <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
    <div className={`bg-slate-900 border border-slate-700 rounded-2xl w-full shadow-2xl
                     max-h-[90vh] overflow-y-auto ${wide ? 'max-w-2xl' : 'max-w-md'}`}>
      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 sticky top-0 bg-slate-900">
        <h3 className="font-semibold text-white">{title}</h3>
        <button onClick={onClose}
          className="text-slate-400 hover:text-white p-1 hover:bg-slate-800 rounded-lg transition-all">
          <X className="w-5 h-5" />
        </button>
      </div>
      <div className="p-6">{children}</div>
    </div>
  </div>
);

const inputCls = `w-full px-4 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-white
  text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all`;

// ── File parsing helpers (same approach as the user import) ──
const cellToString = (val) => {
  if (val === null || val === undefined) return '';
  if (typeof val === 'object') {
    if (typeof val.text === 'string') return val.text.trim();
    if (Array.isArray(val.richText))  return val.richText.map((r) => r.text).join('').trim();
    if (val.result !== undefined)     return String(val.result).trim();
    if (typeof val.hyperlink === 'string') return val.hyperlink.replace(/^mailto:/i, '').trim();
    return '';
  }
  return String(val).trim();
};
const cleanEmail = (s) => cellToString(s).replace(/^mailto:/i, '').trim();

const normHeader = (h) => cellToString(h).toLowerCase().replace(/\s+/g, ' ');
const HEADER_ALIASES = {
  email: ['email', 'email address'],
  SL:    ['sl', 'sick leave', 'sl allowance'],
  CL:    ['cl', 'casual leave', 'cl allowance'],
  PL:    ['pl', 'privileged leave', 'pl allowance'],
};
const headerMatches = (h, field) => HEADER_ALIASES[field].includes(normHeader(h));

const splitCsvLine = (line) => {
  const out = [];
  let cur = '', inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
};

// Read .xlsx or .csv → { headerCells, dataRows }
const readFileGrid = async (file) => {
  const lower = file.name.toLowerCase();
  if (lower.endsWith('.csv')) {
    const text  = await file.text();
    const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
    if (lines.length === 0) throw new Error('The file is empty.');
    return { headerCells: splitCsvLine(lines[0]), dataRows: lines.slice(1).map(splitCsvLine) };
  }
  if (lower.endsWith('.xlsx')) {
    const buffer   = await file.arrayBuffer();
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const sheet = workbook.worksheets[0];
    if (!sheet) throw new Error('The file has no sheets.');

    const headerCells = [];
    sheet.getRow(1).eachCell((cell, col) => { headerCells[col - 1] = cell.value; });

    const dataRows = [];
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      const arr = [];
      for (let c = 1; c <= headerCells.length; c++) arr[c - 1] = row.getCell(c).value;
      dataRows.push(arr);
    });
    return { headerCells, dataRows };
  }
  throw new Error('Unsupported file type. Please upload a .xlsx or .csv file.');
};

// One "allowed / used / remaining" cell
const BalanceCell = ({ bal }) => {
  if (!bal || bal.allowed === null || bal.allowed === undefined) {
    return (
      <div className="text-center">
        <span className="text-xs text-slate-600">not set</span>
        {bal?.used > 0 && <p className="text-xs text-amber-400 mt-0.5">{bal.used} used</p>}
      </div>
    );
  }

  const { allowed, used, remaining } = bal;
  const negative = remaining < 0;
  const low      = remaining >= 0 && remaining <= 2;

  return (
    <div className="text-center">
      <p className={`text-lg font-bold ${
        negative ? 'text-red-400' : low ? 'text-amber-400' : 'text-emerald-400'
      }`}>
        {remaining}
      </p>
      <p className="text-xs text-slate-500">{used} / {allowed}</p>
      {negative && <p className="text-[10px] text-red-400 mt-0.5">over limit</p>}
    </div>
  );
};

const LeaveBalances = () => {
  const { user, logout } = useAuth();
  const navigate         = useNavigate();

  const thisYear = new Date().getFullYear();

  const [rows,      setRows]      = useState([]);
  const [year,      setYear]      = useState(thisYear);
  const [loading,   setLoading]   = useState(true);
  const [search,    setSearch]    = useState('');
  const [editModal, setEditModal] = useState(null);
  const [editForm,  setEditForm]  = useState({ SL: '', CL: '', PL: '' });
  const [bulkModal, setBulkModal] = useState(false);
  const [bulkForm,  setBulkForm]  = useState({ SL: '', CL: '', PL: '' });
  const [submitting, setSubmitting] = useState(false);

  // Import state
  const [importModal, setImportModal] = useState(false);
  const [impRows,     setImpRows]     = useState([]);
  const [impResult,   setImpResult]   = useState(null);
  const [importing,   setImporting]   = useState(false);
  const [impError,    setImpError]    = useState('');
  const [impFile,     setImpFile]     = useState('');

  const fetchBalances = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await axios.get(`${API}/leave-balances`, { params: { year } });
      setRows(data.rows);
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Failed to load leave balances.');
    } finally {
      setLoading(false);
    }
  }, [year]);

  useEffect(() => { fetchBalances(); }, [fetchBalances]);

  const openEdit = (row) => {
    setEditModal(row);
    setEditForm({
      SL: row.balances?.SL?.allowed ?? '',
      CL: row.balances?.CL?.allowed ?? '',
      PL: row.balances?.PL?.allowed ?? '',
    });
  };

  const handleSaveEdit = async () => {
    setSubmitting(true);
    try {
      const allowances = {};
      TYPES.forEach((t) => {
        allowances[t] = editForm[t] === '' ? null : parseInt(editForm[t]);
      });
      const { data } = await axios.put(
        `${API}/leave-balances/user/${editModal.id}`, { year, allowances }
      );
      toast.success(data.message);
      setEditModal(null);
      fetchBalances();
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Failed to update allowances.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleBulkSet = async () => {
    const allowances = {};
    TYPES.forEach((t) => { if (bulkForm[t] !== '') allowances[t] = parseInt(bulkForm[t]); });

    if (Object.keys(allowances).length === 0) {
      toast.error('Enter at least one allowance.');
      return;
    }

    setSubmitting(true);
    try {
      const { data } = await axios.post(`${API}/leave-balances/bulk`, { year, allowances });
      toast.success(data.message);
      setBulkModal(false);
      setBulkForm({ SL: '', CL: '', PL: '' });
      fetchBalances();
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Failed to set allowances.');
    } finally {
      setSubmitting(false);
    }
  };

  // ── Import: read the file ──
  const resetImport = () => { setImpRows([]); setImpResult(null); setImpError(''); setImpFile(''); };

  const handleFilePicked = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    resetImport();
    setImpFile(file.name);

    try {
      const { headerCells, dataRows } = await readFileGrid(file);

      let emailCol = -1;
      const typeCols = {};
      headerCells.forEach((h, i) => {
        if (headerMatches(h, 'email')) emailCol = i;
        TYPES.forEach((t) => { if (headerMatches(h, t)) typeCols[t] = i; });
      });

      if (emailCol === -1) throw new Error('Could not find an "email" column in the first row.');
      if (Object.keys(typeCols).length === 0) {
        throw new Error('Could not find any of the "SL", "CL", or "PL" columns.');
      }

      const parsed = [];
      for (const r of dataRows) {
        const email = cleanEmail(r[emailCol] ?? '');
        const row   = { email };
        TYPES.forEach((t) => {
          if (t in typeCols) row[t] = cellToString(r[typeCols[t]] ?? '');
        });
        // keep the row if it has an email or any value
        if (email || TYPES.some((t) => row[t])) parsed.push(row);
      }

      if (parsed.length === 0) throw new Error('No data rows found under the headers.');
      setImpRows(parsed);
    } catch (err) {
      setImpError(err?.message || 'Could not read the file.');
    }
  };

  const submitImport = async () => {
    if (impRows.length === 0) return;
    setImporting(true);
    try {
      const { data } = await axios.post(`${API}/leave-balances/import`, { year, rows: impRows });
      setImpResult(data.summary);
      toast.success(data.message);
      fetchBalances();
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Import failed.');
    } finally {
      setImporting(false);
    }
  };

  const closeImport = () => { setImportModal(false); resetImport(); };

  const downloadTemplate = async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet    = workbook.addWorksheet('Leave Allowances');
    sheet.addRow(['email', 'SL', 'CL', 'PL']);
    sheet.addRow(['john.doe@handigital.com', 12, 12, 5]);
    sheet.addRow(['jane.doe@handigital.com', 12, 12, '']);   // blank PL = leave untouched
    sheet.getRow(1).font = { bold: true };
    [34, 8, 8, 8].forEach((w, i) => { sheet.getColumn(i + 1).width = w; });

    const buffer = await workbook.xlsx.writeBuffer();
    const blob   = new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const url  = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href  = url;
    link.setAttribute('download', 'leave_allowances_template.xlsx');
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
  };

  const filtered = rows.filter((r) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      r.name.toLowerCase().includes(q) ||
      r.email.toLowerCase().includes(q) ||
      (r.employeeId || '').toLowerCase().includes(q)
    );
  });

  const notSetCount = rows.filter((r) =>
    TYPES.every((t) => r.balances?.[t]?.allowed === null || r.balances?.[t]?.allowed === undefined)
  ).length;

  const overCount = rows.filter((r) =>
    TYPES.some((t) => {
      const b = r.balances?.[t];
      return b && b.remaining !== null && b.remaining < 0;
    })
  ).length;

  const years = [thisYear + 1, thisYear, thisYear - 1, thisYear - 2];

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
        <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate('/admin/dashboard')}
              className="p-2 hover:bg-slate-800 rounded-lg transition-all text-slate-400 hover:text-white">
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div>
              <h1 className="text-2xl font-bold">Leave Balances</h1>
              <p className="text-slate-400 text-sm">
                Set yearly allowances. Balance = allowed − used (working days).
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <select value={year} onChange={(e) => setYear(parseInt(e.target.value))}
              className="px-4 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-white text-sm
                         focus:outline-none focus:ring-2 focus:ring-indigo-500">
              {years.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
            <button onClick={() => { resetImport(); setImportModal(true); }}
              className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700
                         text-white px-4 py-2.5 rounded-xl text-sm font-semibold transition-all
                         border border-slate-700">
              <Upload className="w-4 h-4" /> Import Allowances
            </button>
            <button onClick={() => setBulkModal(true)}
              className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500
                         text-white px-4 py-2.5 rounded-xl text-sm font-semibold transition-all
                         shadow-lg shadow-indigo-600/20">
              <Users className="w-4 h-4" /> Set for Everyone
            </button>
          </div>
        </div>

        {/* Note about LOP */}
        <div className="mb-6 px-4 py-3 bg-slate-900 border border-slate-800 rounded-xl">
          <p className="text-xs text-slate-400">
            <span className="text-slate-300 font-medium">LOP</span> and
            <span className="text-slate-300 font-medium"> HD-LOP</span> are loss-of-pay (unpaid) —
            they have no limit and are not tracked here. Only
            <span className="text-rose-400 font-medium"> SL</span>,
            <span className="text-indigo-400 font-medium"> CL</span>, and
            <span className="text-violet-400 font-medium"> PL</span> have balances.
            Weekends are not counted against leave.
          </p>
        </div>

        {/* Search */}
        <div className="flex gap-3 mb-6 flex-wrap">
          <div className="relative flex-1 min-w-60">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input type="text" placeholder="Search by name, email, or employee ID..."
              value={search} onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-slate-900 border border-slate-800 rounded-xl
                         text-white text-sm placeholder-slate-500
                         focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
            />
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          {[
            { label: 'Employees',        value: rows.length,  color: 'text-white' },
            { label: 'No Allowance Set', value: notSetCount,  color: 'text-amber-400' },
            { label: 'Over Limit',       value: overCount,    color: 'text-red-400' },
          ].map(({ label, value, color }) => (
            <div key={label} className="bg-slate-900 border border-slate-800 rounded-xl p-4">
              <p className="text-slate-400 text-xs">{label}</p>
              <p className={`text-2xl font-bold mt-1 ${color}`}>{value}</p>
            </div>
          ))}
        </div>

        {/* Table */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-800 flex items-center gap-2 flex-wrap">
            <Scale className="w-5 h-5 text-slate-400" />
            <h2 className="font-semibold">Balances — {year}</h2>
            <span className="text-xs bg-slate-700 text-slate-300 px-2 py-0.5 rounded-full">
              {filtered.length} employees
            </span>
            <span className="text-xs text-slate-500 ml-2">
              big number = remaining · small = used / allowed
            </span>
          </div>

          {loading ? (
            <div className="flex justify-center py-12">
              <div className="w-8 h-8 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-12 text-slate-500"><p>No employees found.</p></div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-800 text-left">
                    <th className="px-6 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">
                      Employee
                    </th>
                    <th className="px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">
                      Emp ID
                    </th>
                    {TYPES.map((t) => (
                      <th key={t} className={`px-4 py-3 text-xs font-medium uppercase tracking-wider text-center ${TYPE_COLOR[t]}`}>
                        {t}
                      </th>
                    ))}
                    <th className="px-6 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider text-right">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {filtered.map((row) => (
                    <tr key={row.id}
                      className={`hover:bg-slate-800/50 transition-colors ${!row.isActive ? 'opacity-50' : ''}`}>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 bg-indigo-600 rounded-full flex items-center justify-center font-bold text-sm flex-shrink-0">
                            {row.name.charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <p className="font-medium text-white text-sm">{row.name}</p>
                            <p className="text-xs text-slate-400">{row.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-4">
                        {row.employeeId
                          ? <span className="text-sm font-mono text-slate-300">{row.employeeId}</span>
                          : <span className="text-xs text-slate-600">—</span>}
                      </td>
                      {TYPES.map((t) => (
                        <td key={t} className="px-4 py-4">
                          <BalanceCell bal={row.balances?.[t]} />
                        </td>
                      ))}
                      <td className="px-6 py-4 text-right">
                        <button onClick={() => openEdit(row)} title="Edit allowances"
                          className="p-2 text-slate-400 hover:text-indigo-400 hover:bg-slate-700 rounded-lg transition-all">
                          <Edit2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>

      {/* Edit one employee */}
      {editModal && (
        <Modal title={`Allowances — ${editModal.name}`} onClose={() => setEditModal(null)}>
          <div className="space-y-4">
            <p className="text-slate-400 text-sm">
              Set the yearly allowance for <span className="text-white">{year}</span>.
              Leave a field blank to remove that allowance.
            </p>

            {TYPES.map((t) => {
              const bal = editModal.balances?.[t];
              return (
                <div key={t}>
                  <label className="block text-sm font-medium text-slate-300 mb-1.5">
                    <span className={TYPE_COLOR[t]}>{TYPE_LABEL[t]}</span>
                    {bal?.used > 0 && (
                      <span className="text-xs text-slate-500 ml-2">({bal.used} already used)</span>
                    )}
                  </label>
                  <input type="number" min="0" placeholder="e.g. 12"
                    value={editForm[t]}
                    onChange={(e) => setEditForm((p) => ({ ...p, [t]: e.target.value }))}
                    className={inputCls} />
                </div>
              );
            })}

            <div className="flex gap-3 pt-2">
              <button onClick={() => setEditModal(null)}
                className="flex-1 py-2.5 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-sm transition-all">
                Cancel
              </button>
              <button onClick={handleSaveEdit} disabled={submitting}
                className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50
                           text-white rounded-xl text-sm font-semibold transition-all">
                {submitting ? 'Saving...' : 'Save Allowances'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Bulk set for everyone */}
      {bulkModal && (
        <Modal title="Set Allowances for Everyone" onClose={() => setBulkModal(false)} wide>
          <div className="space-y-4">
            <div className="p-4 bg-amber-500/10 border border-amber-500/20 rounded-xl flex gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-amber-400 text-sm font-medium mb-1">This applies to all active employees</p>
                <p className="text-slate-300 text-xs">
                  Every active employee's allowance for <span className="text-white font-semibold">{year}</span> will
                  be set to these values, overwriting anything already set.
                  Leave a field blank to leave that type untouched.
                </p>
              </div>
            </div>

            {TYPES.map((t) => (
              <div key={t}>
                <label className="block text-sm font-medium text-slate-300 mb-1.5">
                  <span className={TYPE_COLOR[t]}>{TYPE_LABEL[t]}</span>
                </label>
                <input type="number" min="0" placeholder="Leave blank to skip"
                  value={bulkForm[t]}
                  onChange={(e) => setBulkForm((p) => ({ ...p, [t]: e.target.value }))}
                  className={inputCls} />
              </div>
            ))}

            <div className="flex gap-3 pt-2">
              <button onClick={() => setBulkModal(false)}
                className="flex-1 py-2.5 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-sm transition-all">
                Cancel
              </button>
              <button onClick={handleBulkSet} disabled={submitting}
                className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50
                           text-white rounded-xl text-sm font-semibold transition-all">
                {submitting ? 'Applying...' : 'Apply to All Employees'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* ══════════ Import allowances from a file ══════════ */}
      {importModal && (
        <Modal title={`Import Leave Allowances — ${year}`} onClose={closeImport} wide>
          <div className="space-y-5">

            <div className="p-4 bg-slate-800/50 border border-slate-700 rounded-xl text-sm text-slate-300">
              <p className="mb-2">
                Upload an <span className="font-semibold">.xlsx</span> or
                <span className="font-semibold"> .csv</span> with columns:
                <span className="font-mono text-indigo-300"> email</span>,
                <span className="font-mono text-rose-300"> SL</span>,
                <span className="font-mono text-indigo-300"> CL</span>,
                <span className="font-mono text-violet-300"> PL</span>.
              </p>
              <p className="text-slate-400 text-xs">
                Matched by email. Set different allowances per employee. A blank cell leaves that
                leave type untouched. Applies to the year selected above
                (<span className="text-white font-medium">{year}</span>).
              </p>
              <button onClick={downloadTemplate}
                className="mt-3 inline-flex items-center gap-2 text-xs text-indigo-400 hover:text-indigo-300">
                <Download className="w-3.5 h-3.5" /> Download template
              </button>
            </div>

            {!impResult && (
              <div>
                <label className="flex items-center justify-center gap-3 px-4 py-6 border-2 border-dashed border-slate-700 rounded-xl cursor-pointer hover:border-indigo-500 hover:bg-slate-800/40 transition-all">
                  <FileSpreadsheet className="w-6 h-6 text-slate-400" />
                  <span className="text-sm text-slate-300">
                    {impRows.length > 0
                      ? `${impFile} — ${impRows.length} rows ready`
                      : 'Click to choose an .xlsx or .csv file'}
                  </span>
                  <input type="file" accept=".xlsx,.csv" className="hidden" onChange={handleFilePicked} />
                </label>
                {impError && <p className="mt-2 text-sm text-red-400">{impError}</p>}

                {impRows.length > 0 && (
                  <div className="mt-4 max-h-48 overflow-y-auto border border-slate-800 rounded-xl">
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 bg-slate-800">
                        <tr>
                          <th className="px-4 py-2 text-left text-xs text-slate-400 uppercase">Email</th>
                          {TYPES.map((t) => (
                            <th key={t} className={`px-4 py-2 text-center text-xs uppercase ${TYPE_COLOR[t]}`}>{t}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800">
                        {impRows.slice(0, 100).map((r, i) => (
                          <tr key={i}>
                            <td className="px-4 py-1.5 text-slate-300">
                              {r.email || <span className="text-slate-600">(blank)</span>}
                            </td>
                            {TYPES.map((t) => (
                              <td key={t} className="px-4 py-1.5 text-center text-slate-200">
                                {r[t] !== undefined && r[t] !== ''
                                  ? r[t]
                                  : <span className="text-slate-600">—</span>}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {impRows.length > 100 && (
                      <p className="px-4 py-2 text-xs text-slate-500">…and {impRows.length - 100} more rows</p>
                    )}
                  </div>
                )}
              </div>
            )}

            {impResult && (
              <div className="space-y-3">
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { label: 'Updated',   val: impResult.updated.length,  color: 'text-emerald-400' },
                    { label: 'Not Found', val: impResult.notFound.length, color: 'text-amber-400' },
                    { label: 'Failed',    val: impResult.failed.length,   color: 'text-red-400' },
                  ].map(({ label, val, color }) => (
                    <div key={label} className="bg-slate-800 border border-slate-700 rounded-xl p-3 text-center">
                      <p className={`text-xl font-bold ${color}`}>{val}</p>
                      <p className="text-xs text-slate-400">{label}</p>
                    </div>
                  ))}
                </div>

                {(impResult.notFound.length > 0 || impResult.failed.length > 0) && (
                  <div className="max-h-44 overflow-y-auto border border-slate-800 rounded-xl divide-y divide-slate-800">
                    {impResult.notFound.map((r, i) => (
                      <div key={`nf-${i}`} className="px-4 py-2 text-sm flex justify-between gap-3">
                        <span className="text-slate-300 truncate">{r.email}</span>
                        <span className="text-amber-400 text-xs flex-shrink-0">not found in system</span>
                      </div>
                    ))}
                    {impResult.failed.map((r, i) => (
                      <div key={`f-${i}`} className="px-4 py-2 text-sm flex justify-between gap-3">
                        <span className="text-slate-300 truncate">{r.email}</span>
                        <span className="text-red-400 text-xs flex-shrink-0">{r.reason}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="flex gap-3 pt-1">
              <button onClick={closeImport}
                className="flex-1 py-2.5 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-sm transition-all">
                {impResult ? 'Close' : 'Cancel'}
              </button>
              {!impResult && (
                <button onClick={submitImport} disabled={importing || impRows.length === 0}
                  className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50
                             disabled:cursor-not-allowed text-white rounded-xl text-sm font-semibold transition-all">
                  {importing ? 'Importing...' : `Import ${impRows.length || ''} rows`}
                </button>
              )}
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};

export default LeaveBalances;