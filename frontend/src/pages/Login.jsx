// src/pages/Login.jsx
import { useState } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import toast, { Toaster } from 'react-hot-toast';
import { Eye, EyeOff, Clock, ShieldCheck } from 'lucide-react';

const ROLE_HOME = {
  ADMIN:    '/admin/dashboard',
  EMPLOYEE: '/employee/dashboard',
};

const Login = () => {
  const { login, user, loading } = useAuth();
  const navigate = useNavigate();

  const [form,       setForm]       = useState({ email: '', password: '' });
  const [showPass,   setShowPass]   = useState(false);
  const [submitting, setSubmitting] = useState(false);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="w-10 h-10 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (user) return <Navigate to={ROLE_HOME[user.role]} replace />;

  const handleChange = (e) =>
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));

  // ── Geolocation helper ────────────────────────────────────
  const getLocation = () =>
    new Promise((resolve) => {
      if (!navigator.geolocation) { resolve(null); return; }
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          const { latitude, longitude } = pos.coords;
          try {
            const res  = await fetch(
              `https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json`
            );
            const data = await res.json();
            const location = data.display_name
              ? data.display_name.split(',').slice(0, 3).join(',')
              : `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`;
            resolve({ latitude, longitude, location });
          } catch {
            resolve({ latitude, longitude, location: `${latitude.toFixed(4)}, ${longitude.toFixed(4)}` });
          }
        },
        () => resolve(null),
        { timeout: 10000, enableHighAccuracy: false }
      );
    });

  // ── Handle Submit ─────────────────────────────────────────
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.email || !form.password) {
      toast.error('Please enter email and password.');
      return;
    }
    setSubmitting(true);
    try {
      toast.loading('Getting location...', { id: 'location' });
      const locationData = await getLocation();
      toast.dismiss('location');

      const loggedUser = await login(form.email, form.password, locationData);
      toast.success(`Welcome back, ${loggedUser.name}!`);
      setTimeout(() => navigate(ROLE_HOME[loggedUser.role]), 800);
    } catch (err) {
      toast.dismiss('location');
      const msg = err?.response?.data?.message || 'Login failed. Try again.';
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center px-4">
      <Toaster position="top-right" />

      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -left-40 w-96 h-96 bg-indigo-600 opacity-10 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -right-40 w-96 h-96 bg-violet-600 opacity-10 rounded-full blur-3xl" />
      </div>

      <div className="w-full max-w-md z-10">

        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-indigo-600 rounded-2xl mb-4 shadow-lg shadow-indigo-600/30">
            <Clock className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-white tracking-tight">AttendTrack</h1>
          <p className="text-slate-400 mt-1 text-sm">Employee Attendance Management</p>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 shadow-2xl">
          <h2 className="text-xl font-semibold text-white mb-6">Sign in to your account</h2>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1.5">
                Email Address
              </label>
              <input type="email" name="email" value={form.email}
                onChange={handleChange} placeholder="you@company.com"
                autoComplete="email"
                className="w-full px-4 py-3 rounded-xl bg-slate-800 border border-slate-700
                           text-white placeholder-slate-500 text-sm
                           focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all duration-200"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1.5">
                Password
              </label>
              <div className="relative">
                <input type={showPass ? 'text' : 'password'} name="password"
                  value={form.password} onChange={handleChange}
                  placeholder="••••••••" autoComplete="current-password"
                  className="w-full px-4 py-3 pr-12 rounded-xl bg-slate-800 border border-slate-700
                             text-white placeholder-slate-500 text-sm
                             focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all duration-200"
                />
                <button type="button" onClick={() => setShowPass((p) => !p)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 transition-colors">
                  {showPass ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
            </div>

            <button type="submit" disabled={submitting}
              className="w-full py-3 px-4 bg-indigo-600 hover:bg-indigo-500
                         disabled:opacity-60 disabled:cursor-not-allowed
                         text-white font-semibold rounded-xl text-sm
                         transition-all duration-200 shadow-lg shadow-indigo-600/30
                         flex items-center justify-center gap-2"
            >
              {submitting ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Signing in...
                </>
              ) : 'Sign In'}
            </button>
          </form>
        </div>

        </div>
        </div>
  );
};

export default Login;