// frontend/src/utils/elevenlabsRealtime.js

const KNOWN_REALTIME_ERROR_TYPES = [
  "auth_error",
  "quota_exceeded",
  "transcriber_error",
  "input_error",
  "error",
  "commit_throttled",
  "unaccepted_terms",
  "rate_limited",
  "queue_overflow",
  "resource_exhausted",
  "session_time_limit_exceeded",
  "chunk_size_exceeded",
  "insufficient_audio_activity",
];

const KNOWN_REALTIME_ERROR_TYPE_SET = new Set(KNOWN_REALTIME_ERROR_TYPES);

const toLower = (v) =>
  String(v || "")
    .trim()
    .toLowerCase();

const extractReasonText = ({ reason, err } = {}) => {
  return (
    reason ??
    err?.reason ??
    err?.message ??
    err?.detail?.message ??
    err?.detail ??
    err?.code ??
    err?.name ??
    ""
  );
};

const extractExplicitType = ({ err } = {}) => {
  const raw =
    err?.type ??
    err?.errorType ??
    err?.error_type ??
    err?.code ??
    err?.name ??
    "";
  const t = toLower(raw);
  return KNOWN_REALTIME_ERROR_TYPE_SET.has(t) ? t : "";
};

const detectTypeFromText = (reasonTextLower) => {
  const r = String(reasonTextLower || "");

  for (const k of KNOWN_REALTIME_ERROR_TYPES) {
    if (r.includes(k)) return k;
  }

  if (
    r.includes("unauthorized") ||
    r.includes("invalid token") ||
    r.includes("invalid_token")
  ) {
    return "auth_error";
  }

  if (r.includes("quota")) return "quota_exceeded";

  if (r.includes("resource_exhaust") || r.includes("resource exhausted")) {
    return "resource_exhausted";
  }

  if (r.includes("rate limited") || r.includes("rate_limit")) {
    return "rate_limited";
  }

  if (r.includes("throttled")) return "commit_throttled";

  return "";
};

export const classifyElevenLabsRealtimeError = ({ reason, err } = {}) => {
  const rawReasonText = extractReasonText({ reason, err });
  const reasonText = String(rawReasonText || "");
  const reasonTextLower = reasonText.toLowerCase();

  const explicitType = extractExplicitType({ err });
  const detectedType = detectTypeFromText(reasonTextLower);
  const type = explicitType || detectedType || "";

  const insufficientFunds = reasonTextLower.includes("insufficient_funds");

  const authError =
    type === "auth_error" || reasonTextLower.includes("auth_error");
  const unacceptedTerms = type === "unaccepted_terms";
  const quotaExceeded = type === "quota_exceeded";
  const rateLimited = type === "rate_limited";
  const throttled = type === "commit_throttled";
  const queueOverflow = type === "queue_overflow";
  const resourceExhausted = type === "resource_exhausted";
  const sessionTimeLimit = type === "session_time_limit_exceeded";
  const chunkSizeExceeded = type === "chunk_size_exceeded";
  const inputError = type === "input_error";
  const transcriberError = type === "transcriber_error";
  const insufficientAudio = type === "insufficient_audio_activity";

  const hardFailure =
    insufficientFunds ||
    authError ||
    unacceptedTerms ||
    quotaExceeded ||
    sessionTimeLimit ||
    chunkSizeExceeded ||
    inputError;

  const toastMessage = insufficientFunds
    ? "ElevenLabs credits/balance insufficient. Tap to resume listening."
    : authError
      ? "ElevenLabs auth/token error. Tap to resume listening."
      : unacceptedTerms
        ? "ElevenLabs terms not accepted. Tap to resume listening."
        : quotaExceeded
          ? "ElevenLabs quota exceeded. Tap to resume listening."
          : sessionTimeLimit
            ? "ElevenLabs session time limit reached. Tap to resume listening."
            : chunkSizeExceeded
              ? "ElevenLabs chunk size exceeded. Tap to resume listening."
              : inputError
                ? "ElevenLabs input error. Tap to resume listening."
                : rateLimited || throttled || queueOverflow
                  ? "ElevenLabs rate limited / throttled. Tap to resume listening."
                  : resourceExhausted
                    ? "ElevenLabs at capacity right now. Tap to resume listening."
                    : insufficientAudio
                      ? "Not enough audio activity. Tap to resume listening."
                      : transcriberError
                        ? "ElevenLabs transcriber error. Tap to resume listening."
                        : "ElevenLabs realtime disconnected. Tap to resume listening.";

  return {
    type,
    hardFailure,
    toastMessage,
    reasonText,
  };
};
