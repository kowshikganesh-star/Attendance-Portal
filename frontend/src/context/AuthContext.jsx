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

  // ── Heartbeat every 4 mins on ALL pages ───────────────────
  // 2 consecutive failures → auto clock-out (screen likely asleep/offline)
  useEffect(() => {
    if (!user || user.role !== 'EMPLOYEE' || !token) {
      if (heartbeatRef.current) {
        clearInterval(heartbeatRef.current);
        heartbeatRef.current = null;
      }
      return;
    }

    // Reset miss state whenever this effect re-runs (login / token change)
    missCountRef.current   = 0;
    clockStoppedRef.current = false;

    const sendHeartbeat = async () => {
      try {
        await axios.post(`${API}/attendance/heartbeat`);
        missCountRef.current = 0; // ✅ success — reset counter
      } catch {
        missCountRef.current += 1;

        if (missCountRef.current >= 2) {
          // 2 consecutive misses — screen likely asleep or offline
          // Stop heartbeat and auto clock-out
          clearInterval(heartbeatRef.current);
          heartbeatRef.current    = null;
          clockStoppedRef.current = true;

          try {
            await axios.post(`${API}/attendance/clock-out`);
          } catch {
            // Silent fail — session will expire via backend timeout anyway
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

  // ── Visibility + immediate clock-in check ─────────────────
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

          // Restart heartbeat only if it was stopped for a non-miss reason
          // (e.g. tab was hidden). If clockStoppedRef is true, the employee
          // was auto-clocked-out — do NOT silently restart on screen wake.
          if (!heartbeatRef.current && !clockStoppedRef.current) {
            missCountRef.current = 0;
            const sendHeartbeat = async () => {
              try {
                await axios.post(`${API}/attendance/heartbeat`);
                missCountRef.current = 0;
              } catch {
                missCountRef.current += 1;
                if (missCountRef.current >= 2) {
                  clearInterval(heartbeatRef.current);
                  heartbeatRef.current    = null;
                  clockStoppedRef.current = true;
                  try {
                    await axios.post(`${API}/attendance/clock-out`);
                  } catch { /* silent */ }
                }
              }
            };
            sendHeartbeat();
            heartbeatRef.current = setInterval(sendHeartbeat, 4 * 60 * 1000);
          }

          return; // ✅ success

        } catch {
          if (attempt < 3) {
            await new Promise((r) => setTimeout(r, attempt * 2000));
          }
        }
      }
    };

    // Run immediately on mount (handles refresh / token restore)
    checkAndClockIn();

    const handleVisibilityChange = async () => {
      if (document.visibilityState === 'hidden') {
        // Tab hidden or screen sleeping — pause heartbeat
        if (heartbeatRef.current) {
          clearInterval(heartbeatRef.current);
          heartbeatRef.current = null;
        }
      } else if (document.visibilityState === 'visible') {
        // Screen woke up or tab came back
        // Only re-clock-in if NOT stopped due to missed heartbeats.
        // If clockStoppedRef is true, the session was intentionally ended
        // because the employee was away — don't silently restart it.
        if (!clockStoppedRef.current) {
          await checkAndClockIn();
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);

  }, [user, token]);

  // ── Tab close → auto clock-out + logout ──────────────────
  // sendBeacon is used because fetch/axios are cancelled by the browser
  // during unload. sendBeacon guarantees delivery even as the page closes.
  // Refresh is detected via the Performance Navigation API — on a true close
  // neither the legacy type===1 nor the modern 'reload' type is set.
  useEffect(() => {
    if (!user || !token) return;

    const handleBeforeUnload = () => {
      // Detect refresh via Performance API.
      // type === 1 (legacy) or 'reload' (modern) means F5 / Ctrl+R.
      // On a true tab close neither of these is set.
      const isRefresh =
        (performance?.navigation?.type === 1) ||
        (performance?.getEntriesByType?.('navigation')?.[0]?.type === 'reload');

      if (isRefresh) return; // ✅ refresh — keep session alive, do nothing

      // True tab/window close — stop heartbeat and beacon logout
      if (heartbeatRef.current) {
        clearInterval(heartbeatRef.current);
        heartbeatRef.current = null;
      }

      // sendBeacon cannot set custom headers, so token goes in the body.
      // Backend must read token from req.body.token as fallback.
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
