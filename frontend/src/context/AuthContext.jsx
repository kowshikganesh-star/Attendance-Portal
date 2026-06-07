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
  const missCountRef          = useRef(0);     // consecutive heartbeat failures
  const clockStoppedRef       = useRef(false); // true when auto-clocked-out due to misses

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
  // Runs continuously — never paused on tab switch or app switch.
  // Keeps backend updatedAt fresh so 10-min cron doesn't clock out
  // an employee who is simply working in another tab/app.
  //
  // 2 consecutive failures = screen asleep or offline → auto clock-out.
  // Browser fully suspends JS during screen sleep so heartbeats
  // genuinely fail, miss counter accumulates, clock-out triggers.
  useEffect(() => {
    if (!user || user.role !== 'EMPLOYEE' || !token) {
      if (heartbeatRef.current) {
        clearInterval(heartbeatRef.current);
        heartbeatRef.current = null;
      }
      return;
    }

    missCountRef.current    = 0;
    clockStoppedRef.current = false;

    const sendHeartbeat = async () => {
      try {
        await axios.post(`${API}/attendance/heartbeat`);
        missCountRef.current = 0;
      } catch {
        missCountRef.current += 1;

        if (missCountRef.current >= 2) {
          // 2 consecutive misses → screen asleep or offline → clock out
          clearInterval(heartbeatRef.current);
          heartbeatRef.current    = null;
          clockStoppedRef.current = true;
          try {
            await axios.post(`${API}/attendance/clock-out`);
          } catch {
            // Silent — backend 10-min cron handles cleanup as fallback
          }
        }
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

  // ── Visibility change + clock-in check ───────────────────
  // Heartbeat is NOT stopped on hidden — it runs in the background
  // to keep the session alive during tab/app switches.
  // visibilitychange is only used to re-check clock-in on screen wake,
  // in case the backend cron clocked the employee out during sleep.
  useEffect(() => {
    if (!user || user.role !== 'EMPLOYEE' || !token) return;

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

          return; // ✅ success

        } catch {
          if (attempt < 3) {
            await new Promise((r) => setTimeout(r, attempt * 2000));
          }
        }
      }
    };

    // Run immediately on mount — handles refresh / token restore
    checkAndClockIn();

    const handleVisibilityChange = async () => {
      if (document.visibilityState === 'visible') {
        // Screen woke or tab came back — re-check clock-in.
        // If clockStoppedRef = true, employee was auto-clocked-out
        // due to 2 missed heartbeats — do NOT silently restart.
        // They must re-login intentionally.
        if (!clockStoppedRef.current) {
          await checkAndClockIn();
        }
      }
      // hidden → do nothing. Heartbeat keeps running in background.
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);

  }, [user, token]);

  // ── Tab close → beacon logout ─────────────────────────────
  // sendBeacon fires on EVERY unload (refresh + tab close).
  // We do NOT try to detect refresh here — it was unreliable on Vercel SPA.
  //
  // Instead the backend logout route checks if token came from
  // the body (sendBeacon = tab close or refresh) and SKIPS clock-out.
  // Clock-out only happens via:
  //   1. Logout button (explicit, uses Authorization header)
  //   2. 2-miss heartbeat failure (screen sleep)
  //   3. Backend 10-min autoClockOutInactive cron (safety net)
  //
  // This means refresh never causes a new session ✅
  // Tab close ends session within 10 mins via cron ✅
  useEffect(() => {
    if (!user || !token) return;

    const handleBeforeUnload = () => {
      if (heartbeatRef.current) {
        clearInterval(heartbeatRef.current);
        heartbeatRef.current = null;
      }

      // Token in body signals sendBeacon (refresh or tab close).
      // Backend skips clock-out for these — only JWT is invalidated.
      const blob = new Blob(
        [JSON.stringify({ token })],
        { type: 'application/json' }
      );
      navigator.sendBeacon(`${API}/auth/logout`, blob);
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);

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
  // Uses Authorization header → backend detects this as explicit logout
  // and performs clock-out.
  const logout = async () => {
    if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    }
    try {
      await axios.post(`${API}/auth/logout`);
    } catch {
      // Continue logout even if API fails
    }
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
