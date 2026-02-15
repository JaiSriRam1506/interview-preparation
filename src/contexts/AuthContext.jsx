import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { api } from "../services/api";
import { setAccessToken } from "../services/token";
import {
  clearPersistedAuth,
  computeAuthExpiresAtMs,
  readPersistedAuth,
  writePersistedAuth,
} from "../services/authStorage";

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const queryClient = useQueryClient();

  const expiryTimerRef = useRef(null);

  const scheduleExpiry = (expiresAt) => {
    try {
      if (expiryTimerRef.current) {
        clearTimeout(expiryTimerRef.current);
        expiryTimerRef.current = null;
      }
    } catch {
      // ignore
    }

    const exp = Number(expiresAt || 0);
    if (!exp || !Number.isFinite(exp)) return;
    const delay = Math.max(0, exp - Date.now());

    expiryTimerRef.current = setTimeout(() => {
      try {
        clearPersistedAuth();
      } catch {
        // ignore
      }
      queryClient.clear();
      setAccessToken(null);
      setUser(null);
    }, delay);
  };

  const hydrate = async () => {
    setLoading(true);

    // Optimistic restore (prevents logout on refresh when cookies are blocked).
    const persisted = readPersistedAuth();
    if (persisted?.accessToken) {
      setAccessToken(persisted.accessToken);
      if (persisted.user) setUser(persisted.user);
      scheduleExpiry(persisted.expiresAt);
    }

    try {
      const refreshPayload = persisted?.refreshToken
        ? { refreshToken: persisted.refreshToken }
        : {};
      const response = await api.post("/auth/refresh-token", refreshPayload);
      const accessToken = response?.data?.accessToken;
      const nextUser = response?.data?.data?.user || null;
      const nextRefreshToken = String(
        response?.data?.refreshToken || persisted?.refreshToken || ""
      ).trim();

      // Keep the existing 24h window if present; else start one now.
      const nextExpiresAt = persisted?.expiresAt || computeAuthExpiresAtMs({
        days: 1,
      });

      if (accessToken) {
        setAccessToken(accessToken);
        writePersistedAuth({
          accessToken,
          refreshToken: nextRefreshToken,
          user: nextUser,
          expiresAt: nextExpiresAt,
        });
        scheduleExpiry(nextExpiresAt);
      }

      setUser(nextUser);
      // If we switched users (or went from null -> user), ensure cached data is fresh.
      queryClient.invalidateQueries();
    } catch {
      // If refresh-cookie fails, try /auth/me using whatever token we have.
      try {
        const me = await api.get("/auth/me");
        const nextUser = me?.data?.data?.user || me?.data?.user || null;
        if (nextUser) {
          setUser(nextUser);
          const still = readPersistedAuth();
          if (still?.accessToken) {
            writePersistedAuth({
              accessToken: still.accessToken,
              user: nextUser,
              expiresAt: still.expiresAt,
            });
            scheduleExpiry(still.expiresAt);
          }
        } else {
          throw new Error("me returned empty");
        }
      } catch {
        clearPersistedAuth();
        setUser(null);
        queryClient.clear();
        setAccessToken(null);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    hydrate();
    return () => {
      try {
        if (expiryTimerRef.current) {
          clearTimeout(expiryTimerRef.current);
          expiryTimerRef.current = null;
        }
      } catch {
        // ignore
      }
    };
  }, []);

  const login = async (email, password) => {
    const response = await api.post("/auth/login", { email, password });
    queryClient.clear();
    const accessToken = response?.data?.accessToken;
    const refreshToken = String(response?.data?.refreshToken || "").trim();
    const nextUser = response?.data?.data?.user || null;
    const expiresAt = computeAuthExpiresAtMs({ days: 1 });
    setAccessToken(accessToken);
    setUser(nextUser);
    writePersistedAuth({ accessToken, refreshToken, user: nextUser, expiresAt });
    scheduleExpiry(expiresAt);
    toast.success("Logged in");
  };

  const register = async (name, email, password) => {
    const response = await api.post("/auth/signup", { name, email, password });
    queryClient.clear();
    const accessToken = response?.data?.accessToken;
    const refreshToken = String(response?.data?.refreshToken || "").trim();
    const nextUser = response?.data?.data?.user || null;
    const expiresAt = computeAuthExpiresAtMs({ days: 1 });
    setAccessToken(accessToken);
    setUser(nextUser);
    writePersistedAuth({ accessToken, refreshToken, user: nextUser, expiresAt });
    scheduleExpiry(expiresAt);
    toast.success("Account created");
  };

  const logout = async () => {
    try {
      const persisted = readPersistedAuth();
      const payload = persisted?.refreshToken
        ? { refreshToken: persisted.refreshToken }
        : {};
      await api.post("/auth/logout", payload);
    } catch {
      // ignore
    }
    queryClient.clear();
    clearPersistedAuth();
    setAccessToken(null);
    setUser(null);
    toast.success("Logged out");
  };

  const value = useMemo(
    () => ({
      user,
      isLoading: loading,
      isAuthenticated: !!user,
      login,
      register,
      logout,
      refresh: hydrate,
    }),
    [user, loading]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
};
