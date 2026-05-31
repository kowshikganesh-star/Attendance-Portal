// src/pages/MyReport.jsx
import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import toast, { Toaster } from 'react-hot-toast';
import { Clock, LogOut, ArrowLeft, Download, Calendar, CheckCircle, AlertCircle, TrendingUp } from 'lucide-react';

const API = import.meta.env.VITE_API_URL;

const StatCard = ({ label, value, sub, color = 'text-white' }) => (
  <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
    <p className="text-slate-400 text-xs mb-1">{label}</p>
    <p className={`text-2xl font-bold ${color}`}>{value}</p>
    {sub && <p className="text-slate-500 text-xs mt-1">{sub}</p>}
  </div>
);

const MyReport = () => {
  const { user, logout, token } = useAuth();
  const navigate = useNavigate();

  const now          = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  const [month,     setMonth]     = useState(currentMonth);
  const [data,      setData]      = useState(null);
  const [loading,   setLoading]   = useState(true);
  const [exporting, setExporting] = useState(false);

  const fetchReport = useCallback(async () => {
    setLoading(true);
    try {
      const { data: res } = await axios.get(`${API}/reports/summary`, { params: { month } });
      setData(res);
    } catch {
      toast.error('Failed to load report.');
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => { fetchReport(); }, [fetchReport]);

  const handleExport = async () => {
    setExporting(true);
    try {
      const response = await axios.get(`${API}/reports/export`, {
        params:       { month },
        responseType: 'blob',
        headers:      { Authorization: `Bearer ${token}` },
      });
      const url  = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href  = url;
      link.setAttribute('download', `my_attendance_${month}.csv`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      toast.success('CSV downloaded!');
    } catch {
      toast.error('Export failed.');
    } finally {
      setExporting(false);
    }
  };

  const formatDate = (d) =>
    new Date(d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

  const monthLabel = new Date(month + '-01').toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

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
              <h1 className="text-2xl font-bold">My Report</h1>
              <p className="text-slate-400 text-sm">Your attendance summary — {monthLabel}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <input type="month" value={month} onChange={(e) => setMonth(e.target.value)}
              className="px-4 py-2 bg-slate-900 border border-slate-800 rounded-xl text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500" />
            <button onClick={handleExport} disabled={exporting}
              className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500
                         disabled:opacity-50 text-white px-4 py-2 rounded-xl text-sm font-semibold transition-all">
              <Download className="w-4 h-4" />
              {exporting ? 'Exporting...' : 'Export CSV'}
            </button>
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-20">
            <div className="w-10 h-10 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : data ? (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
              <StatCard label="Days Present"  value={data.summary.daysPresent} color="text-emerald-400" />
              <StatCard label="Total Hours"   value={`${data.summary.totalWorked.hours}h ${data.summary.totalWorked.minutes}m`} color="text-indigo-400" />
              <StatCard label="Avg Hours / Day" value={`${data.summary.avgPerDay.hours}h ${data.summary.avgPerDay.minutes}m`} color="text-violet-400" />
              <StatCard label="Total Sessions" value={data.summary.totalSessions}
                sub={`${data.summary.incompleteDays} incomplete days`} color="text-white" />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
                <div className="flex items-center gap-2 mb-3">
                  <TrendingUp className="w-4 h-4 text-slate-400" />
                  <p className="text-sm font-medium text-slate-300">Time Patterns</p>
                </div>
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-400">Earliest Clock In</span>
                    <span className="text-white font-medium">{data.summary.earliestClockIn}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-400">Latest Clock Out</span>
                    <span className="text-white font-medium">{data.summary.latestClockOut}</span>
                  </div>
                </div>
              </div>
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
                <div className="flex items-center gap-2 mb-3">
                  <Calendar className="w-4 h-4 text-slate-400" />
                  <p className="text-sm font-medium text-slate-300">Attendance Health</p>
                </div>
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-400">Complete Days</span>
                    <span className="text-emerald-400 font-medium">
                      {data.summary.daysPresent - data.summary.incompleteDays}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-400">Incomplete Days</span>
                    <span className="text-amber-400 font-medium">{data.summary.incompleteDays}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Daily Breakdown */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-800 flex items-center gap-2">
                <Calendar className="w-5 h-5 text-slate-400" />
                <h2 className="font-semibold">Daily Breakdown</h2>
                <span className="text-xs bg-slate-700 text-slate-300 px-2 py-0.5 rounded-full">
                  {data.dailyBreakdown.length} days
                </span>
              </div>

              {data.dailyBreakdown.length === 0 ? (
                <div className="text-center py-12 text-slate-500">
                  <Calendar className="w-10 h-10 mx-auto mb-2 opacity-30" />
                  <p>No attendance data for {monthLabel}.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-slate-800 text-left">
                        {['Date', 'Sessions', 'Hours Worked', 'Status'].map((h) => (
                          <th key={h} className="px-6 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800">
                      {data.dailyBreakdown.map((row) => (
                        <tr key={row.date} className="hover:bg-slate-800/50 transition-colors">
                          <td className="px-6 py-4 text-sm font-medium text-white">
                            {formatDate(row.date + 'T00:00:00')}
                          </td>
                          <td className="px-6 py-4 text-sm text-slate-300">{row.sessions}</td>
                          <td className="px-6 py-4 text-sm font-semibold text-white">
                            {row.hoursWorked}h {row.minutes}m
                          </td>
                          <td className="px-6 py-4">
                            {row.isComplete ? (
                              <span className="inline-flex items-center gap-1.5 text-xs bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 px-2.5 py-1 rounded-full">
                                <CheckCircle className="w-3 h-3" /> Complete
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1.5 text-xs bg-amber-500/20 text-amber-400 border border-amber-500/30 px-2.5 py-1 rounded-full">
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
          </>
        ) : null}
      </main>
    </div>
  );
};

export default MyReport;