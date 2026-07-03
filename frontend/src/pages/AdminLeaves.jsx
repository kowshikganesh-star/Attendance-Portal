// src/pages/AdminLeaves.jsx
import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import toast, { Toaster } from 'react-hot-toast';
import {
  ShieldCheck, LogOut, ArrowLeft, CheckCircle,
  XCircle, AlertCircle, Calendar, X, ChevronDown, ChevronUp,
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
  const labels = { SL: 'SL', CL: 'CL', LOP: 'LOP', HD_LOP: 'HD-LOP', PL: 'PL' };
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

// ── Click to expand cell ──────────────────────────────────
const ExpandableCell = ({ text, cellKey, expandedCell, setExpandedCell }) => {
  if (!text || text === '—') return <span className="text-slate-500 text-sm">—</span>;

  const isExpanded = expandedCell === cellKey;
  const isLong     = text.length > 30;

  if (!isLong) return <span className="text-sm text-slate-300">{text}</span>;

  return (
    <div
      onClick={() => setExpandedCell(isExpanded ? null : cellKey)}
      className={`cursor-pointer rounded-lg transition-all duration-200
        ${isExpanded
          ? 'bg-slate-700/50 border border-slate-600/50 p-3 min-w-[260px]'
          : 'hover:bg-slate-800/40 p-1'
        }`}
    >
      {/* Text — truncated or full */}
      <p className={`text-sm text-slate-200 leading-relaxed transition-all duration-200
        ${isExpanded
          ? 'whitespace-normal break-words'   // full text, wide ✅
          : 'truncate max-w-[130px]'          // 1 line clipped ✅
        }`}
      >
        {text}
      </p>

      {/* Chevron icon — shows expand/collapse state */}
      <span className="flex items-center gap-1 mt-1.5 text-indigo-400 text-xs font-medium">
        {isExpanded
          ? <><ChevronUp   className="w-3 h-3" /> minimize</>
          : <><ChevronDown className="w-3 h-3" /> expand</>
        }
      </span>
    </div>
  );
};

const AdminLeaves = () => {
  const { user, logout } = useAuth();
  const navigate         = useNavigate();

  const [leaves,       setLeaves]       = useState([]);
  const [stats,        setStats]        = useState({});
  const [employees,    setEmployees]    = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [typeFilter,   setTypeFilter]   = useState('ALL');
  const [userFilter,   setUserFilter]   = useState('');
  const [rejectModal,  setRejectModal]  = useState(null);
  const [rejectRemark, setRejectRemark] = useState('');
  const [approveModal, setApproveModal] = useState(null);
  const [approveType,  setApproveType]  = useState('');
  const [submitting,   setSubmitting]   = useState(false);
  const [expandedCell, setExpandedCell] = useState(null);

  const fetchLeaves = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (statusFilter !== 'ALL') params.status = statusFilter;
      if (typeFilter   !== 'ALL') params.type   = typeFilter;
      if (userFilter)              params.userId  = userFilter;
      const { data } = await axios.get(`${API}/leaves`, { params });
      setLeaves(data.leaves);
      setStats(data.stats);
      setEmployees(data.employees);
    } catch {
      toast.error('Failed to load leave requests.');
    } finally {
      setLoading(false);
    }
  }, [statusFilter, typeFilter, userFilter]);

  useEffect(() => { fetchLeaves(); }, [fetchLeaves]);

  const openApproveModal = (leave) => {
    setApproveModal(leave);
    setApproveType(leave.type);
  };

  const handleApprove = async () => {
    setSubmitting(true);
    try {
      const { data } = await axios.patch(`${API}/leaves/${approveModal.id}/approve`, {
        type: approveType,
      });
      toast.success(data.message);
      setApproveModal(null);
      fetchLeaves();
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Failed to approve.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleReject = async () => {
    if (!rejectRemark.trim()) { toast.error('Rejection reason is required.'); return; }
    setSubmitting(true);
    try {
      const { data } = await axios.patch(
        `${API}/leaves/${rejectModal.id}/reject`,
        { adminRemark: rejectRemark }
      );
      toast.success(data.message);
      setRejectModal(null);
      setRejectRemark('');
      fetchLeaves();
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Failed to reject.');
    } finally {
      setSubmitting(false);
    }
  };

  const formatDate = (d) =>
    new Date(d).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });

  const calcDays = (from, to) =>
    Math.ceil((new Date(to) - new Date(from)) / (1000 * 60 * 60 * 24)) + 1;

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
        <div className="flex items-center gap-3 mb-6">
          <button onClick={() => navigate('/admin/dashboard')}
            className="p-2 hover:bg-slate-800 rounded-lg transition-all text-slate-400 hover:text-white">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-2xl font-bold">Leave Management</h1>
            <p className="text-slate-400 text-sm">Review and manage employee leave requests</p>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          {[
            { label: 'Total Requests', value: stats.total,    color: 'text-white'       },
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

        {/* Filters */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 mb-6">
          <div className="flex flex-wrap gap-3 items-center">
            <div className="flex gap-2">
              {['ALL', 'PENDING', 'APPROVED', 'REJECTED'].map((s) => (
                <button key={s} onClick={() => setStatusFilter(s)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all
                    ${statusFilter === s ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-white'}`}>
                  {s}
                </button>
              ))}
            </div>
            <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}
              className="px-3 py-1.5 bg-slate-800 border border-slate-700 rounded-lg text-white text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500">
              <option value="ALL">All Types</option>
              <option value="SL">SL — Sick Leave</option>
              <option value="CL">CL — Casual Leave</option>
              <option value="LOP">LOP — Loss of Pay</option>
              <option value="HD_LOP">HD-LOP — Half Day LOP</option>
              <option value="PL">PL — Privileged Leave</option>
            </select>
            <select value={userFilter} onChange={(e) => setUserFilter(e.target.value)}
              className="px-3 py-1.5 bg-slate-800 border border-slate-700 rounded-lg text-white text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500">
              <option value="">All Employees</option>
              {employees.map((emp) => (
                <option key={emp.id} value={emp.id}>{emp.name}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Table */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-800 flex items-center gap-2">
            <Calendar className="w-5 h-5 text-slate-400" />
            <h2 className="font-semibold">All Leave Requests</h2>
            <span className="text-xs bg-slate-700 text-slate-300 px-2 py-0.5 rounded-full">
              {leaves.length} requests
            </span>
          </div>

          {loading ? (
            <div className="flex justify-center py-12">
              <div className="w-8 h-8 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : leaves.length === 0 ? (
            <div className="text-center py-12 text-slate-500">
              <Calendar className="w-10 h-10 mx-auto mb-2 opacity-30" />
              <p>No leave requests found.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-800 text-left">
                    {['Employee', 'Type', 'From', 'To', 'Days', 'Reason', 'Status', 'Admin Remark', 'Actions'].map((h) => (
                      <th key={h} className="px-5 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {leaves.map((leave) => (
                    <tr key={leave.id} className="hover:bg-slate-800/50 transition-colors">

                      {/* Employee */}
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 bg-indigo-600 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0">
                            {leave.user.name.charAt(0)}
                          </div>
                          <div>
                            <p className="text-sm font-medium text-white">{leave.user.name}</p>
                            <p className="text-xs text-slate-400">{leave.user.email}</p>
                          </div>
                        </div>
                      </td>

                      <td className="px-5 py-4"><TypeBadge type={leave.type} /></td>
                      <td className="px-5 py-4 text-sm text-slate-300 whitespace-nowrap">{formatDate(leave.fromDate)}</td>
                      <td className="px-5 py-4 text-sm text-slate-300 whitespace-nowrap">{formatDate(leave.toDate)}</td>
                      <td className="px-5 py-4 text-sm font-semibold text-white">{calcDays(leave.fromDate, leave.toDate)}</td>

                      {/* Reason — click to expand ✅ */}
                      <td className="px-5 py-4 min-w-[150px] max-w-[300px]">
                        <ExpandableCell
                          text={leave.reason}
                          cellKey={`reason-${leave.id}`}
                          expandedCell={expandedCell}
                          setExpandedCell={setExpandedCell}
                        />
                      </td>

                      <td className="px-5 py-4"><StatusBadge status={leave.status} /></td>

                      {/* Admin Remark — click to expand ✅ */}
                      <td className="px-5 py-4 min-w-[150px] max-w-[300px]">
                        <ExpandableCell
                          text={leave.adminRemark || '—'}
                          cellKey={`remark-${leave.id}`}
                          expandedCell={expandedCell}
                          setExpandedCell={setExpandedCell}
                        />
                      </td>

                      {/* Actions */}
                      <td className="px-5 py-4">
                        {leave.status === 'PENDING' ? (
                          <div className="flex items-center gap-2">
                            <button onClick={() => openApproveModal(leave)}
                              className="flex items-center gap-1 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500
                                         text-white text-xs rounded-lg transition-all font-medium">
                              <CheckCircle className="w-3 h-3" /> Approve
                            </button>
                            <button onClick={() => { setRejectModal(leave); setRejectRemark(''); }}
                              className="flex items-center gap-1 px-3 py-1.5 bg-red-600 hover:bg-red-500
                                         text-white text-xs rounded-lg transition-all font-medium">
                              <XCircle className="w-3 h-3" /> Reject
                            </button>
                          </div>
                        ) : (
                          <span className="text-slate-500 text-xs">
                            {leave.reviewer ? `by ${leave.reviewer.name}` : '—'}
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

      {/* Approve Modal */}
      {approveModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800">
              <h3 className="font-semibold text-white">Approve Leave Request</h3>
              <button onClick={() => setApproveModal(null)}
                className="text-slate-400 hover:text-white p-1 hover:bg-slate-800 rounded-lg transition-all">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div className="p-4 bg-slate-800 rounded-xl">
                <p className="text-sm text-slate-300">
                  Approving <span className="text-white font-semibold">{approveModal.user.name}</span>'s leave request for&nbsp;
                  <span className="text-white font-semibold">{calcDays(approveModal.fromDate, approveModal.toDate)} day(s)</span>
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1.5">
                  Leave Type
                </label>
                <select value={approveType} onChange={(e) => setApproveType(e.target.value)}
                  className="w-full px-4 py-2.5 bg-slate-800 border border-slate-700 rounded-xl
                             text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500">
                  <option value="SL">SL — Sick Leave</option>
                  <option value="CL">CL — Casual Leave</option>
                  <option value="LOP">LOP — Loss of Pay</option>
                  <option value="HD_LOP">HD-LOP — Half Day LOP</option>
                  <option value="PL">PL — Privileged Leave</option>
                </select>
                {approveType !== approveModal.type && (
                  <p className="text-xs text-amber-400 mt-1.5">
                    Changing from {approveModal.type} to {approveType}
                  </p>
                )}
              </div>
              <div className="flex gap-3">
                <button onClick={() => setApproveModal(null)}
                  className="flex-1 py-2.5 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-sm transition-all">
                  Cancel
                </button>
                <button onClick={handleApprove} disabled={submitting}
                  className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50
                             text-white rounded-xl text-sm font-semibold transition-all">
                  {submitting ? 'Approving...' : 'Confirm Approve'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Reject Modal */}
      {rejectModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800">
              <h3 className="font-semibold text-white">Reject Leave Request</h3>
              <button onClick={() => setRejectModal(null)}
                className="text-slate-400 hover:text-white p-1 hover:bg-slate-800 rounded-lg transition-all">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div className="p-4 bg-slate-800 rounded-xl">
                <p className="text-sm text-slate-300">
                  Rejecting <span className="text-white font-semibold">{rejectModal.user.name}</span>'s&nbsp;
                  <span className="text-orange-400">{rejectModal.type}</span> leave request for&nbsp;
                  <span className="text-white font-semibold">{calcDays(rejectModal.fromDate, rejectModal.toDate)} day(s)</span>
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1.5">
                  Reason for Rejection <span className="text-red-400">*</span>
                </label>
                <textarea rows={3} value={rejectRemark}
                  onChange={(e) => setRejectRemark(e.target.value)}
                  placeholder="Explain why this leave is being rejected..."
                  className="w-full px-4 py-2.5 bg-slate-800 border border-slate-700 rounded-xl
                             text-white text-sm placeholder-slate-500 resize-none
                             focus:outline-none focus:ring-2 focus:ring-red-500 transition-all"
                />
              </div>
              <div className="flex gap-3">
                <button onClick={() => setRejectModal(null)}
                  className="flex-1 py-2.5 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-sm transition-all">
                  Cancel
                </button>
                <button onClick={handleReject} disabled={submitting}
                  className="flex-1 py-2.5 bg-red-600 hover:bg-red-500 disabled:opacity-50
                             text-white rounded-xl text-sm font-semibold transition-all">
                  {submitting ? 'Rejecting...' : 'Confirm Reject'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminLeaves;
