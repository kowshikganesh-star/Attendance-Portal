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

  // ── Clear refresh flag on every fresh page load ───────────
  // Used by beforeunload to distinguish refresh vs true tab close
  useEffect(() => {
    sessionStorage.removeItem('_wasUnload');
  }, []);

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
  // This keeps backend updatedAt fresh so the 10-min cron doesn't
  // clock out an employee who is simply working in another tab.
  //
  // 2 consecutive failures = screen asleep or offline → auto clock-out.
  // Browser fully suspends JS during screen sleep so heartbeats
  // genuinely fail, miss counter accumulates, and clock-out triggers.
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
        missCountRef.current = 0; // reset on success
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
  // No longer stops/starts heartbeat on hidden (that was causing
  // sessions to end on tab switch). Now only used to re-check
  // clock-in when screen wakes up after a sleep clock-out.
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
        // Screen woke up or tab came back into focus.
        // If clockStoppedRef = true, employee was auto-clocked-out
        // due to 2 missed heartbeats — do NOT silently restart session.
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

  // ── Tab close → beacon logout + clock-out ────────────────
  // sendBeacon is used because fetch/axios are cancelled by the browser
  // during unload. sendBeacon guarantees delivery on true tab close.
  //
  // Refresh detection uses a sessionStorage round-trip because
  // performance.navigation.type is unreliable on Vercel SPAs:
  //   Every page load clears '_wasUnload' (top useEffect above)
  //   beforeunload sets '_wasUnload' = '1'
  //   If page reloads (refresh) → next load clears it → flag gone
  //   If tab truly closes → flag set but irrelevant (tab is gone)
  //   Combined with modern + legacy Performance API for extra reliability
  useEffect(() => {
    if (!user || !token) return;

    const handleBeforeUnload = () => {
      // Method 1: modern Performance Navigation Timing API
      const navEntry       = performance?.getEntriesByType?.('navigation')?.[0];
      const isReloadModern = navEntry?.type === 'reload';

      // Method 2: legacy performance.navigation
      const isReloadLegacy = performance?.navigation?.type === 1;

      // Method 3: sessionStorage flag — '_wasUnload' still set means
      // a previous beforeunload fired but no new page load cleared it
      // (rapid double-unload edge case)
      const alreadyFlagged = sessionStorage.getItem('_wasUnload') === '1';

      const isRefresh = isReloadModern || isReloadLegacy || alreadyFlagged;

      // Always set the flag so next load can detect it was a refresh
      sessionStorage.setItem('_wasUnload', '1');

      if (isRefresh) return; // ✅ refresh — keep session alive, skip beacon

      // True tab/window close — stop heartbeat and beacon logout
      if (heartbeatRef.current) {
        clearInterval(heartbeatRef.current);
        heartbeatRef.current = null;
      }

      // sendBeacon cannot set Authorization header.
      // Token goes in body — backend reads req.body.token as fallback.
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
    sessionStorage.removeItem('_wasUnload');
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
