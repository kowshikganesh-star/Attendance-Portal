// src/pages/AttendanceHistory.jsx
import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { Clock, LogOut, ArrowLeft, Calendar, Filter, CheckCircle, AlertCircle } from 'lucide-react';

const API = import.meta.env.VITE_API_URL;

const AttendanceHistory = () => {
  const { user, logout } = useAuth();
  const navigate         = useNavigate();

  const now          = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  const [filterType, setFilterType] = useState('month');
  const [month,      setMonth]      = useState(currentMonth);
  const [startDate,  setStartDate]  = useState('');
  const [endDate,    setEndDate]    = useState('');
  const [history,    setHistory]    = useState([]);
  const [loading,    setLoading]    = useState(true);

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
      const { data } = await axios.get(`${API}/attendance/history`, { params });
      setHistory(data.history);
    } catch {
      setHistory([]);
    } finally {
      setLoading(false);
    }
  }, [filterType, month, startDate, endDate]);

  useEffect(() => { fetchHistory(); }, [fetchHistory]);

  const formatTime = (date) => date
    ? new Date(date).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })
    : '—';

  const formatDate = (dateStr) =>
    new Date(dateStr).toLocaleDateString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
    });

  const totalDays    = history.length;
  const totalMs      = history.reduce((acc, d) => acc + (d.totalWorked.totalMs || 0), 0);
  const totalHours   = Math.floor(totalMs / 3600000);
  const totalMins    = Math.floor((totalMs % 3600000) / 60000);
  const completeDays = history.filter((d) => d.isComplete).length;

  return (
    <div className="min-h-screen bg-slate-950 text-white">

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
        <div className="flex items-center gap-3 mb-6">
          <button onClick={() => navigate('/employee/dashboard')}
            className="p-2 hover:bg-slate-800 rounded-lg transition-all text-slate-400 hover:text-white">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-2xl font-bold">Attendance History</h1>
            <p className="text-slate-400 text-sm">Your complete attendance records</p>
          </div>
        </div>

        {/* Filter */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 mb-6">
          <div className="flex items-center gap-2 mb-4">
            <Filter className="w-4 h-4 text-slate-400" />
            <span className="text-sm font-medium text-slate-300">Filter Records</span>
          </div>
          <div className="flex gap-2 mb-4">
            {['month', 'range'].map((type) => (
              <button key={type} onClick={() => setFilterType(type)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-all
                  ${filterType === type ? 'bg-emerald-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-white'}`}>
                {type === 'month' ? '📅 By Month' : '📆 Date Range'}
              </button>
            ))}
          </div>
          {filterType === 'month' ? (
            <input type="month" value={month} onChange={(e) => setMonth(e.target.value)}
              className="px-4 py-2 bg-slate-800 border border-slate-700 rounded-xl text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500" />
          ) : (
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-2">
                <span className="text-slate-400 text-sm">From</span>
                <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)}
                  className="px-4 py-2 bg-slate-800 border border-slate-700 rounded-xl text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500" />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-slate-400 text-sm">To</span>
                <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)}
                  className="px-4 py-2 bg-slate-800 border border-slate-700 rounded-xl text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500" />
              </div>
              <button onClick={fetchHistory}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-sm rounded-xl transition-all">
                Apply
              </button>
            </div>
          )}
        </div>

        {/* Summary */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          {[
            { label: 'Days Present',    value: totalDays,                    color: 'text-white' },
            { label: 'Complete Days',   value: completeDays,                 color: 'text-emerald-400' },
            { label: 'Incomplete Days', value: totalDays - completeDays,     color: 'text-amber-400' },
            { label: 'Total Hours',     value: `${totalHours}h ${totalMins}m`, color: 'text-indigo-400' },
          ].map(({ label, value, color }) => (
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
            <h2 className="font-semibold">Records</h2>
            <span className="text-xs bg-slate-700 text-slate-300 px-2 py-0.5 rounded-full">
              {history.length} days
            </span>
          </div>

          {loading ? (
            <div className="flex justify-center py-12">
              <div className="w-8 h-8 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : history.length === 0 ? (
            <div className="text-center py-12 text-slate-500">
              <Calendar className="w-10 h-10 mx-auto mb-2 opacity-30" />
              <p>No attendance records found.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-800 text-left">
                    {['Date', 'First Clock In', 'Last Clock Out', 'Sessions', 'Total Hours', 'Status'].map((h) => (
                      <th key={h} className="px-6 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {history.map((row) => (
                    <tr key={row.date} className="hover:bg-slate-800/50 transition-colors">
                      <td className="px-6 py-4 text-sm font-medium text-white whitespace-nowrap">
                        {formatDate(row.date)}
                      </td>
                      <td className="px-6 py-4 text-sm text-slate-300">{formatTime(row.firstClockIn)}</td>
                      <td className="px-6 py-4 text-sm text-slate-300">{formatTime(row.lastClockOut)}</td>
                      <td className="px-6 py-4 text-sm text-slate-300">{row.totalSessions}</td>
                      <td className="px-6 py-4 text-sm font-semibold text-white">
                        {row.totalWorked.hours}h {row.totalWorked.minutes}m
                      </td>
                      <td className="px-6 py-4">
                        {row.isComplete ? (
                          <span className="inline-flex items-center gap-1.5 text-xs bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 px-2.5 py-1 rounded-full font-medium">
                            <CheckCircle className="w-3 h-3" /> Complete
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 text-xs bg-amber-500/20 text-amber-400 border border-amber-500/30 px-2.5 py-1 rounded-full font-medium">
                            <AlertCircle className="w-3 h-3" /> Incomplete
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

export default AttendanceHistory;