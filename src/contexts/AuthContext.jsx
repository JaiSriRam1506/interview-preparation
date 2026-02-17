/* eslint-disable react-refresh/only-export-components */

import React, {
  createContext,
  useContext,
  useCallback,
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

const getAuthErrorMessage = (error) => {
  const status = error?.response?.status;

  // If our global axios interceptor already showed rate-limit toasts,
  // avoid double-toasting here.
  if (status === 429) return "";

  const serverMessage = String(
    error?.response?.data?.message || error?.response?.data?.error || ""
  ).trim();

  const isTimeout =
    String(error?.code || "").toUpperCase() === "ECONNABORTED" ||
    String(error?.message || "")
      .toLowerCase()
      .includes("timeout");

  if (isTimeout) {
    return "Request timed out — backend not responding. Is the backend running?";
  }

  // No response usually means server unreachable / proxy target wrong.
  if (!error?.response) {
    return "Network error — cannot reach server. Check backend/proxy.";
  }

  if (serverMessage) return serverMessage;

  if (status === 401) return "Incorrect email or password";
  if (status === 400) return "Invalid request — please check your input";

  return "Login/Register failed — please try again";
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const queryClient = useQueryClient();

  const expiryTimerRef = useRef(null);

  const scheduleExpiry = useCallback(
    (expiresAt) => {
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
    },
    [queryClient]
  );

  const hydrate = useCallback(async () => {
    setLoading(true);

    // Optimistic restore (prevents logout on refresh when cookies are blocked).
    const persisted = readPersistedAuth();
    const hasPersistedAccessToken = !!persisted?.accessToken;
    const hasPersistedRefreshToken = !!persisted?.refreshToken;
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
      const nextExpiresAt =
        persisted?.expiresAt ||
        computeAuthExpiresAtMs({
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
      // If refresh-cookie fails:
      // - If we have an access token (persisted/local), try /auth/me.
      // - If we have no token at all, don't call /auth/me (it will 401 and
      //   trigger another refresh attempt via interceptor).
      if (hasPersistedAccessToken) {
        try {
          const me = await api.get("/auth/me");
          const nextUser = me?.data?.data?.user || me?.data?.user || null;
          if (nextUser) {
            setUser(nextUser);
            const still = readPersistedAuth();
            if (still?.accessToken) {
              writePersistedAuth({
                accessToken: still.accessToken,
                refreshToken: String(still?.refreshToken || "").trim(),
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
      } else {
        // No persisted access token. If there *is* a refresh cookie, the refresh call
        // above would have succeeded; so this is effectively a logged-out state.
        if (!hasPersistedRefreshToken) {
          // nothing to clear beyond current state
        }
        clearPersistedAuth();
        setUser(null);
        queryClient.clear();
        setAccessToken(null);
      }
    } finally {
      setLoading(false);
    }
  }, [queryClient, scheduleExpiry]);

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
  }, [hydrate]);

  const login = useCallback(
    async (email, password) => {
      try {
        const response = await api.post("/auth/login", { email, password });
        queryClient.clear();
        const accessToken = response?.data?.accessToken;
        const refreshToken = String(response?.data?.refreshToken || "").trim();
        const nextUser = response?.data?.data?.user || null;
        const expiresAt = computeAuthExpiresAtMs({ days: 1 });
        setAccessToken(accessToken);
        setUser(nextUser);
        writePersistedAuth({
          accessToken,
          refreshToken,
          user: nextUser,
          expiresAt,
        });
        scheduleExpiry(expiresAt);
        toast.success("Logged in");
      } catch (error) {
        const msg = getAuthErrorMessage(error);
        if (msg) toast.error(msg, { id: "login-failed" });
        throw error;
      }
    },
    [queryClient, scheduleExpiry]
  );

  const register = useCallback(
    async (name, email, password) => {
      try {
        const response = await api.post("/auth/signup", {
          name,
          email,
          password,
        });
        queryClient.clear();
        const accessToken = response?.data?.accessToken;
        const refreshToken = String(response?.data?.refreshToken || "").trim();
        const nextUser = response?.data?.data?.user || null;
        const expiresAt = computeAuthExpiresAtMs({ days: 1 });
        setAccessToken(accessToken);
        setUser(nextUser);
        writePersistedAuth({
          accessToken,
          refreshToken,
          user: nextUser,
          expiresAt,
        });
        scheduleExpiry(expiresAt);
        toast.success("Account created");
      } catch (error) {
        const msg = getAuthErrorMessage(error);
        if (msg) toast.error(msg, { id: "register-failed" });
        throw error;
      }
    },
    [queryClient, scheduleExpiry]
  );

  const logout = useCallback(async () => {
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
  }, [queryClient]);

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
    [user, loading, login, register, logout, hydrate]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
};
