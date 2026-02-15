const AUTH_KEY = "parakeet.auth.v1";

const safeJsonParse = (value) => {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

export const computeAuthExpiresAtMs = ({ days = 1 } = {}) => {
  const d = Number(days);
  const ms = Number.isFinite(d) && d > 0 ? d * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
  return Date.now() + ms;
};

export const clearPersistedAuth = () => {
  try {
    localStorage.removeItem(AUTH_KEY);
  } catch {
    // ignore
  }
};

export const readPersistedAuth = () => {
  try {
    const raw = localStorage.getItem(AUTH_KEY);
    if (!raw) return null;
    const parsed = safeJsonParse(raw);
    if (!parsed || typeof parsed !== "object") return null;

    const accessToken = String(parsed.accessToken || "").trim();
    const refreshToken = String(parsed.refreshToken || "").trim();
    const expiresAt = Number(parsed.expiresAt || 0);
    const user = parsed.user || null;

    if (!accessToken || !expiresAt || !Number.isFinite(expiresAt)) {
      clearPersistedAuth();
      return null;
    }

    if (Date.now() >= expiresAt) {
      clearPersistedAuth();
      return null;
    }

    return { accessToken, refreshToken, expiresAt, user };
  } catch {
    return null;
  }
};

export const writePersistedAuth = ({
  accessToken,
  refreshToken,
  user,
  expiresAt,
} = {}) => {
  const token = String(accessToken || "").trim();
  const rt = String(refreshToken || "").trim();
  const exp = Number(expiresAt || 0);
  if (!token || !exp || !Number.isFinite(exp)) {
    clearPersistedAuth();
    return;
  }

  try {
    localStorage.setItem(
      AUTH_KEY,
      JSON.stringify({
        accessToken: token,
        refreshToken: rt,
        expiresAt: exp,
        user: user || null,
      })
    );
  } catch {
    // ignore
  }
};
