import React, { useEffect, useMemo, useState } from "react";
import { QRCodeCanvas } from "qrcode.react";
import { Copy, Plus } from "lucide-react";
import toast from "react-hot-toast";
import { useScreenShare } from "../../contexts/ScreenShareContext";

const buildShareLink = (sessionId) => {
  const base = window.location.origin;
  return `${base}/screen-share?join=${encodeURIComponent(sessionId)}`;
};

export default function CreateScreenShare() {
  const { createSession, currentSession } = useScreenShare();
  const [loading, setLoading] = useState(false);

  const shareLink = useMemo(() => {
    if (!currentSession?.sessionId) return "";
    if (currentSession.role !== "sharer") return "";
    return buildShareLink(currentSession.sessionId);
  }, [currentSession]);

  useEffect(() => {
    const id = currentSession?.sessionId;
    if (!id || currentSession?.role !== "sharer") return;
    // Auto-copy session code when created.
    navigator.clipboard?.writeText(id).catch(() => {});
  }, [currentSession?.sessionId, currentSession?.role]);

  const copy = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Copied");
    } catch {
      toast.error("Copy failed");
    }
  };

  const onCreate = async () => {
    setLoading(true);
    try {
      await createSession();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            Create a session
          </div>
          <div className="text-xs text-gray-600 dark:text-gray-300">
            Share your screen (video only)
          </div>
        </div>
        <button
          onClick={onCreate}
          disabled={loading}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-900 text-white dark:bg-white dark:text-gray-900 text-sm font-semibold disabled:opacity-60"
        >
          <Plus className="h-4 w-4" />
          {loading ? "Creating..." : "New"}
        </button>
      </div>

      {currentSession?.role === "sharer" && currentSession?.sessionId && (
        <div className="mt-4">
          <div className="text-xs text-gray-600 dark:text-gray-300">
            Session code
          </div>
          <div className="mt-1 flex items-center gap-2">
            <div className="font-mono text-sm px-3 py-2 rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100">
              {currentSession.sessionId}
            </div>
            <button
              onClick={() => copy(currentSession.sessionId)}
              className="p-2 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200"
              aria-label="Copy session code"
            >
              <Copy className="h-4 w-4" />
            </button>
          </div>

          <div className="mt-3 text-xs text-gray-600 dark:text-gray-300">
            Share link
          </div>
          <div className="mt-1 flex items-center gap-2">
            <input
              readOnly
              value={shareLink}
              className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-gray-100"
              aria-label="Share link"
            />
            <button
              onClick={() => copy(shareLink)}
              className="p-2 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200"
              aria-label="Copy share link"
            >
              <Copy className="h-4 w-4" />
            </button>
          </div>

          <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="rounded-lg border border-gray-200 dark:border-gray-800 p-3">
              <div className="text-xs font-semibold text-gray-900 dark:text-gray-100">
                QR code (optional)
              </div>
              <div className="mt-2 flex justify-center">
                <div className="bg-white p-2 rounded">
                  <QRCodeCanvas value={shareLink} size={140} />
                </div>
              </div>
            </div>
            <div className="text-xs text-gray-600 dark:text-gray-300 leading-relaxed">
              Viewer must be logged in. If you end the session, viewers are
              disconnected.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
