import React, { useEffect, useState } from "react";
import { useScreenShare } from "../../contexts/ScreenShareContext";
import CreateScreenShare from "../../components/screenShare/CreateScreenShare";
import JoinScreenShare from "../../components/screenShare/JoinScreenShare";

export default function ScreenShareDashboard() {
  const {
    mySessions,
    refreshMySessions,
    currentSession,
    endSession,
    endSessionById,
  } = useScreenShare();
  const [endingId, setEndingId] = useState("");

  useEffect(() => {
    refreshMySessions();
  }, [refreshMySessions]);

  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-gray-900 dark:text-gray-100">
            Screen Share
          </h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
            1-to-1 screen sharing (video only)
          </p>
        </div>
        {currentSession?.role === "sharer" && (
          <button
            onClick={endSession}
            className="px-3 py-2 rounded-lg bg-red-600 text-white text-sm font-semibold"
          >
            End session
          </button>
        )}
      </div>

      <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-4">
        <CreateScreenShare />
        <JoinScreenShare />
      </div>

      <div className="mt-6 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
        <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">
          Your active sessions
        </div>
        <div className="mt-2 space-y-2">
          {mySessions?.length ? (
            mySessions.map((s) => (
              <div
                key={s.sessionId}
                className="flex items-center justify-between gap-3 rounded-lg border border-gray-200 dark:border-gray-800 p-3"
              >
                <div>
                  <div className="font-mono text-sm text-gray-900 dark:text-gray-100">
                    {s.sessionId}
                  </div>
                  <div className="text-xs text-gray-600 dark:text-gray-300">
                    Expires: {new Date(s.expiresAt).toLocaleString()}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-xs text-gray-600 dark:text-gray-300">
                    Viewers: {s.viewerCount || 0}
                  </div>
                  <button
                    onClick={async () => {
                      const id = String(s.sessionId || "");
                      setEndingId(id);
                      try {
                        await endSessionById(id);
                      } finally {
                        setEndingId("");
                      }
                    }}
                    disabled={endingId === String(s.sessionId || "")}
                    className="px-3 py-2 rounded-lg bg-red-600 text-white text-xs font-semibold disabled:opacity-60"
                  >
                    {endingId === String(s.sessionId || "")
                      ? "Ending..."
                      : "End"}
                  </button>
                </div>
              </div>
            ))
          ) : (
            <div className="text-sm text-gray-600 dark:text-gray-300">
              No active sessions.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
