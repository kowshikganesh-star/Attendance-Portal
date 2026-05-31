// src/pages/AllReports.jsx
import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import toast, { Toaster } from 'react-hot-toast';
import { ShieldCheck, LogOut, ArrowLeft, Download, TrendingUp, Clock, Users } from 'lucide-react';

const API = import.meta.env.VITE_API_URL;

const AllReports = () => {
  const { user, logout, token } = useAuth();
  const navigate                = useNavigate();

  const now          = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  const [month,     setMonth]     = useState(currentMonth);
  const [summaries, setSummaries] = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [exporting, setExporting] = useState(false);
  const [search,    setSearch]    = useState('');

  const fetchReport = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await axios.get(`${API}/reports/all`, { params: { month } });
      setSummaries(data.summaries);
    } catch {
      toast.error('Failed to load reports.');
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
      link.setAttribute('download', `all_attendance_${month}.csv`);
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

  const monthLabel = new Date(month + '-01').toLocaleDateString('en-US', {
    month: 'long', year: 'numeric',
  });

  const filtered = summaries.filter((s) =>
    s.name.toLowerCase().includes(search.toLowerCase()) ||
    s.email.toLowerCase().includes(search.toLowerCase())
  );

  // Only show employees in reports
  const employeeFiltered = filtered.filter((s) => s.role === 'EMPLOYEE');

  const totalPresent = employeeFiltered.reduce((acc, s) => acc + s.daysPresent, 0);
  const totalHoursMs = employeeFiltered.reduce((acc, s) => acc + s.totalMs,     0);
  const totalHours   = Math.floor(totalHoursMs / 3600000);
  const activeUsers  = employeeFiltered.filter((s) => s.daysPresent > 0).length;

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
        <div className="flex items-center justify-between mb-6 flex-wrap gap-4">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate('/admin/dashboard')}
              className="p-2 hover:bg-slate-800 rounded-lg transition-all text-slate-400 hover:text-white">
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div>
              <h1 className="text-2xl font-bold">Attendance Reports</h1>
              <p className="text-slate-400 text-sm">All employees — {monthLabel}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <input type="month" value={month} onChange={(e) => setMonth(e.target.value)}
              className="px-4 py-2 bg-slate-900 border border-slate-800 rounded-xl text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            <button onClick={handleExport} disabled={exporting}
              className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500
                         disabled:opacity-50 text-white px-4 py-2 rounded-xl text-sm font-semibold transition-all">
              <Download className="w-4 h-4" />
              {exporting ? 'Exporting...' : 'Export CSV'}
            </button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          {[
            { label: 'Active Employees',      value: activeUsers,   color: 'text-emerald-400' },
            { label: 'Total Attendance Days', value: totalPresent,  color: 'text-white'        },
            { label: 'Total Hours (All)',      value: `${totalHours}h`, color: 'text-indigo-400' },
            { label: 'Total Employees',        value: employeeFiltered.length, color: 'text-slate-300' },
          ].map(({ label, value, color }) => (
            <div key={label} className="bg-slate-900 border border-slate-800 rounded-xl p-5">
              <p className="text-slate-400 text-xs mb-1">{label}</p>
              <p className={`text-2xl font-bold ${color}`}>{value}</p>
            </div>
          ))}
        </div>

        {/* Search */}
        <div className="relative mb-4">
          <input type="text" placeholder="Search employee by name or email..."
            value={search} onChange={(e) => setSearch(e.target.value)}
            className="w-full px-4 py-2.5 bg-slate-900 border border-slate-800 rounded-xl
                       text-white text-sm placeholder-slate-500
                       focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
          />
        </div>

        {/* Table */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-800 flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-slate-400" />
            <h2 className="font-semibold">Employee Summary</h2>
            <span className="text-xs bg-slate-700 text-slate-300 px-2 py-0.5 rounded-full">
              {employeeFiltered.length} employees
            </span>
          </div>

          {loading ? (
            <div className="flex justify-center py-12">
              <div className="w-8 h-8 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : employeeFiltered.length === 0 ? (
            <div className="text-center py-12 text-slate-500">
              <Users className="w-10 h-10 mx-auto mb-2 opacity-30" />
              <p>No employees found.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-800 text-left">
                    {['Employee', 'Days Present', 'Total Hours', 'Avg / Day', 'Sessions', 'Earliest In', 'Latest Out'].map((h) => (
                      <th key={h} className="px-5 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {employeeFiltered.map((s) => (
                    <tr key={s.userId}
                      className={`hover:bg-slate-800/50 transition-colors ${s.daysPresent === 0 ? 'opacity-40' : ''}`}
                    >
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 bg-indigo-600 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0">
                            {s.name.charAt(0)}
                          </div>
                          <div>
                            <p className="text-sm font-medium text-white">{s.name}</p>
                            <p className="text-xs text-slate-400">{s.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-4 text-sm font-semibold text-emerald-400">{s.daysPresent}</td>
                      <td className="px-5 py-4 text-sm font-semibold text-white">{s.totalWorked.hours}h {s.totalWorked.minutes}m</td>
                      <td className="px-5 py-4 text-sm text-slate-300">{s.avgPerDay.hours}h {s.avgPerDay.minutes}m</td>
                      <td className="px-5 py-4 text-sm text-slate-300">{s.totalSessions}</td>
                      <td className="px-5 py-4 text-sm text-slate-300">
                        <div className="flex items-center gap-1">
                          <Clock className="w-3 h-3 text-slate-500" />
                          {s.earliestClockIn}
                        </div>
                      </td>
                      <td className="px-5 py-4 text-sm text-slate-300">
                        <div className="flex items-center gap-1">
                          <Clock className="w-3 h-3 text-slate-500" />
                          {s.latestClockOut}
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
    </div>
  );
};

export default AllReports;