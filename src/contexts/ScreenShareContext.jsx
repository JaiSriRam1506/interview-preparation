/* eslint-disable react-refresh/only-export-components */

import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import toast from "react-hot-toast";
import { screenShareApi } from "../services/screenShare";

const ScreenShareContext = createContext(null);

const normalizeLiveKitToken = (value) => {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    if (typeof value.jwt === "string") return value.jwt;
    if (typeof value.token === "string") return value.token;
  }
  return "";
};

export const ScreenShareProvider = ({ children }) => {
  const [currentSession, setCurrentSession] = useState(null);
  const [connectionStatus, setConnectionStatus] = useState("idle");
  const [error, setError] = useState(null);
  const [mySessions, setMySessions] = useState([]);

  const refreshMySessions = useCallback(async () => {
    try {
      const data = await screenShareApi.listMySessions();
      setMySessions(Array.isArray(data?.sessions) ? data.sessions : []);
    } catch (e) {
      // Keep UI quiet here; dashboard can show its own message.
      setMySessions([]);
    }
  }, []);

  const createSession = useCallback(async () => {
    setError(null);
    try {
      const data = await screenShareApi.createSession();
      setCurrentSession({
        sessionId: data?.sessionId,
        roomName: data?.roomName,
        token: normalizeLiveKitToken(data?.token),
        role: "sharer",
        expiresAt: data?.expiresAt,
      });
      toast.success("Screen share session created");
      await refreshMySessions();
      return data;
    } catch (e) {
      const msg =
        e?.response?.data?.message || e?.message || "Failed to create session";
      setError(msg);
      toast.error(msg);
      throw e;
    }
  }, [refreshMySessions]);

  const joinSession = useCallback(async (sessionId) => {
    setError(null);
    try {
      const data = await screenShareApi.joinSession(sessionId);
      setCurrentSession({
        sessionId,
        roomName: data?.roomName,
        token: normalizeLiveKitToken(data?.token),
        role: "viewer",
        sharerName: data?.sharerName,
        expiresAt: data?.expiresAt,
      });
      toast.success("Joined screen share");
      return data;
    } catch (e) {
      const msg =
        e?.response?.data?.message || e?.message || "Failed to join session";
      setError(msg);
      toast.error(msg);
      throw e;
    }
  }, []);

  const leaveSession = useCallback(() => {
    setCurrentSession(null);
    setConnectionStatus("idle");
    setError(null);
  }, []);

  const endSessionById = useCallback(
    async (sessionId) => {
      const id = String(sessionId || "")
        .trim()
        .toLowerCase();
      if (!id) return;
      try {
        await screenShareApi.endSession(id);
        toast.success("Screen share ended");
      } catch (e) {
        const msg =
          e?.response?.data?.message || e?.message || "Failed to end session";
        toast.error(msg);
      } finally {
        if (
          currentSession?.sessionId &&
          String(currentSession.sessionId) === id
        ) {
          leaveSession();
        }
        await refreshMySessions();
      }
    },
    [currentSession?.sessionId, leaveSession, refreshMySessions]
  );

  const endSession = useCallback(async () => {
    if (!currentSession?.sessionId) return;
    try {
      await screenShareApi.endSession(currentSession.sessionId);
      toast.success("Screen share ended");
    } catch (e) {
      const msg =
        e?.response?.data?.message || e?.message || "Failed to end session";
      toast.error(msg);
    } finally {
      leaveSession();
      await refreshMySessions();
    }
  }, [currentSession?.sessionId, leaveSession, refreshMySessions]);

  const value = useMemo(
    () => ({
      currentSession,
      mySessions,
      connectionStatus,
      error,
      setConnectionStatus,
      setError,
      refreshMySessions,
      createSession,
      joinSession,
      leaveSession,
      endSession,
      endSessionById,
    }),
    [
      currentSession,
      mySessions,
      connectionStatus,
      error,
      refreshMySessions,
      createSession,
      joinSession,
      leaveSession,
      endSession,
      endSessionById,
    ]
  );

  return (
    <ScreenShareContext.Provider value={value}>
      {children}
    </ScreenShareContext.Provider>
  );
};

export const useScreenShare = () => {
  const ctx = useContext(ScreenShareContext);
  if (!ctx) {
    throw new Error("useScreenShare must be used within ScreenShareProvider");
  }
  return ctx;
};
