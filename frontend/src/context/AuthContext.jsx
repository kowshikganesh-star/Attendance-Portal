// src/context/AuthContext.jsx
import { createContext, useContext, useState, useEffect, useRef } from 'react';
import axios from 'axios';

const AuthContext = createContext(null);
const API = import.meta.env.VITE_API_URL;

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

export const AuthProvider = ({ children }) => {
  const [user,    setUser]    = useState(null);
  const [token,   setToken]   = useState(() => sessionStorage.getItem('token'));
  const [loading, setLoading] = useState(true);
  const heartbeatRef          = useRef(null);
  const lastHeartbeatRef      = useRef(Date.now());

  // ── Restore session on load ───────────────────────────────
  useEffect(() => {
    if (!token) {
      setUser(null);
      setLoading(false);
      delete axios.defaults.headers.common['Authorization'];
      return;
    }
    axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
    axios.get(`${API}/auth/me`)
      .then(({ data }) => setUser(data.user))
      .catch(() => {
        sessionStorage.removeItem('token');
        setToken(null);
        setUser(null);
        delete axios.defaults.headers.common['Authorization'];
      })
      .finally(() => setLoading(false));
  }, [token]);

  // ── Heartbeat every 4 mins ────────────────────────────────
  // NEVER stopped by tab switch ✅
  // Only gapMins > 10 skips (detects real sleep) ✅
  useEffect(() => {
    if (!user || user.role !== 'EMPLOYEE' || !token) {
      if (heartbeatRef.current) {
        clearInterval(heartbeatRef.current);
        heartbeatRef.current = null;
      }
      return;
    }

    const sendHeartbeat = async () => {
      const now     = Date.now();
      const gapMins = (now - lastHeartbeatRef.current) / 60000;

      // Long gap = laptop was sleeping → skip ✅
      if (gapMins > 10) {
        lastHeartbeatRef.current = now;
        return;
      }

      lastHeartbeatRef.current = now;

      try {
        await axios.post(`${API}/attendance/heartbeat`);
      } catch {
        // Silent fail
      }
    };

    sendHeartbeat();
    heartbeatRef.current = setInterval(sendHeartbeat, 4 * 60 * 1000);

    return () => {
      if (heartbeatRef.current) {
        clearInterval(heartbeatRef.current);
        heartbeatRef.current = null;
      }
    };
  }, [user, token]);

  // ── Visibility + immediate clock-in check ─────────────────
  useEffect(() => {
    if (!user || user.role !== 'EMPLOYEE' || !token) return;

    const startHeartbeat = () => {
      if (!heartbeatRef.current) {
        const sendHeartbeat = async () => {
          const now     = Date.now();
          const gapMins = (now - lastHeartbeatRef.current) / 60000;
          if (gapMins > 10) {
            lastHeartbeatRef.current = now;
            return;
          }
          lastHeartbeatRef.current = now;
          try {
            await axios.post(`${API}/attendance/heartbeat`);
          } catch {}
        };
        sendHeartbeat();
        heartbeatRef.current = setInterval(sendHeartbeat, 4 * 60 * 1000);
      }
    };

    const checkAndClockIn = async () => {
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const { data } = await axios.get(`${API}/attendance/today`);
          if (!data.isClockedIn) {
            const locationData = await getLocation();
            await axios.post(`${API}/attendance/clock-in`, {
              ...(locationData && {
                latitude:  locationData.latitude,
                longitude: locationData.longitude,
                location:  locationData.location,
              }),
            });
          }
          lastHeartbeatRef.current = Date.now();
          startHeartbeat();
          return;
        } catch {
          if (attempt < 3) {
            await new Promise((r) => setTimeout(r, attempt * 2000));
          }
        }
      }
    };

    // Run immediately on user restore (refresh, tab switch back)
    checkAndClockIn();

    const handleVisibilityChange = async () => {
      if (document.visibilityState === 'visible') {
        await checkAndClockIn();
      }
      // hidden → do NOTHING
      // Heartbeat keeps running for tab switch ✅
      // Extension handles screen lock separately ✅
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);

  }, [user, token]);

  // ── Extension screen event listener ──────────────────────
  // Optional: works better WITH extension installed ✅
  // App works normally WITHOUT extension too ✅
  //
  // Extension detects:
  //   Screen lock (Win+L) → SCREEN_LOCKED → stop heartbeat ✅
  //   Mouse idle             → IGNORED (employees read/think for long) ✅
  //   Screen active       → SCREEN_ACTIVE → restore session ✅
  useEffect(() => {
    if (!user || user.role !== 'EMPLOYEE' || !token) return;

    const handleScreenEvent = async (e) => {  // ← add async ✅
  const { event } = e.detail;

    if (event === 'SCREEN_LOCKED') {
      // Final heartbeat FIRST ✅
      try {
        await axios.post(`${API}/attendance/heartbeat`);
      } catch {}
  
      if (heartbeatRef.current) {
        clearInterval(heartbeatRef.current);
        heartbeatRef.current = null;
      }
      lastHeartbeatRef.current = 0;
      console.log('[AttendTrack] Final heartbeat sent, screen locked');
      console.log(Date.now());
    }

      if (event === 'SCREEN_ACTIVE') {
        // Screen came back — restore and restart ✅
        lastHeartbeatRef.current = Date.now();

        const restore = async () => {
          for (let attempt = 1; attempt <= 3; attempt++) {
            try {
              const { data } = await axios.get(`${API}/attendance/today`);
              if (!data.isClockedIn) {
                const loc = await getLocation();
                await axios.post(`${API}/attendance/clock-in`, {
                  ...(loc && {
                    latitude:  loc.latitude,
                    longitude: loc.longitude,
                    location:  loc.location,
                  }),
                });
              }
              // Restart heartbeat if stopped ✅
              if (!heartbeatRef.current) {
                const sendHeartbeat = async () => {
                  const now     = Date.now();
                  const gapMins = (now - lastHeartbeatRef.current) / 60000;
                  if (gapMins > 10) { lastHeartbeatRef.current = now; return; }
                  lastHeartbeatRef.current = now;
                  try { await axios.post(`${API}/attendance/heartbeat`); } catch {}
                };
                sendHeartbeat();
                heartbeatRef.current = setInterval(sendHeartbeat, 4 * 60 * 1000);
              }
              console.log('[AttendTrack] Session restored: screen active');
              console.log(Date.now());
              return;
            } catch {
              if (attempt < 3) {
                await new Promise((r) => setTimeout(r, attempt * 2000));
              }
            }
          }
        };

        restore();
      }
    };

    window.addEventListener('attendtrack-screen-event', handleScreenEvent);
    return () => window.removeEventListener('attendtrack-screen-event', handleScreenEvent);

  }, [user, token]);

  // ── Login with location ───────────────────────────────────
  const login = async (email, password, locationData = null) => {
    const payload = {
      email,
      password,
      ...(locationData && {
        latitude:  locationData.latitude,
        longitude: locationData.longitude,
        location:  locationData.location,
      }),
    };
    const { data } = await axios.post(`${API}/auth/login`, payload);
    sessionStorage.setItem('token', data.token);
    axios.defaults.headers.common['Authorization'] = `Bearer ${data.token}`;
    setToken(data.token);
    setUser(data.user);
    return data.user;
  };

  // ── Logout with auto clock-out ────────────────────────────
  const logout = async () => {
    if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    }
    try {
      await axios.post(`${API}/auth/logout`);
    } catch {}
    sessionStorage.removeItem('token');
    setToken(null);
    setUser(null);
    delete axios.defaults.headers.common['Authorization'];
  };

  return (
    <AuthContext.Provider value={{ user, token, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

// eslint-disable-next-line react-refresh/only-export-components
export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
};
