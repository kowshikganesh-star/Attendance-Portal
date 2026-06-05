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
  useEffect(() => {
    if (!user || user.role !== 'EMPLOYEE' || !token) {
      if (heartbeatRef.current) {
        clearInterval(heartbeatRef.current);
        heartbeatRef.current = null;
      }
      return;
    }

    const sendHeartbeat = async () => {
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
  // Runs immediately when user is set (handles refresh restore)
  // Also runs on screen wake / tab switch back
  useEffect(() => {
    if (!user || user.role !== 'EMPLOYEE' || !token) return;

    // Shared clock-in check with retry for slow backend
    const checkAndClockIn = async () => {
      // Try up to 3 times with increasing delays
      // Handles Render cold start (backend waking up)
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

          // Restart heartbeat if stopped
          if (!heartbeatRef.current) {
            const sendHeartbeat = async () => {
              try {
                await axios.post(`${API}/attendance/heartbeat`);
              } catch {
                // Silent fail
              }
            };
            sendHeartbeat();
            heartbeatRef.current = setInterval(sendHeartbeat, 4 * 60 * 1000);
          }

          return; // ✅ Success — stop retrying

        } catch {
          if (attempt < 3) {
            // Wait before retry: 2s, then 4s
            await new Promise((r) => setTimeout(r, attempt * 2000));
          }
          // Silent fail on final attempt
        }
      }
    };

    // ── Run immediately when user is restored ─────────────
    // This handles the case where:
    //   1. Page was refreshed (keepalive logged out, need to re-clock-in)
    //   2. Page became visible after sleep
    //   3. Token restored from sessionStorage
    checkAndClockIn();

    const handleVisibilityChange = async () => {
      if (document.visibilityState === 'hidden') {
        // Screen sleeping or tab hidden — stop heartbeat
        if (heartbeatRef.current) {
          clearInterval(heartbeatRef.current);
          heartbeatRef.current = null;
        }
      } else if (document.visibilityState === 'visible') {
        // Screen woke up or tab came back — check clock-in
        await checkAndClockIn();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);

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
