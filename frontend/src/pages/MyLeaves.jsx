// src/pages/MyLeaves.jsx
import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import toast, { Toaster } from 'react-hot-toast';
import {
  Clock, LogOut, ArrowLeft, Plus, X,
  Calendar, CheckCircle, XCircle, AlertCircle,
} from 'lucide-react';

const API = import.meta.env.VITE_API_URL;

const StatusBadge = ({ status }) => {
  const styles = {
    PENDING:  'bg-amber-500/20  text-amber-400  border-amber-500/30',
    APPROVED: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
    REJECTED: 'bg-red-500/20    text-red-400    border-red-500/30',
  };
  const icons = {
    PENDING:  <AlertCircle className="w-3 h-3" />,
    APPROVED: <CheckCircle className="w-3 h-3" />,
    REJECTED: <XCircle     className="w-3 h-3" />,
  };
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border font-medium ${styles[status]}`}>
      {icons[status]} {status}
    </span>
  );
};

const TypeBadge = ({ type }) => {
  const labels = {
    SL: 'Sick Leave', CL: 'Casual Leave',
    LOP: 'Loss of Pay', HD_LOP: 'HD-LOP', PL: 'Privileged Leave',
  };
  const styles = {
    SL:     'bg-rose-500/20    text-rose-400',
    CL:     'bg-indigo-500/20  text-indigo-400',
    LOP:    'bg-red-500/20     text-red-400',
    HD_LOP: 'bg-orange-500/20  text-orange-400',
    PL:     'bg-violet-500/20  text-violet-400',
  };
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${styles[type]}`}>
      {labels[type]}
    </span>
  );
};

const MyLeaves = () => {
  const { user, logout } = useAuth();
  const navigate         = useNavigate();

  const [leaves,     setLeaves]     = useState([]);
  const [stats,      setStats]      = useState({});
  const [loading,    setLoading]    = useState(true);
  const [showForm,   setShowForm]   = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [form, setForm] = useState({
    type: 'CL', fromDate: '', toDate: '', reason: '',
  });

  const fetchLeaves = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await axios.get(`${API}/leaves/my`);
      setLeaves(data.leaves);
      setStats(data.stats);
    } catch {
      toast.error('Failed to load leave requests.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchLeaves(); }, [fetchLeaves]);

  const handleApply = async () => {
    if (!form.fromDate || !form.toDate || !form.reason.trim()) {
      toast.error('All fields are required.'); return;
    }
    setSubmitting(true);
    try {
      const { data } = await axios.post(`${API}/leaves`, form);
      toast.success(data.message);
      setShowForm(false);
      setForm({ type: 'CL', fromDate: '', toDate: '', reason: '' });
      fetchLeaves();
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Failed to apply leave.');
    } finally {
      setSubmitting(false);
    }
  };

  const formatDate = (d) =>
    new Date(d).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });

  const calcDays = (from, to) => {
    const diff = new Date(to) - new Date(from);
    return Math.ceil(diff / (1000 * 60 * 60 * 24)) + 1;
  };

  const inputCls = `w-full px-4 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-white
    text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-all`;

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
        <div className="flex items-center gap-4">
          <span className="text-slate-400 text-sm">{user?.name}</span>
          <button onClick={async () => await logout()}
            className="flex items-center gap-2 text-white bg-red-600 hover:bg-red-500 px-3 py-1.5 rounded-lg text-sm font-medium transition-all">
            <LogOut className="w-4 h-4" /> Logout
          </button>
        </div>
      </nav>

      <main className="p-6 max-w-5xl mx-auto">

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate('/employee/dashboard')}
              className="p-2 hover:bg-slate-800 rounded-lg transition-all text-slate-400 hover:text-white">
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div>
              <h1 className="text-2xl font-bold">My Leave Requests</h1>
              <p className="text-slate-400 text-sm">Apply and track your leave requests</p>
            </div>
          </div>
          <button onClick={() => setShowForm(true)}
            className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500
                       text-white px-4 py-2.5 rounded-xl text-sm font-semibold transition-all
                       shadow-lg shadow-emerald-600/20">
            <Plus className="w-4 h-4" /> Apply Leave
          </button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          {[
            { label: 'Total Applied',  value: stats.total,    color: 'text-white'       },
            { label: 'Pending',        value: stats.pending,  color: 'text-amber-400'   },
            { label: 'Approved',       value: stats.approved, color: 'text-emerald-400' },
            { label: 'Rejected',       value: stats.rejected, color: 'text-red-400'     },
          ].map(({ label, value, color }) => (
            <div key={label} className="bg-slate-900 border border-slate-800 rounded-xl p-4">
              <p className="text-slate-400 text-xs">{label}</p>
              <p className={`text-2xl font-bold mt-1 ${color}`}>{value ?? 0}</p>
            </div>
          ))}
        </div>

        {/* Leave Table */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-800 flex items-center gap-2">
            <Calendar className="w-5 h-5 text-slate-400" />
            <h2 className="font-semibold">Leave History</h2>
            <span className="text-xs bg-slate-700 text-slate-300 px-2 py-0.5 rounded-full">
              {leaves.length} requests
            </span>
          </div>

          {loading ? (
            <div className="flex justify-center py-12">
              <div className="w-8 h-8 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : leaves.length === 0 ? (
            <div className="text-center py-12 text-slate-500">
              <Calendar className="w-10 h-10 mx-auto mb-2 opacity-30" />
              <p>No leave requests yet.</p>
              <button onClick={() => setShowForm(true)}
                className="mt-3 text-emerald-400 text-sm hover:underline">
                Apply your first leave
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-800 text-left">
                    {['Type', 'From', 'To', 'Days', 'Reason', 'Status', 'Admin Remark'].map((h) => (
                      <th key={h} className="px-6 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {leaves.map((leave) => (
                    <tr key={leave.id} className="hover:bg-slate-800/50 transition-colors">
                      <td className="px-6 py-4"><TypeBadge type={leave.type} /></td>
                      <td className="px-6 py-4 text-sm text-slate-300 whitespace-nowrap">{formatDate(leave.fromDate)}</td>
                      <td className="px-6 py-4 text-sm text-slate-300 whitespace-nowrap">{formatDate(leave.toDate)}</td>
                      <td className="px-6 py-4 text-sm font-semibold text-white">{calcDays(leave.fromDate, leave.toDate)}</td>
                      <td className="px-6 py-4 text-sm text-slate-300 max-w-xs truncate">{leave.reason}</td>
                      <td className="px-6 py-4"><StatusBadge status={leave.status} /></td>
                      <td className="px-6 py-4 text-sm text-slate-400">{leave.adminRemark || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>

      {/* Apply Leave Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800">
              <h3 className="font-semibold text-white">Apply for Leave</h3>
              <button onClick={() => setShowForm(false)}
                className="text-slate-400 hover:text-white p-1 hover:bg-slate-800 rounded-lg transition-all">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1.5">Leave Type</label>
                <select value={form.type} onChange={(e) => setForm((p) => ({ ...p, type: e.target.value }))}
                  className={inputCls}>
                  <option value="SL">🤒 SL — Sick Leave</option>
                  <option value="CL">🌴 CL — Casual Leave</option>
                  <option value="LOP">💸 LOP — Loss of Pay</option>
                  <option value="HD_LOP">🕐 HD-LOP — Half Day Loss of Pay</option>
                  <option value="PL">⭐ PL — Privileged Leave</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1.5">From Date</label>
                  <input type="date" value={form.fromDate}
                    min={new Date().toISOString().split('T')[0]}
                    onChange={(e) => setForm((p) => ({ ...p, fromDate: e.target.value }))}
                    className={inputCls} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1.5">To Date</label>
                  <input type="date" value={form.toDate}
                    min={form.fromDate || new Date().toISOString().split('T')[0]}
                    onChange={(e) => setForm((p) => ({ ...p, toDate: e.target.value }))}
                    className={inputCls} />
                </div>
              </div>
              {form.fromDate && form.toDate && (
                <div className="px-4 py-2 bg-emerald-500/10 border border-emerald-500/20 rounded-xl">
                  <p className="text-emerald-400 text-sm text-center font-medium">
                    📅 {calcDays(form.fromDate, form.toDate)} day(s) requested
                  </p>
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1.5">Reason</label>
                <textarea rows={3} value={form.reason}
                  onChange={(e) => setForm((p) => ({ ...p, reason: e.target.value }))}
                  placeholder="Briefly explain your reason for leave..."
                  className={`${inputCls} resize-none`} />
              </div>
              <div className="flex gap-3 pt-2">
                <button onClick={() => setShowForm(false)}
                  className="flex-1 py-2.5 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-sm transition-all">
                  Cancel
                </button>
                <button onClick={handleApply} disabled={submitting}
                  className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50
                             text-white rounded-xl text-sm font-semibold transition-all">
                  {submitting ? 'Submitting...' : 'Submit Request'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MyLeaves;