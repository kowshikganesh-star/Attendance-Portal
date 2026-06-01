// src/pages/UserManagement.jsx
import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import toast, { Toaster } from 'react-hot-toast';
import {
  ShieldCheck, LogOut, ArrowLeft, Search, Plus,
  Edit2, Trash2, KeyRound, UserCheck, UserX, X, Eye, EyeOff,
} from 'lucide-react';

const API = import.meta.env.VITE_API_URL || 'https://attendance-portal-ic4z.onrender.com/api';

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

const Modal = ({ title, onClose, children }) => (
  <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
    <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-md shadow-2xl">
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

  const [createForm,  setCreateForm]  = useState({ name: '', email: '', password: '', role: 'EMPLOYEE' });
  const [editForm,    setEditForm]    = useState({ name: '', email: '', role: '' });
  const [newPassword, setNewPassword] = useState('');
  const [showPass,    setShowPass]    = useState(false);
  const [submitting,  setSubmitting]  = useState(false);

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
      toast.error('All fields are required.'); return;
    }
    setSubmitting(true);
    try {
      const { data } = await axios.post(`${API}/users`, createForm);
      toast.success(data.message);
      setCreateModal(false);
      setCreateForm({ name: '', email: '', password: '', role: 'EMPLOYEE' });
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
        <div className="flex items-center justify-between mb-6">
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
          <button onClick={() => setCreateModal(true)}
            className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500
                       text-white px-4 py-2.5 rounded-xl text-sm font-semibold transition-all
                       shadow-lg shadow-indigo-600/20">
            <Plus className="w-4 h-4" /> Create User
          </button>
        </div>

        {/* Search + Filter */}
        <div className="flex gap-3 mb-6 flex-wrap">
          <div className="relative flex-1 min-w-60">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input type="text" placeholder="Search by name or email..."
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
            { label: 'Inactive',     value: users.filter((u) => !u.isActive).length,           color: 'text-red-400' },
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
                    {['User', 'Role', 'Status', 'Created', 'Actions'].map((h) => (
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
                          <button onClick={() => { setEditModal(u); setEditForm({ name: u.name, email: u.email, role: u.role }); }}
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
    </div>
  );
};

export default UserManagement;
