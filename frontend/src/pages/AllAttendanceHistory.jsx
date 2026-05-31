// src/pages/AllAttendanceHistory.jsx
import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import toast, { Toaster } from 'react-hot-toast';
import { ShieldCheck, LogOut, ArrowLeft, Calendar, Filter, CheckCircle, AlertCircle } from 'lucide-react';

const API = import.meta.env.VITE_API_URL;

const RoleBadge = ({ role }) => {
  const styles = {
    ADMIN:    'bg-indigo-500/20 text-indigo-400 border-indigo-500/30',
    EMPLOYEE: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  };
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${styles[role] || styles.EMPLOYEE}`}>
      {role}
    </span>
  );
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

  const formatTime = (date) => date
    ? new Date(date).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })
    : '—';

  const formatDate = (date) =>
    new Date(date).toLocaleDateString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric',
    });

  const getDuration = (clockIn, clockOut) => {
    if (!clockOut) return '—';
    const ms = new Date(clockOut) - new Date(clockIn);
    const h  = Math.floor(ms / 3600000);
    const m  = Math.floor((ms % 3600000) / 60000);
    return `${h}h ${m}m`;
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
        <div className="flex items-center gap-3 mb-6">
          <button onClick={() => navigate('/admin/dashboard')}
            className="p-2 hover:bg-slate-800 rounded-lg transition-all text-slate-400 hover:text-white">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-2xl font-bold">All Attendance Records</h1>
            <p className="text-slate-400 text-sm">View and filter all employee attendance</p>
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
                  ${filterType === type ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-white'}`}>
                {type === 'month' ? '📅 By Month' : '📆 Date Range'}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-3 items-end">
            {filterType === 'month' ? (
              <input type="month" value={month} onChange={(e) => setMonth(e.target.value)}
                className="px-4 py-2 bg-slate-800 border border-slate-700 rounded-xl text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            ) : (
              <>
                <div className="flex items-center gap-2">
                  <span className="text-slate-400 text-sm">From</span>
                  <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)}
                    className="px-4 py-2 bg-slate-800 border border-slate-700 rounded-xl text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-slate-400 text-sm">To</span>
                  <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)}
                    className="px-4 py-2 bg-slate-800 border border-slate-700 rounded-xl text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                </div>
              </>
            )}
            <select value={selectedUser} onChange={(e) => setSelectedUser(e.target.value)}
              className="px-4 py-2 bg-slate-800 border border-slate-700 rounded-xl text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
              <option value="">All Employees</option>
              {employees.map((emp) => (
                <option key={emp.id} value={emp.id}>{emp.name}</option>
              ))}
            </select>
            {filterType === 'range' && (
              <button onClick={fetchHistory}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm rounded-xl transition-all">
                Apply
              </button>
            )}
          </div>
        </div>

        {/* Summary */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          {[
            { label: 'Total Records',  value: records.length },
            { label: 'Complete',       value: records.filter((r) => r.clockOut).length,  color: 'text-emerald-400' },
            { label: 'Still Active',   value: records.filter((r) => !r.clockOut).length, color: 'text-amber-400'   },
            { label: 'Employees',      value: [...new Set(records.map((r) => r.userId))].length, color: 'text-indigo-400' },
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
            <h2 className="font-semibold">Attendance Records</h2>
            <span className="text-xs bg-slate-700 text-slate-300 px-2 py-0.5 rounded-full">
              {records.length} entries
            </span>
          </div>

          {loading ? (
            <div className="flex justify-center py-12">
              <div className="w-8 h-8 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : records.length === 0 ? (
            <div className="text-center py-12 text-slate-500">
              <Calendar className="w-10 h-10 mx-auto mb-2 opacity-30" />
              <p>No records found.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-800 text-left">
                    {['Employee', 'Role', 'Date', 'Clock In', 'Clock Out', 'Duration', 'Status'].map((h) => (
                      <th key={h} className="px-6 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {records.map((record) => (
                    <tr key={record.id} className="hover:bg-slate-800/50 transition-colors">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 bg-indigo-600 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0">
                            {record.user.name.charAt(0)}
                          </div>
                          <div>
                            <p className="text-sm font-medium text-white">{record.user.name}</p>
                            <p className="text-xs text-slate-400">{record.user.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4"><RoleBadge role={record.user.role} /></td>
                      <td className="px-6 py-4 text-sm text-slate-300 whitespace-nowrap">{formatDate(record.clockIn)}</td>
                      <td className="px-6 py-4 text-sm text-slate-300">{formatTime(record.clockIn)}</td>
                      <td className="px-6 py-4 text-sm text-slate-300">{formatTime(record.clockOut)}</td>
                      <td className="px-6 py-4 text-sm font-semibold text-white">{getDuration(record.clockIn, record.clockOut)}</td>
                      <td className="px-6 py-4">
                        {record.clockOut ? (
                          <span className="inline-flex items-center gap-1.5 text-xs bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 px-2.5 py-1 rounded-full">
                            <CheckCircle className="w-3 h-3" /> Complete
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 text-xs bg-amber-500/20 text-amber-400 border border-amber-500/30 px-2.5 py-1 rounded-full">
                            <AlertCircle className="w-3 h-3" /> Active
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

export default AllAttendanceHistory;