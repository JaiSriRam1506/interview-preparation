import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { api } from "../services/api";
import { setAccessToken } from "../services/token";

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const queryClient = useQueryClient();

  const hydrate = async () => {
    setLoading(true);
    try {
      const response = await api.post("/auth/refresh-token");
      const accessToken = response?.data?.accessToken;
      if (accessToken) setAccessToken(accessToken);
      const nextUser = response?.data?.data?.user || null;
      setUser(nextUser);
      // If we switched users (or went from null -> user), ensure cached data is fresh.
      queryClient.invalidateQueries();
    } catch {
      setUser(null);
      queryClient.clear();
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    hydrate();
  }, []);

  const login = async (email, password) => {
    const response = await api.post("/auth/login", { email, password });
    queryClient.clear();
    setAccessToken(response.data.accessToken);
    setUser(response?.data?.data?.user || null);
    toast.success("Logged in");
  };

  const register = async (name, email, password) => {
    const response = await api.post("/auth/signup", { name, email, password });
    queryClient.clear();
    setAccessToken(response.data.accessToken);
    setUser(response?.data?.data?.user || null);
    toast.success("Account created");
  };

  const logout = async () => {
    try {
      await api.post("/auth/logout");
    } catch {
      // ignore
    }
    queryClient.clear();
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
