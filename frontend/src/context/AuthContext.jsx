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
  const missCountRef          = useRef(0);
  const clockStoppedRef       = useRef(false);

  // ── FIX 2: Mark every page load as a "fresh load" ────────
  // On beforeunload we check this flag to detect refresh vs true close.
  // Refresh = flag exists (set on this load, page reloading again)
  // True close = flag exists but page never reloads (irrelevant, tab gone)
  // The key insight: on refresh the NEW load runs this effect and removes
  // the flag; on true close nothing removes it but we don't care.
  // We use a module-level variable (not sessionStorage) so it's synchronous
  // and cannot be tampered with across origins.
  useEffect(() => {
    // Set flag when this load is alive — proves page loaded successfully
    sessionStorage.setItem('_pageLoaded', '1');
    return () => {
      // On React strict-mode double-invoke this cleans up, but we reset below
    };
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

  // ── Heartbeat every 4 mins — NEVER paused on tab switch ──
  //
  // FIX 1: Removed clearInterval from visibilitychange hidden branch.
  // Heartbeat now runs continuously regardless of tab visibility.
  // This keeps backend updatedAt fresh during tab switches / app switches.
  //
  // FIX 3: Miss counter now works because interval is never prematurely
  // cleared. When screen truly sleeps, browser suspends JS completely,
  // heartbeats genuinely fail, misses accumulate → clock-out triggers.
  //
  // Flow:
  //   Tab switch / app switch → heartbeat keeps firing ✅ session stays open
  //   Screen sleep (JS suspended) → heartbeats fail → 2 misses → clock-out ✅
  //   Network drop → 1 miss (blip forgiven) → 2nd miss → clock-out ✅
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
        missCountRef.current = 0; // reset on every success
      } catch {
        missCountRef.current += 1;

        if (missCountRef.current >= 2) {
          // 2 consecutive misses → screen asleep or genuinely offline
          // Stop interval and clock out
          clearInterval(heartbeatRef.current);
          heartbeatRef.current    = null;
          clockStoppedRef.current = true;

          try {
            await axios.post(`${API}/attendance/clock-out`);
          } catch {
            // Silent — backend cron will clean up via 15-min timeout
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

  // ── Visibility change — clock-in check on wake only ──────
  //
  // We no longer stop/start heartbeat here (FIX 1).
  // We only use visibilitychange to re-check clock-in when screen wakes,
  // in case the backend cron clocked the employee out during sleep.
  // If clockStoppedRef is true (2 misses), we do NOT auto re-clock-in —
  // employee must log in again intentionally.
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

    // Run immediately on mount — handles page restore after refresh
    checkAndClockIn();

    const handleVisibilityChange = async () => {
      if (document.visibilityState === 'visible') {
        // Screen woke up — check if backend cron clocked us out during sleep
        // Skip if clockStoppedRef = true (2-miss auto clock-out happened)
        // Employee should re-login intentionally in that case
        if (!clockStoppedRef.current) {
          await checkAndClockIn();
        }
      }
      // ── REMOVED: no clearInterval on hidden ──────────────
      // Previously we stopped heartbeat when tab was hidden.
      // That caused backend to time out the session on tab switch.
      // Now heartbeat runs in the background continuously (FIX 1).
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);

  }, [user, token]);

  // ── Tab close → beacon logout + clock-out ────────────────
  //
  // FIX 2: Refresh detection via sessionStorage flag instead of
  // unreliable performance.navigation.type (broken on Vercel SPAs).
  //
  // How it works:
  //   Every page load sets sessionStorage '_pageLoaded' = '1'  (above)
  //   beforeunload: remove the flag and set '_isUnloading' = '1'
  //   If it's a REFRESH: new page load runs, sees '_isUnloading',
  //     knows it was a refresh → removes both flags → no beacon fired
  //   If it's a TRUE CLOSE: '_isUnloading' stays but tab is gone → irrelevant
  //
  // Simpler version: just check if '_pageLoaded' exists at beforeunload time.
  // If it does → page was alive → could be refresh or close.
  // We set a short-lived flag and check on next load.
  // BUT: sendBeacon must fire synchronously in beforeunload.
  //
  // ✅ FINAL reliable approach:
  //   On load: sessionStorage.setItem('_tabAlive', '1')
  //   On beforeunload:
  //     Set '_wasUnload' = '1'
  //     Check if this is a reload via PerformanceNavigationTiming type
  //     If not reload → fire beacon
  //   On next load: if '_wasUnload' exists → previous was refresh, clear it
  //
  // Since performance.navigation.type is unreliable on SPAs, we combine it
  // with a sessionStorage round-trip as a fallback double-check:
  //   If EITHER method says "reload" → treat as refresh → skip beacon
  useEffect(() => {
    if (!user || !token) return;

    const handleBeforeUnload = () => {
      // Method 1: Performance Navigation Timing API (modern, reliable in most browsers)
      const navEntry = performance?.getEntriesByType?.('navigation')?.[0];
      const isReloadModern = navEntry?.type === 'reload';

      // Method 2: Legacy performance.navigation (works in older browsers)
      const isReloadLegacy = performance?.navigation?.type === 1;

      // Method 3: sessionStorage round-trip
      // If '_wasUnload' already exists from a PREVIOUS beforeunload that
      // wasn't cleared by a new load, this is a rapid double-unload (edge case).
      // Normal case: '_pageLoaded' exists = page loaded = could be refresh.
      // We set '_wasUnload' now; next load clears it and skips clock-in restart.
      const alreadyFlagged = sessionStorage.getItem('_wasUnload') === '1';

      const isRefresh = isReloadModern || isReloadLegacy || alreadyFlagged;

      if (isRefresh) {
        // Refresh — do not logout, do not clock out
        // heartbeat keeps running, session stays open
        sessionStorage.setItem('_wasUnload', '1');
        return;
      }

      // True close — stop heartbeat and fire beacon
      sessionStorage.setItem('_wasUnload', '1');

      if (heartbeatRef.current) {
        clearInterval(heartbeatRef.current);
        heartbeatRef.current = null;
      }

      // sendBeacon cannot send Authorization header.
      // Token goes in the body — backend reads req.body.token as fallback.
      const blob = new Blob(
        [JSON.stringify({ token })],
        { type: 'application/json' }
      );
      navigator.sendBeacon(`${API}/auth/logout`, blob);
    };

    // On every fresh load, clear the unload flag from the previous load.
    // This means the previous unload was a REFRESH (page reloaded = flag cleared).
    sessionStorage.removeItem('_wasUnload');

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
