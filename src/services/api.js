import axios from "axios";
import { getAccessToken, setAccessToken } from "./token";
import toast from "react-hot-toast";

const resolveBaseUrl = () => {
  const explicit = import.meta.env.VITE_API_URL;
  const backendUrl = import.meta.env.VITE_BACKEND_URL;

  // Prefer relative API in dev/prod so Vite/nginx can proxy `/api` correctly
  // (critical for ngrok + iOS, where `localhost` would point to the phone itself).
  const defaultRelative = "/api/v1";

  if (!explicit) {
    const b = String(backendUrl || "").trim();
    if (!b) return defaultRelative;
    try {
      const u = new URL(b);
      // Use the backend origin + fixed API prefix.
      return `${u.origin}/api/v1`;
    } catch {
      // If backendUrl isn't a valid URL, fall back to relative.
      return defaultRelative;
    }
  }

  try {
    // If explicit is a relative path, keep it.
    if (String(explicit).startsWith("/")) return explicit;

    const u = new URL(explicit);
    const host = String(u.hostname || "").toLowerCase();
    const isExplicitLocalhost =
      host === "localhost" || host === "127.0.0.1" || host === "::1";
    const currentHost = String(window.location.hostname || "").toLowerCase();
    const isCurrentLocalhost =
      currentHost === "localhost" ||
      currentHost === "127.0.0.1" ||
      currentHost === "::1";

    // If we are on ngrok/mobile (not localhost) and explicit points to localhost,
    // ignore it and use the relative path so the dev server can proxy.
    if (!isCurrentLocalhost && isExplicitLocalhost) return defaultRelative;

    // If explicit is a full backend URL, keep it as-is.
    // NOTE: Prefer setting VITE_BACKEND_URL on Vercel and leaving VITE_API_URL unset.
    return explicit;
  } catch {
    return defaultRelative;
  }
};

const baseURL = resolveBaseUrl();

export const api = axios.create({
  baseURL,
  withCredentials: true,
  timeout: 20000,
});

api.interceptors.request.use((config) => {
  const token = getAccessToken();
  if (token) {
    config.headers = config.headers || {};
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

let refreshing = null;

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const status = error?.response?.status;
    const original = error?.config;

    const serverMessage = String(
      error?.response?.data?.message || error?.response?.data?.error || ""
    ).trim();
    const clientMessage = String(error?.message || "").trim();
    const combinedMessage = `${serverMessage} ${clientMessage}`
      .trim()
      .toLowerCase();

    const isQuotaOrRateLimit =
      status === 429 ||
      combinedMessage.includes("quota") ||
      combinedMessage.includes("rate limit") ||
      combinedMessage.includes("too many requests") ||
      combinedMessage.includes("limit exceeded") ||
      combinedMessage.includes("exceeded the quota");

    if (isQuotaOrRateLimit) {
      toast.error("Limit exceeded — quota reached. Try again later.", {
        id: "quota-exceeded",
      });
    }

    const originalUrl = original?.url || "";
    const isAuthRefreshCall =
      typeof originalUrl === "string" &&
      originalUrl.includes("/auth/refresh-token");

    // Never try to refresh *from* the refresh-token endpoint itself (prevents infinite loop)
    if (status === 401 && original && !original._retry && !isAuthRefreshCall) {
      original._retry = true;

      try {
        if (!refreshing) refreshing = api.post("/auth/refresh-token");
        const refreshResponse = await refreshing;
        refreshing = null;

        const accessToken = refreshResponse?.data?.accessToken;
        if (accessToken) setAccessToken(accessToken);
        return api(original);
      } catch (e) {
        refreshing = null;
        setAccessToken(null);
        return Promise.reject(e);
      }
    }

    return Promise.reject(error);
  }
);
