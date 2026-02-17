import React from "react";
import { Clock, Zap, Settings, Power } from "lucide-react";
import SessionTimer from "../../../components/sessions/SessionTimer";

export const buildElevenClientStatusLabel = ({
  elevenClientConnected,
  elevenClientReconnecting,
} = {}) => {
  const status = elevenClientConnected
    ? "Connected"
    : elevenClientReconnecting
      ? "Reconnecting…"
      : "Disconnected";
  return `ElevenLabs (Client) • ${status}`;
};

export const buildMobileTopBar = ({
  session,
  elevenClientConnected,
  elevenClientReconnecting,
  isSessionActive,
  onExpire,
  onOpenSettings,
  onEndSession,
} = {}) => {
  if (!session) return null;

  const sttWsLabel = buildElevenClientStatusLabel({
    elevenClientConnected,
    elevenClientReconnecting,
  });

  const center = (
    <div className="min-w-0">
      <div className="flex items-center text-xs text-gray-500 dark:text-gray-400 truncate">
        <Clock className="h-4 w-4 mr-1" />
        <SessionTimer
          startedAt={session.startedAt}
          expiresAt={session.expiresAt}
          onExpire={onExpire}
        />
        <span className="mx-2">•</span>
        <Zap className="h-4 w-4 mr-1" />
        <span>{session.settings.aiModel.replace(/-/g, " ").toUpperCase()}</span>
      </div>
      {String(sttWsLabel || "").trim() ? (
        <div className="mt-0.5 text-xs text-gray-500 dark:text-gray-400 leading-snug truncate sm:whitespace-normal sm:break-words">
          {sttWsLabel}
        </div>
      ) : null}
    </div>
  );

  const right = (
    <>
      <button
        onClick={onOpenSettings}
        className="p-2 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
        title="Settings"
        aria-label="Settings"
      >
        <Settings className="h-5 w-5" />
      </button>

      {isSessionActive && (
        <button
          onClick={onEndSession}
          className="p-2 rounded-lg bg-red-600 text-white hover:bg-red-700 transition-colors"
          title="End Session"
          aria-label="End Session"
        >
          <Power className="h-5 w-5" />
        </button>
      )}
    </>
  );

  return { center, right };
};

export const renderEndSessionDialog = ({
  dialog,
  isPending,
  onClose,
  onConfirm,
} = {}) => {
  if (!dialog?.open) return null;

  const isManual = dialog.reason === "manual";
  const isExpired = dialog.reason === "expired";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/40"
        onClick={isManual ? onClose : undefined}
      />
      <div className="relative w-full max-w-md bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl shadow-xl">
        <div className="p-5 border-b border-gray-200 dark:border-gray-800">
          <div className="text-lg font-bold text-gray-900 dark:text-white">
            {isExpired ? "Session expired" : "End session?"}
          </div>
          <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">
            {isExpired
              ? "Time is up. End the session to view your evaluation."
              : "Are you sure you want to end the session? You cannot resume it later."}
          </div>
        </div>
        <div className="p-5 flex items-center justify-end gap-3">
          {isManual && (
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-800 text-gray-900 dark:text-white font-semibold"
            >
              Cancel
            </button>
          )}
          <button
            onClick={onConfirm}
            className="px-4 py-2 rounded-lg bg-red-600 text-white font-semibold hover:bg-red-700 disabled:opacity-50"
            disabled={Boolean(isPending)}
          >
            {isExpired ? "OK" : "End session"}
          </button>
        </div>
      </div>
    </div>
  );
};
