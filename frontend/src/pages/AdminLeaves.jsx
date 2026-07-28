// src/pages/AdminLeaves.jsx
import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import toast, { Toaster } from 'react-hot-toast';
import {
  ShieldCheck, LogOut, ArrowLeft, CheckCircle,
  XCircle, AlertCircle, Calendar, X, ChevronDown, ChevronUp, Scale,
  AlertTriangle, Scissors,
} from 'lucide-react';

const API = import.meta.env.VITE_API_URL;

// Types that have a balance. LOP / HD_LOP are unpaid → unlimited.
const BALANCE_TYPES = ['SL', 'CL', 'PL'];

const VALID_TYPES = ['SL', 'CL', 'LOP', 'HD_LOP', 'PL'];

const TYPE_LABELS = {
  SL: 'SL — Sick Leave',
  CL: 'CL — Casual Leave',
  LOP: 'LOP — Loss of Pay',
  HD_LOP: 'HD-LOP — Half Day LOP',
  PL: 'PL — Privileged Leave',
};

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
      <p className={`text-sm text-slate-200 leading-relaxed transition-all duration-200
        ${isExpanded ? 'whitespace-normal break-words' : 'truncate max-w-[130px]'}`}>
        {text}
      </p>
      <span className="flex items-center gap-1 mt-1.5 text-indigo-400 text-xs font-medium">
        {isExpanded
          ? <><ChevronUp   className="w-3 h-3" /> minimize</>
          : <><ChevronDown className="w-3 h-3" /> expand</>}
      </span>
    </div>
  );
};

// Working days between two dates, inclusive, skipping Sat/Sun.
const workingDays = (from, to) => {
  const start = new Date(from); start.setHours(0, 0, 0, 0);
  const end   = new Date(to);   end.setHours(0, 0, 0, 0);
  if (end < start) return 0;
  let count = 0;
  const cur = new Date(start);
  while (cur <= end) {
    const d = cur.getDay();
    if (d !== 0 && d !== 6) count++;
    cur.setDate(cur.getDate() + 1);
  }
  return count;
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

  // Balance of the employee whose leave is being approved
  const [balance,        setBalance]        = useState(null);
  const [balanceLoading, setBalanceLoading] = useState(false);

  // Split approval state
  const [useSplit,      setUseSplit]      = useState(false);
  const [customSplits,  setCustomSplits]  = useState(null); // null = use suggested

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

  // Open approve modal + fetch employee's balance for the leave year
  const openApproveModal = async (leave) => {
    setApproveModal(leave);
    setApproveType(leave.type);
    setBalance(null);
    setBalanceLoading(true);
    setUseSplit(false);
    setCustomSplits(null);

    try {
      const year = new Date(leave.fromDate).getFullYear();
      const { data } = await axios.get(
        `${API}/leave-balances/user/${leave.user.id}`,
        { params: { year } }
      );
      setBalance(data.balances);
    } catch {
      setBalance(null);
    } finally {
      setBalanceLoading(false);
    }
  };

  const closeApprove = () => {
    setApproveModal(null);
    setBalance(null);
    setUseSplit(false);
    setCustomSplits(null);
  };

  // Reset split state whenever approveType changes
  useEffect(() => {
    setUseSplit(false);
    setCustomSplits(null);
  }, [approveType]);

  // ── Working days that will be deducted ──
  const approveDays = approveModal
    ? workingDays(approveModal.fromDate, approveModal.toDate)
    : 0;

  const selectedBal   = balance?.[approveType] || null;
  const isBalanceType = BALANCE_TYPES.includes(approveType);
  const allowanceSet  = selectedBal && selectedBal.allowed !== null;
  const afterApproval = allowanceSet ? selectedBal.remaining - approveDays : null;
  const insufficient  = afterApproval !== null && afterApproval < 0;

  // ── Compute auto-suggested split ──────────────────────────────────────────
  // Called when primary type doesn't have enough balance.
  // Strategy: use as much of primary type as possible, overflow → best available
  // balance type, fall back to LOP.
  const computeSuggestedSplit = () => {
    if (!balance || !approveModal || !insufficient) return null;

    const primaryRemaining = Math.max(0, balance[approveType]?.remaining ?? 0);
    if (primaryRemaining === 0) return null; // nothing to split from primary

    const overflowDays = approveDays - primaryRemaining;

    // Pick best fallback: prefer type with enough balance, else LOP
    const fallbackType = (() => {
      // Try other balance types first (exclude primary)
      for (const t of BALANCE_TYPES) {
        if (t === approveType) continue;
        const rem = balance[t]?.remaining ?? 0;
        if (rem >= overflowDays) return t;
      }
      // Partial coverage from another type
      for (const t of BALANCE_TYPES) {
        if (t === approveType) continue;
        const rem = balance[t]?.remaining ?? 0;
        if (rem > 0) return t;
      }
      return 'LOP';
    })();

    return [
      { type: approveType, days: primaryRemaining },
      { type: fallbackType, days: overflowDays },
    ];
  };

  const suggestedSplit = computeSuggestedSplit();
  // Active splits: custom if set, else suggested
  const activeSplits = customSplits || suggestedSplit;

  // Validate custom splits total matches approveDays
  const splitTotalDays = activeSplits
    ? activeSplits.reduce((s, c) => s + (parseInt(c.days) || 0), 0)
    : 0;
  const splitValid = splitTotalDays === approveDays;

  // ── Handle approve submit ─────────────────────────────────────────────────
  const handleApprove = async () => {
    if (useSplit && !splitValid) {
      toast.error(`Split days (${splitTotalDays}) must total ${approveDays} working days.`);
      return;
    }

    setSubmitting(true);
    try {
      const payload = useSplit && activeSplits
        ? { splits: activeSplits.map((s) => ({ type: s.type, days: parseInt(s.days) })) }
        : { type: approveType };

      const { data } = await axios.patch(`${API}/leaves/${approveModal.id}/approve`, payload);
      toast.success(data.message);
      closeApprove();
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

  // ── Custom split helpers ──────────────────────────────────────────────────
  const initCustomSplits = () => {
    setCustomSplits(
      activeSplits
        ? activeSplits.map((s) => ({ ...s }))
        : [
            { type: approveType, days: approveDays },
            { type: 'LOP', days: 0 },
          ]
    );
  };

  const updateCustomSplitType = (idx, newType) => {
    setCustomSplits((prev) => prev.map((s, i) => i === idx ? { ...s, type: newType } : s));
  };

  const updateCustomSplitDays = (idx, newDays) => {
    setCustomSplits((prev) => prev.map((s, i) => i === idx ? { ...s, days: parseInt(newDays) || 0 } : s));
  };

  const addCustomSplitRow = () => {
    setCustomSplits((prev) => [...prev, { type: 'LOP', days: 0 }]);
  };

  const removeCustomSplitRow = (idx) => {
    setCustomSplits((prev) => prev.filter((_, i) => i !== idx));
  };

  const formatDate = (d) =>
    new Date(d).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });

  const calcDays = (from, to) =>
    Math.ceil((new Date(to) - new Date(from)) / (1000 * 60 * 60 * 24)) + 1;

  // Balance after split for a given type/days pair
  const balanceAfterSplit = (type, days) => {
    if (!BALANCE_TYPES.includes(type)) return null;
    const rem = balance?.[type]?.remaining;
    if (rem === null || rem === undefined) return null;
    return rem - days;
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

      <main className="p-6 max-w-7xl mx-auto">

        {/* Header */}
        <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate('/admin/dashboard')}
              className="p-2 hover:bg-slate-800 rounded-lg transition-all text-slate-400 hover:text-white">
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div>
              <h1 className="text-2xl font-bold">Leave Management</h1>
              <p className="text-slate-400 text-sm">Review and manage employee leave requests</p>
            </div>
          </div>

          <button onClick={() => navigate('/admin/leave-balances')}
            className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700
                       text-white px-4 py-2.5 rounded-xl text-sm font-semibold
                       transition-all border border-slate-700">
            <Scale className="w-4 h-4" /> Leave Balances
          </button>
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
                  {leaves.map((leave) => {
                    const wd = workingDays(leave.fromDate, leave.toDate);
                    const cd = calcDays(leave.fromDate, leave.toDate);
                    return (
                      <tr key={leave.id} className="hover:bg-slate-800/50 transition-colors">
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

                        <td className="px-5 py-4 whitespace-nowrap">
                          <p className="text-sm font-semibold text-white">{cd}</p>
                          {wd !== cd && (
                            <p className="text-xs text-slate-500">{wd} working</p>
                          )}
                        </td>

                        <td className="px-5 py-4 min-w-[150px] max-w-[300px]">
                          <ExpandableCell
                            text={leave.reason}
                            cellKey={`reason-${leave.id}`}
                            expandedCell={expandedCell}
                            setExpandedCell={setExpandedCell}
                          />
                        </td>

                        <td className="px-5 py-4"><StatusBadge status={leave.status} /></td>

                        <td className="px-5 py-4 min-w-[150px] max-w-[300px]">
                          <ExpandableCell
                            text={leave.adminRemark || '—'}
                            cellKey={`remark-${leave.id}`}
                            expandedCell={expandedCell}
                            setExpandedCell={setExpandedCell}
                          />
                        </td>

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
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>

      {/* ══════════════════════════════════════════════════════════════
          APPROVE MODAL — with split-leave support
      ══════════════════════════════════════════════════════════════ */}
      {approveModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-lg shadow-2xl max-h-[90vh] overflow-y-auto">

            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 sticky top-0 bg-slate-900 z-10">
              <h3 className="font-semibold text-white">Approve Leave Request</h3>
              <button onClick={closeApprove}
                className="text-slate-400 hover:text-white p-1 hover:bg-slate-800 rounded-lg transition-all">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4">

              {/* Who / how long */}
              <div className="p-4 bg-slate-800 rounded-xl">
                <p className="text-sm text-slate-300">
                  Approving{' '}
                  <span className="text-white font-semibold">{approveModal.user.name}</span>'s leave for{' '}
                  <span className="text-white font-semibold">
                    {calcDays(approveModal.fromDate, approveModal.toDate)} day(s)
                  </span>
                </p>
                <p className="text-xs text-slate-400 mt-1">
                  {formatDate(approveModal.fromDate)} → {formatDate(approveModal.toDate)}
                  {' · '}
                  <span className="text-slate-300 font-medium">
                    {approveDays} working day{approveDays === 1 ? '' : 's'}
                  </span>
                  {' will be deducted'}
                </p>
              </div>

              {/* Leave balance cards */}
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <Scale className="w-4 h-4 text-slate-400" />
                  <p className="text-sm font-medium text-slate-300">
                    Leave balance — {new Date(approveModal.fromDate).getFullYear()}
                  </p>
                </div>

                {balanceLoading ? (
                  <div className="flex justify-center py-4">
                    <div className="w-5 h-5 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                  </div>
                ) : !balance ? (
                  <div className="p-3 bg-slate-800 rounded-xl">
                    <p className="text-xs text-slate-500">Could not load balance.</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-3 gap-2">
                    {BALANCE_TYPES.map((t) => {
                      const b        = balance[t];
                      const notSet   = !b || b.allowed === null;
                      const isActive = approveType === t;

                      return (
                        <div key={t}
                          className={`rounded-xl p-3 text-center border transition-all
                            ${isActive
                              ? 'bg-indigo-500/10 border-indigo-500/50'
                              : 'bg-slate-800 border-slate-700'}`}>
                          <p className="text-xs text-slate-400 mb-1">{t}</p>
                          {notSet ? (
                            <>
                              <p className="text-sm text-slate-600">not set</p>
                              {b?.used > 0 && (
                                <p className="text-[10px] text-amber-400 mt-0.5">{b.used} used</p>
                              )}
                            </>
                          ) : (
                            <>
                              <p className={`text-xl font-bold ${
                                b.remaining < 0    ? 'text-red-400'
                                  : b.remaining <= 2 ? 'text-amber-400'
                                  : 'text-emerald-400'
                              }`}>
                                {b.remaining}
                              </p>
                              <p className="text-[10px] text-slate-500">
                                {b.used} / {b.allowed}
                              </p>
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                <p className="text-[11px] text-slate-500 mt-2">
                  LOP and HD-LOP are unpaid — no balance limit.
                </p>
              </div>

              {/* Approve as — single type selector (hidden when split mode active) */}
              {!useSplit && (
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1.5">
                    Approve as
                  </label>
                  <select value={approveType} onChange={(e) => setApproveType(e.target.value)}
                    className="w-full px-4 py-2.5 bg-slate-800 border border-slate-700 rounded-xl
                               text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500">
                    {VALID_TYPES.map((t) => (
                      <option key={t} value={t}>{TYPE_LABELS[t]}</option>
                    ))}
                  </select>

                  {approveType !== approveModal.type && (
                    <p className="text-xs text-amber-400 mt-1.5">
                      Changing from {approveModal.type} to {approveType}
                    </p>
                  )}
                </div>
              )}

              {/* ── Balance impact / split UI ── */}
              {!balanceLoading && balance && (
                <>
                  {/* SUFFICIENT balance — simple green banner */}
                  {isBalanceType && !insufficient && allowanceSet && !useSplit && (
                    <div className="p-3 bg-slate-800 border border-slate-700 rounded-xl flex gap-2.5">
                      <CheckCircle className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
                      <p className="text-slate-300 text-xs">
                        After approval:{' '}
                        <span className="text-white font-semibold">{afterApproval}</span>{' '}
                        {approveType} remaining
                        <span className="text-slate-500"> (was {selectedBal.remaining})</span>
                      </p>
                    </div>
                  )}

                  {/* Allowance not set warning */}
                  {isBalanceType && !allowanceSet && !useSplit && (
                    <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl flex gap-2.5">
                      <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
                      <p className="text-amber-300 text-xs">
                        No {approveType} allowance set for this employee — balance won't be
                        meaningful until assigned on the Leave Balances page.
                      </p>
                    </div>
                  )}

                  {/* INSUFFICIENT balance — split suggestion */}
                  {isBalanceType && insufficient && !useSplit && (
                    <div className="rounded-xl border border-red-500/30 bg-red-500/10 overflow-hidden">
                      <div className="p-3 flex gap-2.5">
                        <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                        <div className="flex-1 min-w-0">
                          <p className="text-red-300 font-medium text-xs">
                            Not enough {approveType} balance
                          </p>
                          <p className="text-slate-300 text-xs mt-0.5">
                            {selectedBal.remaining} left, this leave needs {approveDays}.
                            Approving as-is leaves them at{' '}
                            <span className="text-red-300 font-semibold">{afterApproval}</span>.
                          </p>
                        </div>
                      </div>

                      {/* Split suggestion preview */}
                      {suggestedSplit && (
                        <div className="px-3 pb-3 space-y-1.5">
                          <p className="text-xs text-slate-400 font-medium mb-2">
                            Suggested split:
                          </p>
                          {suggestedSplit.map((s, i) => {
                            const after = balanceAfterSplit(s.type, s.days);
                            return (
                              <div key={i}
                                className="flex items-center justify-between bg-slate-800 rounded-lg px-3 py-2">
                                <TypeBadge type={s.type} />
                                <span className="text-white text-xs font-semibold">
                                  {s.days} day{s.days !== 1 ? 's' : ''}
                                </span>
                                {after !== null ? (
                                  <span className={`text-xs ${after < 0 ? 'text-red-400' : 'text-slate-400'}`}>
                                    bal: {balance[s.type]?.remaining} → {after}
                                  </span>
                                ) : (
                                  <span className="text-xs text-slate-500">unpaid</span>
                                )}
                              </div>
                            );
                          })}

                          {/* Split / Force toggle */}
                          <div className="flex gap-2 mt-3">
                            <button
                              onClick={() => { setUseSplit(true); setCustomSplits(null); }}
                              className="flex-1 flex items-center justify-center gap-1.5 py-2
                                         bg-emerald-600 hover:bg-emerald-500 text-white text-xs
                                         rounded-lg font-medium transition-all">
                              <Scissors className="w-3 h-3" /> Use split
                            </button>
                            <button
                              onClick={() => setUseSplit(false)}
                              className="flex-1 py-2 bg-amber-600 hover:bg-amber-500
                                         text-white text-xs rounded-lg font-medium transition-all">
                              Force as {approveType} (−{Math.abs(afterApproval)})
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* ── SPLIT MODE UI ── */}
                  {useSplit && (
                    <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 overflow-hidden">
                      <div className="px-4 pt-3 pb-2 flex items-center justify-between border-b border-emerald-500/20">
                        <div className="flex items-center gap-2">
                          <Scissors className="w-4 h-4 text-emerald-400" />
                          <span className="text-sm font-medium text-emerald-300">Split approval</span>
                        </div>
                        <button
                          onClick={() => { setUseSplit(false); setCustomSplits(null); }}
                          className="text-xs text-slate-400 hover:text-white transition-all">
                          cancel split
                        </button>
                      </div>

                      <div className="p-4 space-y-2">
                        {/* Split rows */}
                        {(customSplits || suggestedSplit || []).map((s, i) => {
                          const after = balanceAfterSplit(s.type, parseInt(s.days) || 0);
                          return (
                            <div key={i} className="flex items-center gap-2">
                              {/* Type select */}
                              <select
                                value={s.type}
                                onChange={(e) => {
                                  if (!customSplits) initCustomSplits();
                                  updateCustomSplitType(i, e.target.value);
                                }}
                                className="flex-1 px-2 py-1.5 bg-slate-800 border border-slate-700
                                           rounded-lg text-white text-xs focus:outline-none focus:ring-1
                                           focus:ring-emerald-500">
                                {VALID_TYPES.map((t) => (
                                  <option key={t} value={t}>{t}</option>
                                ))}
                              </select>

                              {/* Days input */}
                              <input
                                type="number"
                                min={1}
                                max={approveDays}
                                value={s.days}
                                onChange={(e) => {
                                  if (!customSplits) initCustomSplits();
                                  updateCustomSplitDays(i, e.target.value);
                                }}
                                className="w-16 px-2 py-1.5 bg-slate-800 border border-slate-700
                                           rounded-lg text-white text-xs text-center
                                           focus:outline-none focus:ring-1 focus:ring-emerald-500"
                              />
                              <span className="text-xs text-slate-500 w-6">days</span>

                              {/* Balance after */}
                              {after !== null ? (
                                <span className={`text-xs w-20 text-right ${after < 0 ? 'text-red-400' : 'text-slate-400'}`}>
                                  → {after} left
                                </span>
                              ) : (
                                <span className="text-xs w-20 text-right text-slate-500">unpaid</span>
                              )}

                              {/* Remove row (only if >2 rows) */}
                              {(customSplits || suggestedSplit || []).length > 2 && (
                                <button
                                  onClick={() => {
                                    if (!customSplits) initCustomSplits();
                                    removeCustomSplitRow(i);
                                  }}
                                  className="text-slate-500 hover:text-red-400 transition-all p-1">
                                  <X className="w-3 h-3" />
                                </button>
                              )}
                            </div>
                          );
                        })}

                        {/* Add row */}
                        <button
                          onClick={() => { if (!customSplits) initCustomSplits(); addCustomSplitRow(); }}
                          className="text-xs text-slate-400 hover:text-white transition-all mt-1">
                          + add row
                        </button>

                        {/* Total validation */}
                        <div className={`flex items-center justify-between pt-2 border-t ${
                          splitValid ? 'border-emerald-500/20' : 'border-red-500/20'
                        }`}>
                          <span className="text-xs text-slate-400">Total days</span>
                          <span className={`text-xs font-semibold ${
                            splitValid ? 'text-emerald-400' : 'text-red-400'
                          }`}>
                            {splitTotalDays} / {approveDays}
                            {!splitValid && ' — must match'}
                          </span>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* LOP info */}
                  {!isBalanceType && !useSplit && (
                    <div className="p-3 bg-slate-800 border border-slate-700 rounded-xl">
                      <p className="text-xs text-slate-400">
                        {approveType} is unpaid — it does not use any leave balance.
                      </p>
                    </div>
                  )}
                </>
              )}

              {/* Action buttons */}
              <div className="flex gap-3 pt-1">
                <button onClick={closeApprove}
                  className="flex-1 py-2.5 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-sm transition-all">
                  Cancel
                </button>
                <button
                  onClick={handleApprove}
                  disabled={submitting || (useSplit && !splitValid)}
                  className={`flex-1 py-2.5 disabled:opacity-50 text-white rounded-xl text-sm font-semibold transition-all
                    ${useSplit
                      ? 'bg-emerald-600 hover:bg-emerald-500'
                      : insufficient
                        ? 'bg-amber-600 hover:bg-amber-500'
                        : 'bg-emerald-600 hover:bg-emerald-500'
                    }`}>
                  {submitting
                    ? 'Approving...'
                    : useSplit
                      ? `Approve Split (${splitTotalDays}d)`
                      : insufficient
                        ? 'Approve Anyway'
                        : 'Confirm Approve'}
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
                  Rejecting{' '}
                  <span className="text-white font-semibold">{rejectModal.user.name}</span>'s{' '}
                  <span className="text-orange-400">{rejectModal.type}</span> leave request for{' '}
                  <span className="text-white font-semibold">
                    {calcDays(rejectModal.fromDate, rejectModal.toDate)} day(s)
                  </span>
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