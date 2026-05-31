// src/pages/AdminDashboard.jsx
import { useState, useEffect } from 'react';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { ShieldCheck, LogOut, Users, Clock, History, FileText, BarChart2 } from 'lucide-react';
import LocationMap from '../components/LocationMap';

const API = import.meta.env.VITE_API_URL;

const AdminDashboard = () => {
  const { user, logout } = useAuth();
  const navigate         = useNavigate();

  const [active,  setActive]  = useState([]);
  const [stats,   setStats]   = useState({ totalEmployees: 0, onLeave: 0 });
  const [loading, setLoading] = useState(true);

  const fetchActive = async () => {
    try {
      const { data } = await axios.get(`${API}/attendance/active`);
      setActive(data.active);
    } catch {
      setActive([]);
    }
  };

  const fetchStats = async () => {
    try {
      const { data } = await axios.get(`${API}/users/stats/summary`);
      setStats({ totalEmployees: data.totalEmployees, onLeave: data.onLeave });
    } catch {
      setStats({ totalEmployees: 0, onLeave: 0 });
    }
  };

  useEffect(() => {
    const fetchAll = async () => {
      await Promise.all([fetchActive(), fetchStats()]);
      setLoading(false);
    };
    fetchAll();
    const t = setInterval(() => { fetchActive(); fetchStats(); }, 30000);
    return () => clearInterval(t);
  }, []);

  const formatTime = (date) =>
    new Date(date).toLocaleTimeString('en-US', {
      hour: '2-digit', minute: '2-digit', hour12: true,
    });

  return (
    <div className="min-h-screen bg-slate-950 text-white">

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
        <div className="flex items-center gap-3">
          <span className="text-slate-400 text-sm">{user?.name}</span>
          <button onClick={() => navigate('/admin/history')}
            className="flex items-center gap-2 text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 px-3 py-1.5 rounded-lg text-sm transition-all">
            <History className="w-4 h-4" /> History
          </button>
          <button onClick={() => navigate('/admin/users')}
            className="flex items-center gap-2 text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 px-3 py-1.5 rounded-lg text-sm transition-all">
            <Users className="w-4 h-4" /> Users
          </button>
          <button onClick={() => navigate('/admin/leaves')}
            className="flex items-center gap-2 text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 px-3 py-1.5 rounded-lg text-sm transition-all">
            <FileText className="w-4 h-4" /> Leaves
          </button>
          <button onClick={() => navigate('/admin/reports')}
            className="flex items-center gap-2 text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 px-3 py-1.5 rounded-lg text-sm transition-all">
            <BarChart2 className="w-4 h-4" /> Reports
          </button>
          <button onClick={async () => await logout()}
            className="flex items-center gap-2 text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 px-3 py-1.5 rounded-lg text-sm transition-all">
            <LogOut className="w-4 h-4" /> Logout
          </button>
        </div>
      </nav>

      <main className="p-6 max-w-5xl mx-auto">
        <h1 className="text-2xl font-bold mb-2">Admin Dashboard</h1>
        <p className="text-slate-400 mb-6">Full system access — users, reports, settings.</p>

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
            <p className="text-slate-400 text-sm">Currently Clocked In</p>
            <p className="text-3xl font-bold mt-1 text-emerald-400">{active.length}</p>
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
            <p className="text-slate-400 text-sm">Total Employees</p>
            <p className="text-3xl font-bold mt-1 text-white">
              {loading ? '...' : stats.totalEmployees}
            </p>
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
            <p className="text-slate-400 text-sm">On Leave Today</p>
            <p className="text-3xl font-bold mt-1 text-amber-400">
              {loading ? '...' : stats.onLeave}
            </p>
          </div>
        </div>

        {/* Live Active Employees */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 mb-6">
          <div className="flex items-center gap-2 mb-5">
            <div className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse" />
            <h2 className="font-semibold text-white">Live — Currently Clocked In</h2>
            <span className="text-xs bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 px-2 py-0.5 rounded-full">
              {active.length} active
            </span>
          </div>

          {loading ? (
            <div className="flex justify-center py-8">
              <div className="w-8 h-8 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : active.length === 0 ? (
            <div className="text-center py-8 text-slate-500">
              <Users className="w-10 h-10 mx-auto mb-2 opacity-30" />
              <p>No employees currently clocked in.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {active.map((record) => (
                <div key={record.id}
                  className="flex items-center justify-between p-4 bg-slate-800 rounded-xl">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 bg-indigo-600 rounded-full flex items-center justify-center font-bold text-sm">
                      {record.user.name.charAt(0)}
                    </div>
                    <div>
                      <p className="font-medium text-white">{record.user.name}</p>
                      <p className="text-xs text-slate-400">{record.user.email}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="flex items-center gap-1 text-emerald-400 text-sm">
                      <Clock className="w-4 h-4" />
                      <span>{formatTime(record.clockIn)}</span>
                    </div>
                    <span className="text-xs text-slate-500">Clocked in</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Live Location Map */}
        {active.length > 0 && (
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
            <div className="flex items-center gap-2 mb-4">
              <span className="text-lg">📍</span>
              <h2 className="font-semibold text-white">Live Employee Locations</h2>
              <span className="text-xs bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 px-2 py-0.5 rounded-full">
                {active.filter((r) => r.latitude).length} with location
              </span>
            </div>
            <LocationMap
              height="400px"
              markers={active.map((r) => ({
                name:      r.user.name,
                email:     r.user.email,
                latitude:  r.latitude,
                longitude: r.longitude,
                location:  r.location,
                clockIn:   r.clockIn,
              }))}
            />
          </div>
        )}
      </main>
    </div>
  );
};

export default AdminDashboard;