import React, { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { LogIn } from "lucide-react";
import { useScreenShare } from "../../contexts/ScreenShareContext";

const normalize = (v) =>
  String(v || "")
    .trim()
    .toLowerCase();

const isValidSessionId = (v) => {
  const s = normalize(v);
  return /^[a-z0-9]{6,32}$/.test(s);
};

export default function JoinScreenShare() {
  const { joinSession } = useScreenShare();
  const [searchParams] = useSearchParams();
  const [sessionId, setSessionId] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const fromLink = normalize(searchParams.get("join"));
    if (fromLink && isValidSessionId(fromLink)) {
      setSessionId(fromLink);
    }
  }, [searchParams]);

  const valid = useMemo(() => isValidSessionId(sessionId), [sessionId]);

  const onJoin = async () => {
    if (!valid) return;
    setLoading(true);
    try {
      await joinSession(normalize(sessionId));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
      <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">
        Join a session
      </div>
      <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">
        Enter the code you received
      </div>

      <div className="mt-3 flex items-center gap-2">
        <input
          value={sessionId}
          onChange={(e) => setSessionId(e.target.value)}
          placeholder="e.g. abc123xyz"
          className="flex-1 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-gray-100"
          aria-label="Session code"
        />
        <button
          onClick={onJoin}
          disabled={!valid || loading}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-primary-600 text-white text-sm font-semibold disabled:opacity-60"
        >
          <LogIn className="h-4 w-4" />
          {loading ? "Joining..." : "Join"}
        </button>
      </div>

      {!valid && sessionId && (
        <div className="mt-2 text-xs text-red-600">
          Invalid code format (6-32 alphanumeric characters)
        </div>
      )}
    </div>
  );
}
