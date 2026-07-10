// src/pages/UserManagement.jsx
import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import ExcelJS from 'exceljs';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import toast, { Toaster } from 'react-hot-toast';
import {
  ShieldCheck, LogOut, ArrowLeft, Search, Plus,
  Edit2, Trash2, KeyRound, UserCheck, UserX, X, Eye, EyeOff,
  Upload, UserPlus, FileSpreadsheet, Download,
} from 'lucide-react';

const API = import.meta.env.VITE_API_URL;

const RoleBadge = ({ role }) => {
  const styles = {
    ADMIN:    'bg-indigo-500/20 text-indigo-400 border-indigo-500/30',
    EMPLOYEE: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  };
  return (
    <span className={`text-xs px-2.5 py-1 rounded-full border font-medium ${styles[role] || styles.EMPLOYEE}`}>
      {role}
    </span>
  );
};

const Modal = ({ title, onClose, children, wide = false }) => (
  <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
    <div className={`bg-slate-900 border border-slate-700 rounded-2xl w-full shadow-2xl
                     ${wide ? 'max-w-2xl' : 'max-w-md'}`}>
      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800">
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

const Field = ({ label, children }) => (
  <div>
    <label className="block text-sm font-medium text-slate-300 mb-1.5">{label}</label>
    {children}
  </div>
);

const inputCls = `w-full px-4 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-white
  text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all`;

// ── Value helpers (shared by both parsers) ──
// Extract a plain string from ANY value, including ExcelJS object cells
// (hyperlink { text, hyperlink }, rich text { richText:[...] }, formula { result }).
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
  name:       ['name', 'full name', 'employee name'],
  email:      ['email', 'email address'],
  password:   ['password', 'pass'],
  employeeId: ['emp id', 'empid', 'employee id', 'employeeid'],
  role:       ['role'],
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

// Generic file reader → returns { headerCells:[...], dataRows:[[...], ...] }
const readFileGrid = async (file) => {
  const lower = file.name.toLowerCase();
  if (lower.endsWith('.csv')) {
    const text  = await file.text();
    const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
    if (lines.length === 0) throw new Error('The file is empty.');
    const headerCells = splitCsvLine(lines[0]);
    const dataRows    = lines.slice(1).map(splitCsvLine);
    return { headerCells, dataRows };
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
      const maxCol = headerCells.length;
      for (let c = 1; c <= maxCol; c++) arr[c - 1] = row.getCell(c).value;
      dataRows.push(arr);
    });
    return { headerCells, dataRows };
  }
  throw new Error('Unsupported file type. Please upload a .xlsx or .csv file.');
};

const UserManagement = () => {
  const { user, logout } = useAuth();
  const navigate         = useNavigate();

  const [users,      setUsers]      = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [search,     setSearch]     = useState('');
  const [roleFilter, setRoleFilter] = useState('ALL');

  const [createModal,   setCreateModal]   = useState(false);
  const [editModal,     setEditModal]     = useState(null);
  const [passwordModal, setPasswordModal] = useState(null);
  const [deleteModal,   setDeleteModal]   = useState(null);
  const [idImportModal,   setIdImportModal]   = useState(false); // update emp ids
  const [userImportModal, setUserImportModal] = useState(false); // create users

  const [createForm,  setCreateForm]  = useState({ name: '', email: '', password: '', role: 'EMPLOYEE', employeeId: '' });
  const [editForm,    setEditForm]    = useState({ name: '', email: '', role: '', employeeId: '' });
  const [newPassword, setNewPassword] = useState('');
  const [showPass,    setShowPass]    = useState(false);
  const [submitting,  setSubmitting]  = useState(false);

  // ── Shared import state (reused by both import modals) ──
  const [impRows,   setImpRows]   = useState([]);   // parsed rows (shape depends on mode)
  const [impResult, setImpResult] = useState(null); // backend summary
  const [importing, setImporting] = useState(false);
  const [impError,  setImpError]  = useState('');
  const [impFile,   setImpFile]   = useState('');

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (search)               params.search = search;
      if (roleFilter !== 'ALL') params.role   = roleFilter;
      const { data } = await axios.get(`${API}/users`, { params });
      setUsers(data.users);
    } catch {
      toast.error('Failed to load users.');
    } finally {
      setLoading(false);
    }
  }, [search, roleFilter]);

  useEffect(() => {
    const t = setTimeout(fetchUsers, 300);
    return () => clearTimeout(t);
  }, [fetchUsers]);

  const handleCreate = async () => {
    if (!createForm.name || !createForm.email || !createForm.password) {
      toast.error('Name, email, and password are required.'); return;
    }
    setSubmitting(true);
    try {
      const { data } = await axios.post(`${API}/users`, createForm);
      toast.success(data.message);
      setCreateModal(false);
      setCreateForm({ name: '', email: '', password: '', role: 'EMPLOYEE', employeeId: '' });
      fetchUsers();
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Failed to create user.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleEdit = async () => {
    setSubmitting(true);
    try {
      const { data } = await axios.put(`${API}/users/${editModal.id}`, editForm);
      toast.success(data.message);
      setEditModal(null);
      fetchUsers();
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Failed to update user.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleStatus = async (u) => {
    try {
      const { data } = await axios.patch(`${API}/users/${u.id}/status`);
      toast.success(data.message);
      fetchUsers();
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Failed to update status.');
    }
  };

  const handleResetPassword = async () => {
    if (!newPassword || newPassword.length < 6) {
      toast.error('Password must be at least 6 characters.'); return;
    }
    setSubmitting(true);
    try {
      const { data } = await axios.patch(`${API}/users/${passwordModal.id}/password`, { newPassword });
      toast.success(data.message);
      setPasswordModal(null);
      setNewPassword('');
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Failed to reset password.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    setSubmitting(true);
    try {
      const { data } = await axios.delete(`${API}/users/${deleteModal.id}`);
      toast.success(data.message);
      setDeleteModal(null);
      fetchUsers();
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Failed to delete user.');
    } finally {
      setSubmitting(false);
    }
  };

  const formatDate = (d) =>
    new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  // ── Reset shared import state ──
  const resetImport = () => { setImpRows([]); setImpResult(null); setImpError(''); setImpFile(''); };

  // ══════════ IMPORT: EMPLOYEE IDs (update existing) ══════════
  const handleIdFilePicked = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    resetImport(); setImpFile(file.name);
    try {
      const { headerCells, dataRows } = await readFileGrid(file);
      let emailCol = -1, idCol = -1;
      headerCells.forEach((h, i) => {
        if (headerMatches(h, 'email'))      emailCol = i;
        if (headerMatches(h, 'employeeId')) idCol    = i;
      });
      if (emailCol === -1 || idCol === -1)
        throw new Error('Could not find "email" and "emp id" columns in the first row.');

      const rows = [];
      for (const r of dataRows) {
        const email      = cleanEmail(r[emailCol] ?? '');
        const employeeId = cellToString(r[idCol] ?? '');
        if (email || employeeId) rows.push({ email, employeeId });
      }
      if (rows.length === 0) throw new Error('No data rows found under the headers.');
      setImpRows(rows);
    } catch (err) {
      setImpError(err?.message || 'Could not read the file.');
    }
  };

  const submitIdImport = async () => {
    if (impRows.length === 0) return;
    setImporting(true);
    try {
      const { data } = await axios.post(`${API}/users/import-employee-ids`, { rows: impRows });
      setImpResult({ mode: 'ids', ...data.summary });
      toast.success(data.message);
      fetchUsers();
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Import failed.');
    } finally {
      setImporting(false);
    }
  };

  // ══════════ IMPORT: USERS (create new) ══════════
  const handleUserFilePicked = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    resetImport(); setImpFile(file.name);
    try {
      const { headerCells, dataRows } = await readFileGrid(file);
      let nameCol = -1, emailCol = -1, passCol = -1, idCol = -1, roleCol = -1;
      headerCells.forEach((h, i) => {
        if (headerMatches(h, 'name'))       nameCol  = i;
        if (headerMatches(h, 'email'))      emailCol = i;
        if (headerMatches(h, 'password'))   passCol  = i;
        if (headerMatches(h, 'employeeId')) idCol    = i;
        if (headerMatches(h, 'role'))       roleCol  = i;
      });
      if (nameCol === -1 || emailCol === -1 || passCol === -1)
        throw new Error('The file must have "name", "email", and "password" columns in the first row.');

      const rows = [];
      for (const r of dataRows) {
        const name       = cellToString(r[nameCol] ?? '');
        const email      = cleanEmail(r[emailCol] ?? '');
        const password   = cellToString(r[passCol] ?? '');
        const employeeId = idCol   !== -1 ? cellToString(r[idCol] ?? '')   : '';
        const role       = roleCol !== -1 ? cellToString(r[roleCol] ?? '') : '';
        if (name || email || password) rows.push({ name, email, password, employeeId, role });
      }
      if (rows.length === 0) throw new Error('No data rows found under the headers.');
      setImpRows(rows);
    } catch (err) {
      setImpError(err?.message || 'Could not read the file.');
    }
  };

  const submitUserImport = async () => {
    if (impRows.length === 0) return;
    setImporting(true);
    try {
      const { data } = await axios.post(`${API}/users/import-users`, { rows: impRows });
      setImpResult({ mode: 'users', ...data.summary });
      toast.success(data.message);
      fetchUsers();
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Import failed.');
    } finally {
      setImporting(false);
    }
  };

  const closeIdImport   = () => { setIdImportModal(false);   resetImport(); };
  const closeUserImport = () => { setUserImportModal(false); resetImport(); };

  // ── Template downloads ──
  const downloadTemplate = async (kind) => {
    const workbook = new ExcelJS.Workbook();
    const sheet    = workbook.addWorksheet(kind === 'users' ? 'Users' : 'Employee IDs');
    if (kind === 'users') {
      sheet.addRow(['name', 'email', 'password', 'emp id', 'role']);
      sheet.addRow(['John Doe', 'john.doe@handigital.com', 'Pass@123', 'EMP045', 'EMPLOYEE']);
      [30, 34, 16, 14, 14].forEach((w, i) => { sheet.getColumn(i + 1).width = w; });
    } else {
      sheet.addRow(['email', 'emp id']);
      sheet.addRow(['john.doe@handigital.com', 'EMP045']);
      [34, 14].forEach((w, i) => { sheet.getColumn(i + 1).width = w; });
    }
    sheet.getRow(1).font = { bold: true };

    const buffer = await workbook.xlsx.writeBuffer();
    const blob   = new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const url  = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href  = url;
    link.setAttribute('download', kind === 'users' ? 'users_template.xlsx' : 'employee_ids_template.xlsx');
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
  };

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
              <h1 className="text-2xl font-bold">User Management</h1>
              <p className="text-slate-400 text-sm">Create and manage employee accounts</p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={() => { resetImport(); setUserImportModal(true); }}
              className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700
                         text-white px-4 py-2.5 rounded-xl text-sm font-semibold transition-all
                         border border-slate-700">
              <UserPlus className="w-4 h-4" /> Import Users
            </button>
            <button onClick={() => { resetImport(); setIdImportModal(true); }}
              className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700
                         text-white px-4 py-2.5 rounded-xl text-sm font-semibold transition-all
                         border border-slate-700">
              <Upload className="w-4 h-4" /> Import Employee IDs
            </button>
            <button onClick={() => setCreateModal(true)}
              className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500
                         text-white px-4 py-2.5 rounded-xl text-sm font-semibold transition-all
                         shadow-lg shadow-indigo-600/20">
              <Plus className="w-4 h-4" /> Create User
            </button>
          </div>
        </div>

        {/* Search + Filter */}
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
          <div className="flex gap-2">
            {['ALL', 'ADMIN', 'EMPLOYEE'].map((r) => (
              <button key={r} onClick={() => setRoleFilter(r)}
                className={`px-4 py-2 rounded-xl text-sm font-medium transition-all
                  ${roleFilter === r
                    ? 'bg-indigo-600 text-white'
                    : 'bg-slate-900 border border-slate-800 text-slate-400 hover:text-white'}`}>
                {r}
              </button>
            ))}
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          {[
            { label: 'Total Users',  value: users.length },
            { label: 'Admins',       value: users.filter((u) => u.role === 'ADMIN').length,    color: 'text-indigo-400' },
            { label: 'Employees',    value: users.filter((u) => u.role === 'EMPLOYEE').length, color: 'text-emerald-400' },
            { label: 'No Emp ID',    value: users.filter((u) => !u.employeeId).length,         color: 'text-amber-400' },
          ].map(({ label, value, color = 'text-white' }) => (
            <div key={label} className="bg-slate-900 border border-slate-800 rounded-xl p-4">
              <p className="text-slate-400 text-xs">{label}</p>
              <p className={`text-2xl font-bold mt-1 ${color}`}>{value}</p>
            </div>
          ))}
        </div>

        {/* Table */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-800">
            <span className="font-semibold">All Users</span>
            <span className="ml-2 text-xs bg-slate-700 text-slate-300 px-2 py-0.5 rounded-full">
              {users.length} users
            </span>
          </div>

          {loading ? (
            <div className="flex justify-center py-12">
              <div className="w-8 h-8 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : users.length === 0 ? (
            <div className="text-center py-12 text-slate-500"><p>No users found.</p></div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-800 text-left">
                    {['User', 'Emp ID', 'Role', 'Status', 'Created', 'Actions'].map((h) => (
                      <th key={h} className="px-6 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {users.map((u) => (
                    <tr key={u.id} className={`hover:bg-slate-800/50 transition-colors ${!u.isActive ? 'opacity-50' : ''}`}>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 bg-indigo-600 rounded-full flex items-center justify-center font-bold text-sm flex-shrink-0">
                            {u.name.charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <p className="font-medium text-white text-sm">{u.name}</p>
                            <p className="text-xs text-slate-400">{u.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        {u.employeeId
                          ? <span className="text-sm font-mono text-slate-200">{u.employeeId}</span>
                          : <span className="text-xs text-slate-600">—</span>}
                      </td>
                      <td className="px-6 py-4"><RoleBadge role={u.role} /></td>
                      <td className="px-6 py-4">
                        <span className={`text-xs px-2.5 py-1 rounded-full border font-medium
                          ${u.isActive
                            ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
                            : 'bg-red-500/20 text-red-400 border-red-500/30'}`}>
                          {u.isActive ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-sm text-slate-400">{formatDate(u.createdAt)}</td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-1">
                          <button onClick={() => { setEditModal(u); setEditForm({ name: u.name, email: u.email, role: u.role, employeeId: u.employeeId || '' }); }}
                            title="Edit"
                            className="p-2 text-slate-400 hover:text-indigo-400 hover:bg-slate-700 rounded-lg transition-all">
                            <Edit2 className="w-4 h-4" />
                          </button>
                          <button onClick={() => setPasswordModal(u)} title="Reset Password"
                            className="p-2 text-slate-400 hover:text-amber-400 hover:bg-slate-700 rounded-lg transition-all">
                            <KeyRound className="w-4 h-4" />
                          </button>
                          <button onClick={() => handleToggleStatus(u)}
                            title={u.isActive ? 'Deactivate' : 'Activate'}
                            className={`p-2 hover:bg-slate-700 rounded-lg transition-all
                              ${u.isActive ? 'text-slate-400 hover:text-red-400' : 'text-slate-400 hover:text-emerald-400'}`}>
                            {u.isActive ? <UserX className="w-4 h-4" /> : <UserCheck className="w-4 h-4" />}
                          </button>
                          {u.id !== user?.id && (
                            <button onClick={() => setDeleteModal(u)} title="Delete"
                              className="p-2 text-slate-400 hover:text-red-400 hover:bg-slate-700 rounded-lg transition-all">
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>

      {/* Create Modal */}
      {createModal && (
        <Modal title="Create New User" onClose={() => setCreateModal(false)}>
          <div className="space-y-4">
            <Field label="Full Name">
              <input type="text" placeholder="John Doe" value={createForm.name}
                onChange={(e) => setCreateForm((p) => ({ ...p, name: e.target.value }))}
                className={inputCls} />
            </Field>
            <Field label="Email Address">
              <input type="email" placeholder="john@company.com" value={createForm.email}
                onChange={(e) => setCreateForm((p) => ({ ...p, email: e.target.value }))}
                className={inputCls} />
            </Field>
            <Field label="Employee ID (optional — leave blank for freelancers)">
              <input type="text" placeholder="e.g. EMP001" value={createForm.employeeId}
                onChange={(e) => setCreateForm((p) => ({ ...p, employeeId: e.target.value }))}
                className={inputCls} />
            </Field>
            <Field label="Password">
              <div className="relative">
                <input type={showPass ? 'text' : 'password'} placeholder="Min. 6 characters"
                  value={createForm.password}
                  onChange={(e) => setCreateForm((p) => ({ ...p, password: e.target.value }))}
                  className={`${inputCls} pr-10`} />
                <button type="button" onClick={() => setShowPass((p) => !p)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white">
                  {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </Field>
            <Field label="Role">
              <select value={createForm.role}
                onChange={(e) => setCreateForm((p) => ({ ...p, role: e.target.value }))}
                className={inputCls}>
                <option value="EMPLOYEE">Employee</option>
              </select>
            </Field>
            <div className="flex gap-3 pt-2">
              <button onClick={() => setCreateModal(false)}
                className="flex-1 py-2.5 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-sm transition-all">
                Cancel
              </button>
              <button onClick={handleCreate} disabled={submitting}
                className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50
                           text-white rounded-xl text-sm font-semibold transition-all">
                {submitting ? 'Creating...' : 'Create User'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Edit Modal */}
      {editModal && (
        <Modal title={`Edit — ${editModal.name}`} onClose={() => setEditModal(null)}>
          <div className="space-y-4">
            <Field label="Full Name">
              <input type="text" value={editForm.name}
                onChange={(e) => setEditForm((p) => ({ ...p, name: e.target.value }))}
                className={inputCls} />
            </Field>
            <Field label="Email Address">
              <input type="email" value={editForm.email}
                onChange={(e) => setEditForm((p) => ({ ...p, email: e.target.value }))}
                className={inputCls} />
            </Field>
            <Field label="Employee ID (leave blank for freelancers)">
              <input type="text" placeholder="e.g. EMP001" value={editForm.employeeId}
                onChange={(e) => setEditForm((p) => ({ ...p, employeeId: e.target.value }))}
                className={inputCls} />
            </Field>
            <Field label="Role">
              <select value={editForm.role}
                onChange={(e) => setEditForm((p) => ({ ...p, role: e.target.value }))}
                className={inputCls}>
                <option value="EMPLOYEE">Employee</option>
                <option value="ADMIN">Admin</option>
              </select>
            </Field>
            <div className="flex gap-3 pt-2">
              <button onClick={() => setEditModal(null)}
                className="flex-1 py-2.5 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-sm transition-all">
                Cancel
              </button>
              <button onClick={handleEdit} disabled={submitting}
                className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50
                           text-white rounded-xl text-sm font-semibold transition-all">
                {submitting ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Reset Password Modal */}
      {passwordModal && (
        <Modal title={`Reset Password — ${passwordModal.name}`} onClose={() => setPasswordModal(null)}>
          <div className="space-y-4">
            <p className="text-slate-400 text-sm">
              Enter a new password for <span className="text-white font-medium">{passwordModal.name}</span>.
            </p>
            <Field label="New Password">
              <div className="relative">
                <input type={showPass ? 'text' : 'password'} placeholder="Min. 6 characters"
                  value={newPassword} onChange={(e) => setNewPassword(e.target.value)}
                  className={`${inputCls} pr-10`} />
                <button type="button" onClick={() => setShowPass((p) => !p)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white">
                  {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </Field>
            <div className="flex gap-3 pt-2">
              <button onClick={() => { setPasswordModal(null); setNewPassword(''); }}
                className="flex-1 py-2.5 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-sm transition-all">
                Cancel
              </button>
              <button onClick={handleResetPassword} disabled={submitting}
                className="flex-1 py-2.5 bg-amber-600 hover:bg-amber-500 disabled:opacity-50
                           text-white rounded-xl text-sm font-semibold transition-all">
                {submitting ? 'Resetting...' : 'Reset Password'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Delete Modal */}
      {deleteModal && (
        <Modal title="Delete User" onClose={() => setDeleteModal(null)}>
          <div className="space-y-4">
            <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl">
              <p className="text-red-400 text-sm font-medium mb-1">⚠️ This action is permanent</p>
              <p className="text-slate-300 text-sm">
                Deleting <span className="text-white font-semibold">{deleteModal.name}</span> will
                also remove all their attendance and leave records.
              </p>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setDeleteModal(null)}
                className="flex-1 py-2.5 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-sm transition-all">
                Cancel
              </button>
              <button onClick={handleDelete} disabled={submitting}
                className="flex-1 py-2.5 bg-red-600 hover:bg-red-500 disabled:opacity-50
                           text-white rounded-xl text-sm font-semibold transition-all">
                {submitting ? 'Deleting...' : 'Yes, Delete'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* ═══════════ IMPORT EMPLOYEE IDs MODAL (update existing) ═══════════ */}
      {idImportModal && (
        <Modal title="Import Employee IDs" onClose={closeIdImport} wide>
          <div className="space-y-5">
            <div className="p-4 bg-slate-800/50 border border-slate-700 rounded-xl text-sm text-slate-300">
              <p className="mb-2">
                Update employee IDs on <span className="font-semibold">existing</span> users.
                Upload an <span className="font-semibold">.xlsx</span> or <span className="font-semibold">.csv</span> with columns:
                <span className="font-mono text-indigo-300"> email </span> and
                <span className="font-mono text-indigo-300"> emp id</span>.
              </p>
              <p className="text-slate-400 text-xs">
                Matched by email. Emails not in the system are reported below.
              </p>
              <button onClick={() => downloadTemplate('ids')}
                className="mt-3 inline-flex items-center gap-2 text-xs text-indigo-400 hover:text-indigo-300">
                <Download className="w-3.5 h-3.5" /> Download template
              </button>
            </div>

            {!impResult && (
              <div>
                <label className="flex items-center justify-center gap-3 px-4 py-6 border-2 border-dashed border-slate-700 rounded-xl cursor-pointer hover:border-indigo-500 hover:bg-slate-800/40 transition-all">
                  <FileSpreadsheet className="w-6 h-6 text-slate-400" />
                  <span className="text-sm text-slate-300">
                    {impRows.length > 0 ? `${impFile} — ${impRows.length} rows ready` : 'Click to choose an .xlsx or .csv file'}
                  </span>
                  <input type="file" accept=".xlsx,.csv" className="hidden" onChange={handleIdFilePicked} />
                </label>
                {impError && <p className="mt-2 text-sm text-red-400">{impError}</p>}

                {impRows.length > 0 && (
                  <div className="mt-4 max-h-48 overflow-y-auto border border-slate-800 rounded-xl">
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 bg-slate-800">
                        <tr>
                          <th className="px-4 py-2 text-left text-xs text-slate-400 uppercase">Email</th>
                          <th className="px-4 py-2 text-left text-xs text-slate-400 uppercase">Emp ID</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800">
                        {impRows.slice(0, 100).map((r, i) => (
                          <tr key={i}>
                            <td className="px-4 py-1.5 text-slate-300">{r.email || <span className="text-slate-600">(blank)</span>}</td>
                            <td className="px-4 py-1.5 font-mono text-slate-200">{r.employeeId || <span className="text-slate-600">(blank)</span>}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {impRows.length > 100 && <p className="px-4 py-2 text-xs text-slate-500">…and {impRows.length - 100} more rows</p>}
                  </div>
                )}
              </div>
            )}

            {impResult && impResult.mode === 'ids' && (
              <div className="space-y-3">
                <div className="grid grid-cols-4 gap-3">
                  {[
                    { label: 'Updated',    val: impResult.updated.length,    color: 'text-emerald-400' },
                    { label: 'Not Found',  val: impResult.notFound.length,   color: 'text-amber-400' },
                    { label: 'Duplicates', val: impResult.duplicates.length, color: 'text-red-400' },
                    { label: 'Skipped',    val: impResult.skipped.length,    color: 'text-slate-400' },
                  ].map(({ label, val, color }) => (
                    <div key={label} className="bg-slate-800 border border-slate-700 rounded-xl p-3 text-center">
                      <p className={`text-xl font-bold ${color}`}>{val}</p>
                      <p className="text-xs text-slate-400">{label}</p>
                    </div>
                  ))}
                </div>
                {(impResult.notFound.length > 0 || impResult.duplicates.length > 0) && (
                  <div className="max-h-44 overflow-y-auto border border-slate-800 rounded-xl divide-y divide-slate-800">
                    {impResult.notFound.map((r, i) => (
                      <div key={`nf-${i}`} className="px-4 py-2 text-sm flex justify-between">
                        <span className="text-slate-300">{r.email}</span>
                        <span className="text-amber-400 text-xs">not found in system</span>
                      </div>
                    ))}
                    {impResult.duplicates.map((r, i) => (
                      <div key={`dup-${i}`} className="px-4 py-2 text-sm flex justify-between">
                        <span className="text-slate-300">{r.email} → {r.employeeId}</span>
                        <span className="text-red-400 text-xs">duplicate ID</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="flex gap-3 pt-1">
              <button onClick={closeIdImport}
                className="flex-1 py-2.5 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-sm transition-all">
                {impResult ? 'Close' : 'Cancel'}
              </button>
              {!impResult && (
                <button onClick={submitIdImport} disabled={importing || impRows.length === 0}
                  className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl text-sm font-semibold transition-all">
                  {importing ? 'Importing...' : `Import ${impRows.length || ''} rows`}
                </button>
              )}
            </div>
          </div>
        </Modal>
      )}

      {/* ═══════════ IMPORT USERS MODAL (create new) ═══════════ */}
      {userImportModal && (
        <Modal title="Import Users" onClose={closeUserImport} wide>
          <div className="space-y-5">
            <div className="p-4 bg-slate-800/50 border border-slate-700 rounded-xl text-sm text-slate-300">
              <p className="mb-2">
                Create <span className="font-semibold">new</span> user accounts in bulk.
                Upload an <span className="font-semibold">.xlsx</span> or <span className="font-semibold">.csv</span> with columns:
                <span className="font-mono text-indigo-300"> name</span>,
                <span className="font-mono text-indigo-300"> email</span>,
                <span className="font-mono text-indigo-300"> password</span>,
                and optionally <span className="font-mono text-indigo-300"> emp id</span> /
                <span className="font-mono text-indigo-300"> role</span>.
              </p>
              <p className="text-slate-400 text-xs">
                Role defaults to EMPLOYEE if blank. Rows with an existing email, a duplicate ID,
                or missing fields are reported as failed — the rest are still created.
              </p>
              <button onClick={() => downloadTemplate('users')}
                className="mt-3 inline-flex items-center gap-2 text-xs text-indigo-400 hover:text-indigo-300">
                <Download className="w-3.5 h-3.5" /> Download template
              </button>
            </div>

            {!impResult && (
              <div>
                <label className="flex items-center justify-center gap-3 px-4 py-6 border-2 border-dashed border-slate-700 rounded-xl cursor-pointer hover:border-indigo-500 hover:bg-slate-800/40 transition-all">
                  <FileSpreadsheet className="w-6 h-6 text-slate-400" />
                  <span className="text-sm text-slate-300">
                    {impRows.length > 0 ? `${impFile} — ${impRows.length} rows ready` : 'Click to choose an .xlsx or .csv file'}
                  </span>
                  <input type="file" accept=".xlsx,.csv" className="hidden" onChange={handleUserFilePicked} />
                </label>
                {impError && <p className="mt-2 text-sm text-red-400">{impError}</p>}

                {impRows.length > 0 && (
                  <div className="mt-4 max-h-48 overflow-y-auto border border-slate-800 rounded-xl">
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 bg-slate-800">
                        <tr>
                          <th className="px-4 py-2 text-left text-xs text-slate-400 uppercase">Name</th>
                          <th className="px-4 py-2 text-left text-xs text-slate-400 uppercase">Email</th>
                          <th className="px-4 py-2 text-left text-xs text-slate-400 uppercase">Emp ID</th>
                          <th className="px-4 py-2 text-left text-xs text-slate-400 uppercase">Password</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800">
                        {impRows.slice(0, 100).map((r, i) => (
                          <tr key={i}>
                            <td className="px-4 py-1.5 text-slate-300">{r.name || <span className="text-slate-600">(blank)</span>}</td>
                            <td className="px-4 py-1.5 text-slate-300">{r.email || <span className="text-slate-600">(blank)</span>}</td>
                            <td className="px-4 py-1.5 font-mono text-slate-200">{r.employeeId || <span className="text-slate-600">—</span>}</td>
                            <td className="px-4 py-1.5 text-slate-500">{r.password ? '••••••' : <span className="text-red-400">(blank)</span>}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {impRows.length > 100 && <p className="px-4 py-2 text-xs text-slate-500">…and {impRows.length - 100} more rows</p>}
                  </div>
                )}
              </div>
            )}

            {impResult && impResult.mode === 'users' && (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { label: 'Created', val: impResult.created.length, color: 'text-emerald-400' },
                    { label: 'Failed',  val: impResult.failed.length,  color: 'text-red-400' },
                  ].map(({ label, val, color }) => (
                    <div key={label} className="bg-slate-800 border border-slate-700 rounded-xl p-3 text-center">
                      <p className={`text-xl font-bold ${color}`}>{val}</p>
                      <p className="text-xs text-slate-400">{label}</p>
                    </div>
                  ))}
                </div>
                {impResult.failed.length > 0 && (
                  <div className="max-h-44 overflow-y-auto border border-slate-800 rounded-xl divide-y divide-slate-800">
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
              <button onClick={closeUserImport}
                className="flex-1 py-2.5 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-sm transition-all">
                {impResult ? 'Close' : 'Cancel'}
              </button>
              {!impResult && (
                <button onClick={submitUserImport} disabled={importing || impRows.length === 0}
                  className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl text-sm font-semibold transition-all">
                  {importing ? 'Creating...' : `Create ${impRows.length || ''} users`}
                </button>
              )}
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};

export default UserManagement;