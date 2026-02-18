// src/pages/sessions/InterviewSession.jsx
import React, {
  useContext,
  useState,
  useEffect,
  useRef,
  useCallback,
} from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Clock, Zap, Settings, Power } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../../contexts/AuthContext";
import { useSocket } from "../../contexts/SocketContext";
import { api } from "../../services/api";
import { getAccessToken } from "../../services/token";
import toast from "react-hot-toast";
import { useScribe } from "@elevenlabs/react";
import { classifyElevenLabsRealtimeError } from "../../utils/elevenlabsRealtime";
import {
  stopElevenLabsClientRealtime as stopElevenLabsClientRealtimeUtil,
  reconnectElevenLabsClientRealtime,
} from "./_interviewSession/elevenlabsClient";
import Skeleton from "../../components/common/Skeleton";
import SessionTimer from "../../components/sessions/SessionTimer";
import EvaluationModal from "../../components/sessions/EvaluationModal";
import ConnectModal from "../../components/sessions/ConnectModal";
import { MobileTopBarContext } from "../../components/layout/Layout";
import { requestParakeetAiAnswer } from "../../services/aiAnswer";
import { requestGroqDirectParakeet } from "../../services/groqDirect";
import {
  persistTranscriptQa,
  formatParakeetForTranscript,
} from "../../services/transcript";
import {
  normalizeTechTerms,
  formatAiAnswerText,
  formatParakeetToMarkdown,
  renderInlineRich,
  renderMultilineRich,
  renderHighlightedCode,
} from "./_interviewSession/uiHelpers";
import {
  isAndroidBrowser,
  isProbablyInsecureContext,
  installAudioContextCloseSuppression,
} from "./_interviewSession/runtime";
import {
  buildMobileTopBar,
  buildElevenClientStatusLabel,
  renderEndSessionDialog,
} from "./_interviewSession/sessionUi";
import {
  normalizeSpeechText,
  stripOverlapPrefix,
} from "./_interviewSession/sttTextUtils";

const InterviewSession = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  useAuth();
  const { socket } = useSocket();
  const queryClient = useQueryClient();

  // English-only listening: force ElevenLabs language to English.
  const elevenLanguageCode = "en";

  // Only STT supported: ElevenLabs — Scribe v2 Realtime (client)
  // (Web Speech / AssemblyAI / WS-PCM streaming were removed.)

  const [listeningText, setListeningText] = useState("");
  const [aiAnswer, setAiAnswer] = useState("");
  const [parakeetAnswer, setParakeetAnswer] = useState(null);
  const [parakeetCleaned, setParakeetCleaned] = useState("");
  // console.log("listeningText--->", { listeningText });

  // Co-pilot: quick model toggle + regenerate diversity
  const QUICK_MODEL_SMART = "openai/gpt-oss-120b";
  const QUICK_MODEL_FAST = "llama-3.1-8b-instant";
  const [quickAiModel, setQuickAiModel] = useState("");
  const regenAttemptRef = useRef(0);
  const regenAvoidRef = useRef([]);

  const [capturedQuestion, setCapturedQuestion] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [showEvaluation, setShowEvaluation] = useState(false);
  const [transcriptItems, setTranscriptItems] = useState([]);
  const [isGeneratingAnswer, setIsGeneratingAnswer] = useState(false);
  const isGeneratingAnswerRef = useRef(false);
  const [connectOpen, setConnectOpen] = useState(false);
  const [elevenClientConnected, setElevenClientConnected] = useState(false);
  const [elevenClientReconnecting, setElevenClientReconnecting] =
    useState(false);

  useEffect(() => installAudioContextCloseSuppression(), []);

  const aiAnswerRawRef = useRef("");
  const listeningInputRef = useRef(null);
  const listeningTextRef = useRef("");
  const transcriptPersistErrorNotifiedRef = useRef(false);
  const isRecordingRef = useRef(false);
  const startSessionRequestedRef = useRef(false);
  const connectDismissedRef = useRef(false);
  const shouldKeepListeningRef = useRef(false);
  const speechBaseTextRef = useRef("");
  // Only STT supported (copilot-only build)
  const STT_PROVIDER = "elevenlabs_client";
  const STT_MODEL = "scribe_v2_realtime";
  const autoStartListeningRef = useRef(false);

  const elevenClientBaseRef = useRef("");
  const elevenClientErrorNotifiedRef = useRef(false);
  const elevenClientFallbackTriggeredRef = useRef(false);
  const elevenClientDisabledRef = useRef(false);
  const elevenClientLastFallbackAtRef = useRef(0);
  const elevenClientConnectInFlightRef = useRef(false);
  const elevenClientIgnoreDisconnectUntilRef = useRef(0);
  const elevenReconnectInFlightRef = useRef(false);
  const elevenReconnectAttemptsRef = useRef(0);
  const elevenReconnectTimerRef = useRef(null);
  const elevenClearedAtRef = useRef(0);
  const elevenClearReconnectInFlightRef = useRef(false);
  const elevenClearReconnectLastAtRef = useRef(0);
  // After Clear, ElevenLabs can still deliver a late chunk from the previous utterance.
  // Guard against re-adding that stale text by ignoring chunks that match the pre-clear tail.
  const elevenIgnoreUntilDifferentRef = useRef(0);
  const elevenTailAtClearRef = useRef("");
  const elevenSnapshotAtClearRef = useRef("");
  const scribeRef = useRef(null);

  // Avoid TDZ issues: effects above callback definitions should call via refs.
  const handleStartRecordingRef = useRef(null);
  const handleStopRecordingRef = useRef(null);

  const [needsUserGestureResume, setNeedsUserGestureResume] = useState(false);
  const gestureResumeToastLastAtRef = useRef(0);

  const TOAST_ID_MIC_RESUME = "mic-resume";
  const TOAST_ID_ELEVEN_DISCONNECT = "eleven-disconnect";

  // Some realtime STT providers can deliver a final chunk shortly after Clear.
  // Briefly ignore those events to avoid old text being appended.
  const ignoreRealtimeUntilRef = useRef(0);

  // Used to drop stale async transcript results (e.g., background server STT)
  // that complete after the user clicks Clear.
  const listeningEpochRef = useRef(0);
  const bumpListeningEpoch = () => {
    listeningEpochRef.current = (listeningEpochRef.current || 0) + 1;
    return listeningEpochRef.current;
  };

  // ElevenLabs sometimes sends a chunk that contains BOTH old (pre-clear) text and new text.
  // If we simply ignore it, we lose the new speech; if we accept it, old text re-appears.
  // This sanitizer strips the old prefix portion (best-effort) during a short post-clear window.
  const sanitizeElevenChunkAfterClear = (chunkText) => {
    const until = Number(elevenIgnoreUntilDifferentRef.current || 0);
    const raw = normalizeSpeechText(chunkText);
    if (!raw) return "";
    if (!until || Date.now() >= until) return raw;

    const rawLen = raw.length;

    const chunkLower = raw.toLowerCase();
    const snapshotRaw = String(elevenSnapshotAtClearRef.current || "");
    const snapshot = snapshotRaw.toLowerCase();
    const tailRaw = String(elevenTailAtClearRef.current || "");
    const tail = tailRaw.toLowerCase();

    // IMPORTANT: Avoid blocking new speech right after Clear.
    // Short chunks like "what", "how do" are very commonly present in the previous
    // snapshot too, so `snapshot.includes(chunk)` on short chunks creates a dead window.
    const clearedAt = Number(elevenClearedAtRef.current || 0);
    const msSinceClear = clearedAt ? Date.now() - clearedAt : Infinity;
    const isVerySoonAfterClear = msSinceClear >= 0 && msSinceClear <= 2500;
    const isShort = chunkLower.length < 28;
    const isLong = chunkLower.length >= 60;

    // If it's very soon after clear AND the chunk exists in the pre-clear tail,
    // it's almost certainly a late delivery of the previous utterance.
    // Avoid blocking new speech right after Clear.
    // Short starters like "what is", "how do" are often present in the previous tail too.
    // Only drop short tail-matches when they are specific enough.
    if (
      isVerySoonAfterClear &&
      isShort &&
      chunkLower.length >= 18 &&
      tail &&
      tail.includes(chunkLower)
    ) {
      if (shouldVerboseSttTrace()) {
        sttDebugThrottled("sanitize-tail-drop", "sanitize", {
          action: "drop",
          reason: "tailShort",
          msSinceClear,
          rawLen,
          sample: sttSafeSample(raw),
        });
      }
      return "";
    }

    // If the whole chunk is clearly part of the old snapshot, it's stale.
    if (
      snapshot &&
      snapshot.includes(chunkLower) &&
      (isLong || (isVerySoonAfterClear && !isShort))
    ) {
      if (shouldVerboseSttTrace()) {
        sttDebugThrottled("sanitize-snap-drop", "sanitize", {
          action: "drop",
          reason: "snapshotContains",
          msSinceClear,
          rawLen,
          sample: sttSafeSample(raw),
        });
      }
      return "";
    }

    // Deterministic stripping: if the chunk contains the pre-clear snapshot/tail anywhere,
    // keep only what comes AFTER the last occurrence. This preserves new speech without
    // letting old text re-appear.
    if (snapshot && chunkLower.includes(snapshot)) {
      const idx = chunkLower.lastIndexOf(snapshot);
      const sliced = raw.slice(idx + snapshotRaw.length).trimStart();
      if (shouldVerboseSttTrace() && sliced !== raw) {
        sttDebugThrottled("sanitize-snap-strip", "sanitize", {
          action: "strip",
          reason: "snapshotOverlap",
          msSinceClear,
          rawLen,
          outLen: sliced.length,
        });
      }
      return sliced;
    }

    if (tail && chunkLower.includes(tail)) {
      const idx = chunkLower.lastIndexOf(tail);
      const sliced = raw.slice(idx + tailRaw.length).trimStart();
      if (shouldVerboseSttTrace() && sliced !== raw) {
        sttDebugThrottled("sanitize-tail-strip", "sanitize", {
          action: "strip",
          reason: "tailOverlap",
          msSinceClear,
          rawLen,
          outLen: sliced.length,
        });
      }
      return sliced;
    }

    // No overlap detected; treat as new speech but keep the window active.
    return raw;
  };

  // ==============================
  // Clear / Reset helpers (single place)
  // ==============================
  const safe = (fn) => {
    try {
      fn?.();
    } catch {
      // ignore
    }
  };

  const isSttDebugEnabled = () => {
    if (!import.meta?.env?.DEV) return false;
    try {
      const qs = new URLSearchParams(window.location.search);
      if (qs.has("sttdebug")) return true;
    } catch {
      // ignore
    }
    try {
      return String(window?.localStorage?.getItem("sttdebug") || "") === "1";
    } catch {
      // ignore
    }
    return false;
  };

  const sttDebug = (...args) => {
    if (!isSttDebugEnabled()) return;
    try {
      // Avoid dumping full transcript text by default; keep it metadata-heavy.
      console.log("[STT]", ...args);
    } catch {
      // ignore
    }
  };

  const sttSafeSample = (text, max = 28) => {
    const raw = String(text || "")
      .replace(/[\r\n\t]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!raw) return "";
    if (raw.length <= max) return raw;
    return `${raw.slice(0, max)}…`;
  };

  const sttDebugLastAtRef = useRef({});
  const sttDebugThrottled = (key, ...args) => {
    if (!isSttDebugEnabled()) return;
    const now = Date.now();
    const last = Number(sttDebugLastAtRef.current?.[key] || 0);
    if (now - last < 250) return;
    sttDebugLastAtRef.current = {
      ...(sttDebugLastAtRef.current || {}),
      [key]: now,
    };
    sttDebug(...args);
  };

  const getMsSinceClear = () => {
    const clearedAt = Number(elevenClearedAtRef.current || 0);
    if (!clearedAt) return Infinity;
    return Date.now() - clearedAt;
  };

  const shouldVerboseSttTrace = () => {
    const ms = getMsSinceClear();
    return Number.isFinite(ms) && ms >= 0 && ms <= 15_000;
  };

  useEffect(() => {
    if (!isSttDebugEnabled()) return;
    try {
      console.log("[STT] debug enabled (disable: localStorage.sttdebug=0)");
    } catch {
      // ignore
    }
  }, []);

  const primeElevenPostClearGuards = ({ prevEleven, bumpEpoch } = {}) => {
    if (bumpEpoch) safe(() => bumpListeningEpoch());

    safe(() => {
      elevenClearedAtRef.current = Date.now();
    });

    sttDebug("primeClearGuards", {
      bumpEpoch: Boolean(bumpEpoch),
      prevElevenLen: String(prevEleven || "").length,
      ignoreRealtimeUntilMs:
        Number(ignoreRealtimeUntilRef.current || 0) - Date.now(),
    });

    // Short post-clear window: ignore late chunks from the old utterance.
    safe(() => {
      ignoreRealtimeUntilRef.current = Date.now() + 200;
    });

    // Longer window: if ElevenLabs sends a chunk that includes old+new text,
    // allow the sanitizer to strip the old prefix safely.
    safe(() => {
      elevenIgnoreUntilDifferentRef.current = Date.now() + 60_000;
      const safePrev = String(prevEleven || "");
      // IMPORTANT: If Clear is pressed repeatedly (or after we've already cleared
      // the base), `prevEleven` can be empty. Do not overwrite the last snapshot,
      // otherwise a late old chunk can slip through and repopulate the UI.
      if (safePrev.trim()) {
        elevenTailAtClearRef.current = safePrev.slice(-240);
        elevenSnapshotAtClearRef.current = safePrev.slice(-8000);
      }

      sttDebug("snapshotSet", {
        hasPrev: Boolean(safePrev.trim()),
        tailLen: String(elevenTailAtClearRef.current || "").length,
        snapLen: String(elevenSnapshotAtClearRef.current || "").length,
      });
    });

    safe(() => scribeRef.current?.clearTranscripts?.());
  };

  const shouldAcceptElevenTextAfterClear = ({ kind, text }) => {
    const until = Number(elevenIgnoreUntilDifferentRef.current || 0);
    if (!until || Date.now() > until) return true;

    // Never block committed transcripts; sanitize will strip old prefixes.
    if (kind === "committed") return true;

    const normalized = normalizeSpeechText(text);
    if (!normalized) return false;

    const snapshotLower = String(
      elevenSnapshotAtClearRef.current || ""
    ).toLowerCase();
    const textLower = normalized.toLowerCase();

    const clearedAt = Number(elevenClearedAtRef.current || 0);
    const msSinceClear = clearedAt ? Date.now() - clearedAt : Infinity;
    const len = textLower.length;

    // Keep it simple: for a few seconds after Clear, drop chunks that look like
    // the previous visible text (either direction substring match).
    if (snapshotLower) {
      const looksLikeOld =
        snapshotLower.includes(textLower) || textLower.includes(snapshotLower);

      if (msSinceClear >= 0 && msSinceClear <= 2500) {
        if (looksLikeOld && len >= 18) {
          sttDebug("drop", {
            kind,
            reason: "snapshotSoon",
            msSinceClear,
            len,
          });
          return false;
        }
      }

      if (msSinceClear > 2500 && msSinceClear <= 8000) {
        if (looksLikeOld && len >= 40) {
          sttDebug("drop", {
            kind,
            reason: "snapshotLong",
            msSinceClear,
            len,
          });
          return false;
        }
      }
    }

    sttDebug("accept", {
      kind,
      msSinceClear,
      len,
    });
    return true;
  };

  const resetListeningBuffers = ({ bumpEpoch } = {}) => {
    // IMPORTANT: snapshot should reflect what the user actually sees in the Listening box.
    // Using only `elevenClientBaseRef` can be too short (committed-only), letting late
    // partial chunks re-populate the UI after Clear/AI Answer.
    const prevVisible = normalizeSpeechText(
      listeningTextRef.current || elevenClientBaseRef.current || ""
    );

    speechBaseTextRef.current = "";
    listeningTextRef.current = "";
    elevenClientBaseRef.current = "";

    primeElevenPostClearGuards({ prevEleven: prevVisible, bumpEpoch });

    // If Eleven keeps replaying the previous utterance after Clear, a fast reconnect
    // is the most reliable way to get a clean stream.
    safe(() => {
      if (!shouldKeepListeningRef.current) return;
      if (!isRecordingRef.current) return;
      if (elevenReconnectInFlightRef.current) return;
      if (elevenClearReconnectInFlightRef.current) return;

      const now = Date.now();
      const lastAt = Number(elevenClearReconnectLastAtRef.current || 0);
      if (now - lastAt < 1500) return;
      elevenClearReconnectLastAtRef.current = now;

      elevenClearReconnectInFlightRef.current = true;
      ignoreRealtimeUntilRef.current = Date.now() + 1500;

      reconnectElevenLabsClientRealtime({
        api,
        scribeRef,
        elevenLanguageCode,
        onBeforeReconnect: () => {
          ignoreRealtimeUntilRef.current = Date.now() + 1000;
          elevenClientBaseRef.current = "";
        },
      })
        .catch(() => {
          // ignore; reconnect loop will handle recovery
        })
        .finally(() => {
          elevenClearReconnectInFlightRef.current = false;
        });
    });

    safe(() => setListeningText(""));
    safe(() => setTranscriptItems([]));
  };

  const resetAnswerState = ({ clearParakeet } = {}) => {
    aiAnswerRawRef.current = "";
    safe(() => setAiAnswer(""));

    if (clearParakeet) {
      safe(() => {
        setParakeetAnswer(null);
        setParakeetCleaned("");
      });
    }
  };

  const clearCaptureState = ({ clearParakeet } = {}) => {
    // Clear should NOT stop listening; it only resets UI/capture buffers.
    // We bump epoch here to drop any late async chunks.
    resetListeningBuffers({ bumpEpoch: true });

    safe(() => setCapturedQuestion(""));

    resetAnswerState({ clearParakeet: Boolean(clearParakeet) });
  };

  const shouldFocusListeningInput = () => {
    try {
      // Mobile browsers open the on-screen keyboard on focus.
      // Avoid that for Clear/reset actions.
      if (typeof window !== "undefined" && window.matchMedia) {
        if (window.matchMedia("(pointer: coarse)").matches) return false;
        if (window.matchMedia("(hover: none)").matches) return false;
      }
    } catch {
      // ignore
    }
    try {
      if (typeof navigator !== "undefined") {
        if (Number(navigator.maxTouchPoints || 0) > 0) return false;
      }
    } catch {
      // ignore
    }
    return true;
  };

  const handleClearCapture = () => {
    // Co-pilot UX: Clear should only reset captured question/transcription.
    // It should NOT stop listening.

    clearCaptureState({ clearParakeet: false });

    if (shouldFocusListeningInput()) {
      safe(() => listeningInputRef.current?.focus?.());
    }
  };

  // ==============================
  // Live Transcription (ElevenLabs realtime)
  // ==============================

  useEffect(() => {
    listeningTextRef.current = listeningText;
  }, [listeningText]);

  // Keep the live transcript horizontally scrolled to the end
  // so older words shift left and new words appear on the right.
  useEffect(() => {
    const el = listeningInputRef.current;
    if (!el) return;
    try {
      if (typeof document !== "undefined" && document.activeElement === el) {
        return;
      }
    } catch {
      // ignore
    }
    try {
      el.scrollLeft = el.scrollWidth;
    } catch {
      // ignore
    }
  }, [listeningText]);

  // Android/Chrome: mic can be blocked unless started in direct response to a user gesture.
  // If auto-start isn't allowed, arm a one-time resume on the next tap/key.
  useEffect(() => {
    if (!needsUserGestureResume) return;

    const resume = () => {
      try {
        setNeedsUserGestureResume(false);
      } catch {
        // ignore
      }
      try {
        void handleStartRecordingRef.current?.({ fromUserGesture: true });
      } catch {
        // ignore
      }
    };

    const onPointerDown = () => resume();
    const onKeyDown = () => resume();

    try {
      window.addEventListener("pointerdown", onPointerDown, {
        capture: true,
        passive: true,
      });
      window.addEventListener("keydown", onKeyDown, { capture: true });
    } catch {
      // ignore
    }

    return () => {
      try {
        window.removeEventListener("pointerdown", onPointerDown, {
          capture: true,
        });
      } catch {
        // ignore
      }
      try {
        window.removeEventListener("keydown", onKeyDown, { capture: true });
      } catch {
        // ignore
      }
    };
  }, [needsUserGestureResume]);

  const setRecordingState = useCallback((next) => {
    isRecordingRef.current = next;
    setIsRecording(next);

    if (next) {
      try {
        setNeedsUserGestureResume(false);
      } catch {
        // ignore
      }
    }
  }, []);

  const stopElevenLabsClientRealtime = useCallback(
    () => stopElevenLabsClientRealtimeUtil({ scribeRef }),
    []
  );

  const getEpochSnapshot = () => listeningEpochRef.current || 0;
  const isEpochCurrent = (epoch) => (listeningEpochRef.current || 0) === epoch;

  const shouldIgnoreRealtimeNow = () => {
    const ignoreUntil = Number(ignoreRealtimeUntilRef.current || 0);
    return Boolean(ignoreUntil && Date.now() < ignoreUntil);
  };

  const canProcessRealtimeEvent = (epoch) => {
    if (!shouldKeepListeningRef.current) {
      sttDebugThrottled("canProcess-keep", "skip", {
        reason: "shouldKeepListening=false",
        epoch,
      });
      return false;
    }
    if (!isRecordingRef.current) {
      sttDebugThrottled("canProcess-recording", "skip", {
        reason: "isRecording=false",
        epoch,
      });
      return false;
    }
    if (shouldIgnoreRealtimeNow()) {
      sttDebugThrottled("canProcess-ignore", "skip", {
        reason: "ignoreRealtimeUntil",
        epoch,
        ignoreMs: Number(ignoreRealtimeUntilRef.current || 0) - Date.now(),
      });
      return false;
    }
    const ok = isEpochCurrent(epoch);
    if (!ok) {
      sttDebugThrottled("canProcess-epoch", "skip", {
        reason: "epochMismatch",
        epoch,
        current: Number(listeningEpochRef.current || 0),
      });
    }
    return ok;
  };

  const setListeningTextIfEpoch = (epoch, nextText) => {
    setListeningText((prev) => {
      if (!isEpochCurrent(epoch)) {
        if (shouldVerboseSttTrace()) {
          sttDebugThrottled("ui-skip", "uiSkip", {
            epoch,
            current: Number(listeningEpochRef.current || 0),
            prevLen: String(prev || "").length,
            nextLen: String(nextText || "").length,
          });
        }
        return prev;
      }
      if (shouldVerboseSttTrace()) {
        sttDebugThrottled("ui-set", "uiSet", {
          epoch,
          prevLen: String(prev || "").length,
          nextLen: String(nextText || "").length,
        });
      }
      return nextText;
    });
  };

  const getScribeText = (data) => String(data?.text || "").trim();

  // ---- Reconnect controller ----

  const setElevenReconnectingSafe = useCallback((next) => {
    try {
      setElevenClientReconnecting(Boolean(next));
    } catch {
      // ignore
    }
  }, []);

  const dismissElevenDisconnectToastSafe = useCallback(() => {
    try {
      toast.dismiss(TOAST_ID_ELEVEN_DISCONNECT);
    } catch {
      // ignore
    }
  }, []);

  const canScheduleElevenReconnect = () => {
    if (!shouldKeepListeningRef.current) return false;
    if (!isRecordingRef.current) return false;
    if (elevenClientDisabledRef.current) return false;
    return true;
  };

  const canRunElevenReconnectAttempt = () => {
    if (elevenReconnectInFlightRef.current) return false;
    return canScheduleElevenReconnect();
  };

  const nextElevenReconnectAttemptNumber = () => {
    const attempt = Math.max(1, (elevenReconnectAttemptsRef.current || 0) + 1);
    elevenReconnectAttemptsRef.current = attempt;
    return attempt;
  };

  const getElevenReconnectDelayMs = (attempt) =>
    Math.min(30_000, 400 * Math.pow(2, attempt - 1));

  const clearElevenReconnectTimer = useCallback(() => {
    try {
      if (elevenReconnectTimerRef.current) {
        clearTimeout(elevenReconnectTimerRef.current);
        elevenReconnectTimerRef.current = null;
      }
    } catch {
      // ignore
    }
    setElevenReconnectingSafe(false);
  }, [setElevenReconnectingSafe]);

  const scheduleElevenReconnect = ({ reason, err } = {}) => {
    if (!canScheduleElevenReconnect()) return false;

    // Avoid duplicate timers.
    if (elevenReconnectTimerRef.current) return true;

    setElevenReconnectingSafe(true);

    const attempt = nextElevenReconnectAttemptNumber();
    // Keep retrying; cap delay so it remains responsive.
    const delay = getElevenReconnectDelayMs(attempt);

    elevenReconnectTimerRef.current = setTimeout(async () => {
      elevenReconnectTimerRef.current = null;
      if (!canRunElevenReconnectAttempt()) return;

      elevenReconnectInFlightRef.current = true;
      try {
        // Suppress disconnect->fallback while we are reconnecting.
        elevenClientIgnoreDisconnectUntilRef.current = Date.now() + 6000;

        await reconnectElevenLabsClientRealtime({
          api,
          scribeRef,
          elevenLanguageCode,
          onBeforeReconnect: () => {
            // Don't let late chunks from the old connection repopulate UI.
            ignoreRealtimeUntilRef.current = Date.now() + 1500;
            elevenClientBaseRef.current = "";
          },
        });

        // Successful reconnect: clear fallback flags + attempts.
        elevenReconnectAttemptsRef.current = 0;
        elevenClientFallbackTriggeredRef.current = false;
        elevenClientErrorNotifiedRef.current = false;
        setElevenReconnectingSafe(false);
        dismissElevenDisconnectToastSafe();
      } catch (e) {
        const derivedReason = String(
          e?.response?.data?.message || e?.message || reason || ""
        ).trim();

        const { hardFailure, toastMessage } = classifyElevenLabsRealtimeError({
          reason: derivedReason,
          err: e || err,
        });

        if (hardFailure) {
          elevenClientDisabledRef.current = true;
          setElevenReconnectingSafe(false);
          // Eleven-only: do not switch providers. Stop retrying and show a toast.
          toast.error(toastMessage || "ElevenLabs failed (hard error)", {
            id: TOAST_ID_ELEVEN_DISCONNECT,
          });
          return;
        }

        // Eleven-only: keep retrying indefinitely. After a few tries, show a toast
        // but do NOT fall back to any other provider.
        if ((elevenReconnectAttemptsRef.current || 0) >= 3) {
          toast.error(
            toastMessage ||
              derivedReason ||
              "ElevenLabs disconnected — reconnecting…",
            {
              id: TOAST_ID_ELEVEN_DISCONNECT,
            }
          );
        }

        // Schedule next retry.
        scheduleElevenReconnect({ reason: derivedReason, err: e || err });
      } finally {
        elevenReconnectInFlightRef.current = false;
      }
    }, delay);

    return true;
  };

  const fallbackFromElevenLabsClientRealtime = ({ reason, err } = {}) => {
    try {
      // Eleven-only: don't stop listening and don't switch providers.
      // Just keep the reconnect loop running.

      const now = Date.now();
      if (now - (elevenClientLastFallbackAtRef.current || 0) < 2500) {
        return;
      }
      elevenClientLastFallbackAtRef.current = now;

      if (elevenClientFallbackTriggeredRef.current) return;
      elevenClientFallbackTriggeredRef.current = true;

      // Keep state as-is; reconnect loop will handle recovery.
      elevenClientBaseRef.current = "";

      const { toastMessage } = classifyElevenLabsRealtimeError({
        reason,
        err,
      });

      if (!elevenClientErrorNotifiedRef.current) {
        elevenClientErrorNotifiedRef.current = true;
        toast.error(toastMessage, { id: TOAST_ID_ELEVEN_DISCONNECT });
      }

      // Ensure a reconnect attempt is scheduled.
      scheduleElevenReconnect({ reason, err });
    } catch {
      // ignore
    }
  };

  // ---- UI helpers for STT ----

  const showMicResumeToast = useCallback(() => {
    const ts = Date.now();
    if (ts - (gestureResumeToastLastAtRef.current || 0) < 5000) return;
    gestureResumeToastLastAtRef.current = ts;
    toast.error("Microphone paused — trying to resume…", {
      id: TOAST_ID_MIC_RESUME,
    });
  }, []);

  const pushTranscript = useCallback((text, source = "mic") => {
    const trimmed = String(text || "").trim();
    if (!trimmed) return;

    setTranscriptItems((prev) => [
      ...prev,
      {
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        text: trimmed,
        source,
        ts: new Date().toISOString(),
      },
    ]);
  }, []);

  // ---- ElevenLabs client realtime hooks ----

  // ElevenLabs client-side realtime (lowest latency): uses single-use token from backend.
  // We keep it inert unless the user selects sttProvider=elevenlabs_client.
  const scribe = useScribe({
    modelId: "scribe_v2_realtime",
    // Co-pilot mode is English-only for interview stability.
    languageCode: "en",
    onConnect: () => {
      try {
        setElevenClientConnected(true);
        setElevenClientReconnecting(false);
        // Reset fallback trigger when a new connection is established.
        elevenClientFallbackTriggeredRef.current = false;
      } catch {
        // ignore
      }
    },
    onDisconnect: (info) => {
      try {
        const suppressUntil = Number(
          elevenClientIgnoreDisconnectUntilRef.current || 0
        );
        if (suppressUntil && Date.now() < suppressUntil) return;

        setElevenClientConnected(false);
        const reason =
          info?.reason || info?.message || info?.code || "disconnected";

        // Prefer auto-reconnect for transient disconnects.
        const scheduled = scheduleElevenReconnect({ reason, err: info });
        if (!scheduled) {
          fallbackFromElevenLabsClientRealtime({ reason, err: info });
        }
      } catch {
        // ignore
      }
    },
    onPartialTranscript: (data) => {
      try {
        const epoch = getEpochSnapshot();
        if (!canProcessRealtimeEvent(epoch)) return;

        const partialRaw = getScribeText(data);
        if (!partialRaw) return;

        const msSinceClear = getMsSinceClear();
        const verbose = shouldVerboseSttTrace();
        const rxPayload = {
          kind: "partial",
          epoch,
          msSinceClear,
          ignoreMs: Number(ignoreRealtimeUntilRef.current || 0) - Date.now(),
          baseLen: String(elevenClientBaseRef.current || "").length,
          len: String(partialRaw || "").length,
          sample: sttSafeSample(partialRaw),
        };
        if (verbose) sttDebug("rx", rxPayload);
        else sttDebugThrottled("rx-partial", "rx", rxPayload);

        const shouldAccept = shouldAcceptElevenTextAfterClear({
          kind: "partial",
          text: partialRaw,
        });
        if (!shouldAccept) return;
        const partial = sanitizeElevenChunkAfterClear(partialRaw);
        if (!partial) return;

        if (verbose) {
          sttDebug("stage", {
            kind: "partial",
            step: "sanitized",
            epoch,
            inLen: String(partialRaw || "").length,
            outLen: String(partial || "").length,
          });
        }

        const safePartial = stripOverlapPrefix(
          elevenClientBaseRef.current,
          partial
        );
        if (!safePartial) {
          if (verbose) {
            sttDebug("stage", {
              kind: "partial",
              step: "dedupeEmpty",
              epoch,
            });
          }
          return;
        }
        const composed =
          `${speechBaseTextRef.current}${elevenClientBaseRef.current}${safePartial}`
            .replace(/\s+/g, " ")
            .trimStart();

        if (verbose) {
          sttDebug("stage", {
            kind: "partial",
            step: "compose",
            epoch,
            safePartialLen: String(safePartial || "").length,
            composedLen: String(composed || "").length,
          });
        }

        setListeningTextIfEpoch(epoch, composed);
      } catch {
        // ignore
      }
    },
    onCommittedTranscript: (data) => {
      try {
        const epoch = getEpochSnapshot();
        if (!canProcessRealtimeEvent(epoch)) return;

        const textRaw = getScribeText(data);
        if (!textRaw) return;

        const msSinceClear = getMsSinceClear();
        const verbose = shouldVerboseSttTrace();
        const rxPayload = {
          kind: "committed",
          epoch,
          msSinceClear,
          ignoreMs: Number(ignoreRealtimeUntilRef.current || 0) - Date.now(),
          baseLen: String(elevenClientBaseRef.current || "").length,
          len: String(textRaw || "").length,
          sample: sttSafeSample(textRaw),
        };
        if (verbose) sttDebug("rx", rxPayload);
        else sttDebugThrottled("rx-committed", "rx", rxPayload);

        if (
          !shouldAcceptElevenTextAfterClear({
            kind: "committed",
            text: textRaw,
          })
        ) {
          return;
        }
        const text = sanitizeElevenChunkAfterClear(textRaw);
        if (!text) return;

        if (verbose) {
          sttDebug("stage", {
            kind: "committed",
            step: "sanitized",
            epoch,
            inLen: String(textRaw || "").length,
            outLen: String(text || "").length,
          });
        }

        const chunk = `${text} `;
        const deduped = stripOverlapPrefix(elevenClientBaseRef.current, chunk);
        if (!isEpochCurrent(epoch)) return;
        if (deduped) {
          elevenClientBaseRef.current =
            `${elevenClientBaseRef.current}${deduped}`.replace(/\s+/g, " ");
        }

        if (verbose) {
          sttDebug("stage", {
            kind: "committed",
            step: "baseUpdate",
            epoch,
            dedupedLen: String(deduped || "").length,
            baseLen: String(elevenClientBaseRef.current || "").length,
          });
        }

        // Update Listening with committed base.
        setListeningTextIfEpoch(
          epoch,
          `${speechBaseTextRef.current}${elevenClientBaseRef.current}`
            .replace(/\s+/g, " ")
            .trimStart()
        );

        if (!isEpochCurrent(epoch)) return;
        pushTranscript(text, "mic");
      } catch {
        // ignore
      }
    },
    onError: (err) => {
      try {
        const suppressUntil = Number(
          elevenClientIgnoreDisconnectUntilRef.current || 0
        );
        if (suppressUntil && Date.now() < suppressUntil) return;
        const reason =
          err?.reason || err?.message || err?.name || "elevenlabs_error";
        const scheduled = scheduleElevenReconnect({ reason, err });
        if (!scheduled) {
          fallbackFromElevenLabsClientRealtime({ reason, err });
        }
      } catch {
        // ignore
      }
    },
    onQuotaExceededError: (err) => {
      try {
        const suppressUntil = Number(
          elevenClientIgnoreDisconnectUntilRef.current || 0
        );
        if (suppressUntil && Date.now() < suppressUntil) return;
        const reason = err?.reason || err?.message || "quota_exceeded";
        // Quota is not transient; fall back immediately.
        fallbackFromElevenLabsClientRealtime({ reason, err });
      } catch {
        // ignore
      }
    },
    onResourceExhaustedError: (err) => {
      try {
        const suppressUntil = Number(
          elevenClientIgnoreDisconnectUntilRef.current || 0
        );
        if (suppressUntil && Date.now() < suppressUntil) return;
        const reason = err?.reason || err?.message || "resource_exhausted";
        // Resource exhausted is often transient; try reconnect first.
        const scheduled = scheduleElevenReconnect({ reason, err });
        if (!scheduled) {
          fallbackFromElevenLabsClientRealtime({ reason, err });
        }
      } catch {
        // ignore
      }
    },
  });

  useEffect(() => {
    scribeRef.current = scribe;
  }, [scribe]);

  // ==============================
  // Session data + lifecycle (query/mutations/socket)
  // ==============================

  // Fetch session details
  const { data: session, isLoading } = useQuery({
    queryKey: ["session", id],
    queryFn: async () => (await api.get(`/sessions/${id}`)).data,
    enabled: !!id,
    refetchInterval: (data) =>
      String(data?.status || "").toLowerCase() === "active" ? 10000 : false,
  });

  // Co-pilot: default to the fastest model for low latency.
  // Users can still toggle to the smart model with the 8B/120B button.
  useEffect(() => {
    if (String(quickAiModel || "").trim()) return;
    try {
      setQuickAiModel(QUICK_MODEL_FAST);
    } catch {
      // ignore
    }
  }, [quickAiModel]);

  useEffect(() => {
    if (isRecording) return;
    try {
      clearElevenReconnectTimer();
      elevenReconnectAttemptsRef.current = 0;
    } catch {
      // ignore
    }
    try {
      setElevenClientReconnecting(false);
    } catch {
      // ignore
    }
  }, [isRecording, clearElevenReconnectTimer]);

  // ==============================
  // Session mutations
  // ==============================

  // Start session mutation
  const startSessionMutation = useMutation({
    mutationFn: async (payload) => {
      const response = await api.post(`/sessions/${id}/start`, payload || {});
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries(["session", id]);
      toast.success("Interview session started!");
    },
    onError: (error) => {
      // Avoid infinite loops: the effect will only call mutate once.
      const msg =
        error?.response?.data?.message ||
        error?.message ||
        "Failed to start session";
      toast.error(msg);
    },
  });

  const updateSettingsMutation = useMutation({
    mutationFn: async (payload) => {
      const response = await api.patch(`/sessions/${id}/settings`, payload);
      return response.data;
    },
    onMutate: async (payload) => {
      await queryClient.cancelQueries({ queryKey: ["session", id] });
      const previous = queryClient.getQueryData(["session", id]);
      if (previous) {
        queryClient.setQueryData(["session", id], (old) => {
          if (!old) return old;
          return {
            ...old,
            settings: {
              ...(old.settings || {}),
              ...(payload || {}),
            },
          };
        });
      }
      return { previous };
    },
    onError: (error, _payload, ctx) => {
      if (ctx?.previous) {
        queryClient.setQueryData(["session", id], ctx.previous);
      }
      const msg =
        error?.response?.data?.message || error?.message || "Update failed";
      toast.error(msg);
    },
    onSuccess: () => {
      toast.success("Settings updated");
    },
    onSettled: () => {
      queryClient.invalidateQueries(["session", id]);
    },
  });

  const endSessionReasonRef = useRef("manual");

  // End session mutation
  const endSessionMutation = useMutation({
    mutationFn: async () => {
      const response = await api.post(`/sessions/${id}/end`);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries(["session", id]);
      const reason = String(endSessionReasonRef.current || "")
        .trim()
        .toLowerCase();

      if (reason === "manual" || reason === "expired") {
        navigate("/dashboard");
        return;
      }

      setShowEvaluation(true);
    },
    onError: (error) => {
      const msg =
        error?.response?.data?.message ||
        error?.message ||
        "Failed to end session";
      toast.error(msg);
    },
  });

  // Socket event listeners
  useEffect(() => {
    if (!socket || !id) return;

    socket.emit("join_session", id);

    socket.on("session_updated", (payload) => {
      const sessionId = String(payload?.sessionId || "");
      if (!sessionId || sessionId !== String(id)) return;
      queryClient.invalidateQueries(["session", id]);
    });

    return () => {
      socket.off("session_updated");
    };
  }, [socket, id, queryClient]);

  // ==============================
  // Auto-start / permission UX
  // ==============================

  // Stop any ongoing speech/recording on unmount
  useEffect(() => {
    return () => {
      try {
        stopElevenLabsClientRealtime();
      } catch {
        // noop
      }
      try {
        if (window.speechSynthesis) {
          window.speechSynthesis.cancel();
        }
      } catch {
        // noop
      }
    };
  }, [stopElevenLabsClientRealtime]);

  // Focus listening input on mount
  useEffect(() => {
    if (!shouldFocusListeningInput()) return;
    listeningInputRef.current?.focus?.();
  }, []);

  // Reset one-time guards when session id changes
  useEffect(() => {
    startSessionRequestedRef.current = false;
    autoStartListeningRef.current = false;
    connectDismissedRef.current = false;
    setConnectOpen(false);
  }, [id]);

  // Start session on mount if not started
  useEffect(() => {
    if (session?.status !== "created") return;
    if (startSessionMutation.isPending) return;
    if (startSessionRequestedRef.current) return;

    if (!connectDismissedRef.current) setConnectOpen(true);
  }, [session?.status, startSessionMutation]);

  // Co-pilot UX: request mic permission + start listening automatically.
  useEffect(() => {
    if (!session?._id) return;
    if (session?.status !== "active") return;
    if (isRecordingRef.current) return;
    if (autoStartListeningRef.current) return;

    autoStartListeningRef.current = true;
    shouldKeepListeningRef.current = true;

    const run = async () => {
      // If the browser says mic is already granted, we can safely auto-start.
      try {
        const perms = navigator?.permissions;
        if (perms?.query) {
          try {
            const status = await perms.query({ name: "microphone" });
            if (status?.state === "granted") {
              handleStartRecordingRef.current?.();
              return;
            }

            // When permission is in the "prompt" state, the browser will show its
            // own permission sheet on the next user gesture.
            // Don't show our in-app modal as well (it feels like a 2x popup).
            if (status?.state === "prompt") {
              try {
                setNeedsUserGestureResume(true);
              } catch {
                // ignore
              }
              setListeningText((prev) => prev || "Tap to enable microphone…");
              return;
            }

            // If the user previously denied mic access, guide them via browser settings.
            if (status?.state === "denied") {
              setListeningText(
                (prev) => prev || "Microphone permission denied."
              );
              toast.error(
                "Microphone permission denied. Enable it in browser settings and reload."
              );
              return;
            }
          } catch {
            // ignore
          }
        }
      } catch {
        // ignore
      }

      // Permissions API not available: don't show an extra in-app modal.
      // Arm the next gesture to trigger the browser prompt.
      try {
        setNeedsUserGestureResume(true);
      } catch {
        // ignore
      }
      setListeningText((prev) => prev || "Tap to enable microphone…");
    };

    void run();
  }, [session?._id, session?.status]);

  // Stop mic when session ends.
  useEffect(() => {
    if (!session?._id) return;
    if (session?.status === "active") return;
    if (!isRecordingRef.current) return;
    handleStopRecordingRef.current?.();
  }, [session?._id, session?.status]);

  // ==============================
  // AI Answer (LLM call flow)
  // ==============================

  const getCapturedQuestion = () => {
    const now = Date.now();
    const recent = (transcriptItems || [])
      .filter((t) => {
        const ts = t?.ts ? Date.parse(t.ts) : NaN;
        if (!Number.isFinite(ts)) return false;
        // Only keep very recent speech segments to avoid mixing old questions.
        return now - ts <= 30_000;
      })
      .map((t) => String(t?.text || "").trim())
      .filter(Boolean);

    const joined = recent.join(" ").trim();
    const fallback = String(listeningText || "").trim();
    // Keep it readable; long transcripts hurt both UI and the model.
    const value = (joined || fallback).slice(0, 500).trim();
    return normalizeTechTerms(value);
  };

  const handleGenerateAIAnswer = async () => {
    // Use a ref (sync) guard instead of state (async) to avoid double-trigger.
    if (isGeneratingAnswerRef.current) return;
    isGeneratingAnswerRef.current = true;
    setIsGeneratingAnswer(true);

    const wasRecording = !!isRecordingRef.current;
    try {
      const ensureRecording = async () => {
        // If the browser blocked auto-start, try again on user gesture.
        if (isRecordingRef.current) return;
        shouldKeepListeningRef.current = true;
        await handleStartRecording({ fromUserGesture: true });
      };

      const clearUiImmediatelyForSingleQa = () => {
        // Single Q/A only: clear old Question/Answer + Listening immediately on tap.
        clearCaptureState({ clearParakeet: true });
      };

      const clearAnswerBeforeStreaming = () => {
        // Clear previous answer so streaming doesn't append visually.
        resetAnswerState({ clearParakeet: true });
      };

      await ensureRecording();

      const draftText = listeningText;

      // In co-pilot mode, prefer server STT (Whisper) using the last few seconds
      // of recorded audio. This is usually more accurate than browser SR.
      let question = getCapturedQuestion();
      const rawAsrVerbatim = String(question || "");

      clearUiImmediatelyForSingleQa();

      if (!question) {
        toast.error(
          "No question captured yet. Use Listen and repeat the question."
        );
        return;
      }

      {
        setCapturedQuestion(question);

        // New question -> reset regenerate context.
        regenAttemptRef.current = 0;
        regenAvoidRef.current = [];
      }

      clearAnswerBeforeStreaming();

      // Direct Groq (no backend) for OSS models when API key is present.
      // Note: this exposes the API key to the browser environment.
      const selectedModel = String(
        quickAiModel || session?.settings?.aiModel || ""
      ).trim();
      const groqKey = String(import.meta.env.VITE_GROQ_API_KEY || "").trim();
      const isGroqDirectModel =
        selectedModel === "openai/gpt-oss-120b" ||
        selectedModel === "openai/gpt-oss-20b" ||
        selectedModel === QUICK_MODEL_FAST;

      if (groqKey && isGroqDirectModel) {
        try {
          const resp = await requestGroqDirectParakeet({
            question,
            model: selectedModel,
            apiKey: groqKey,
            onToken: (_tok, full) => {
              aiAnswerRawRef.current = String(full || "");
            },
          });

          const pkRaw = resp?.parakeet;
          if (pkRaw && typeof pkRaw === "object") {
            const pk = { ...pkRaw };
            if (
              !String(pk?.detailed_explanation || "").trim() &&
              String(pk?.explanation || "").trim()
            ) {
              pk.detailed_explanation = pk.explanation;
            }
            setParakeetCleaned(String(resp?.cleaned || question).trim());
            setParakeetAnswer(pk);

            // Best-effort persistence so transcript stays in DB.
            try {
              const sttProvider = String(
                session?.settings?.sttProvider || ""
              ).trim();
              const sttModel = String(session?.settings?.sttModel || "").trim();
              const llmModel = String(
                resp?.model || selectedModel || ""
              ).trim();
              const cleanedQ = String(resp?.cleaned || question).trim();
              const answerText = formatParakeetForTranscript(pk);
              await persistTranscriptQa({
                sessionId: id,
                question: cleanedQ,
                answer: answerText,
                sttProvider,
                sttModel,
                llmModel,
                provider: "groq_direct",
              });
            } catch (e) {
              if (!transcriptPersistErrorNotifiedRef.current) {
                transcriptPersistErrorNotifiedRef.current = true;
                const msg = String(
                  e?.response?.data?.message || e?.message || ""
                ).trim();
                toast.error(
                  msg
                    ? `Transcript not saved: ${msg}`
                    : "Transcript not saved — please try again",
                  { id: "transcript-save-failed" }
                );
              }
            }

            // Store to avoid repetition on subsequent regenerations.
            try {
              const raw = String(pk?._raw || "").trim();
              if (raw)
                regenAvoidRef.current = [...regenAvoidRef.current, raw].slice(
                  -3
                );
            } catch {
              // ignore
            }
            return;
          }

          throw new Error("Invalid Groq response");
        } catch (e) {
          // If direct Groq fails (CORS/quota/etc), fall back to backend flow.
          // IMPORTANT: clear any partial tokens so fallback output doesn't get mixed.
          try {
            aiAnswerRawRef.current = "";
          } catch {
            // ignore
          }
          try {
            setAiAnswer("");
          } catch {
            // ignore
          }

          const _ = e;
        }
      }

      // Preferred: Parakeet-style structured JSON (non-streaming).
      try {
        const resp = await requestParakeetAiAnswer({
          sessionId: id,
          question,
          rawASR: rawAsrVerbatim,
        });

        const pkRaw = resp?.parakeet;
        if (pkRaw && typeof pkRaw === "object") {
          const pk = { ...pkRaw };
          if (
            !String(pk?.detailed_explanation || "").trim() &&
            String(pk?.explanation || "").trim()
          ) {
            pk.detailed_explanation = pk.explanation;
          }
          setParakeetCleaned(String(resp?.cleaned || "").trim());
          setParakeetAnswer(pk);

          // Extra safety: persist from the client as well.
          // This is idempotent (backend de-dupes) and fixes cases where
          // backend persistence fails silently.
          try {
            const sttProvider = String(
              session?.settings?.sttProvider || ""
            ).trim();
            const sttModel = String(session?.settings?.sttModel || "").trim();
            const llmModel = String(
              resp?.model || session?.settings?.aiModel || ""
            ).trim();
            const cleanedQ = String(resp?.cleaned || question).trim();
            const answerText = formatParakeetForTranscript(pk);
            await persistTranscriptQa({
              sessionId: id,
              question: cleanedQ,
              answer: answerText,
              sttProvider,
              sttModel,
              llmModel,
              provider: "backend_parakeet",
            });
          } catch (e) {
            if (!transcriptPersistErrorNotifiedRef.current) {
              transcriptPersistErrorNotifiedRef.current = true;
              const msg = String(
                e?.response?.data?.message || e?.message || ""
              ).trim();
              toast.error(
                msg
                  ? `Transcript not saved: ${msg}`
                  : "Transcript not saved — please try again",
                { id: "transcript-save-failed" }
              );
            }
          }

          return;
        }
        throw new Error("Invalid Parakeet response");
      } catch (parakeetErr) {
        // Fallback to existing streaming Markdown endpoint.

        const _ = parakeetErr;
      }

      const streamUrlBase = String(import.meta.env.VITE_API_URL || "/api/v1");
      const streamUrl = `${streamUrlBase.replace(/\/$/, "")}/sessions/${id}/ai-answer/stream`;

      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const isTransient = (status) => {
        const s = Number(status);
        return (
          s === 429 ||
          s === 498 ||
          s === 500 ||
          s === 502 ||
          s === 503 ||
          s === 504
        );
      };

      const showRetryToast = ["1", "true", "yes", "on"].includes(
        String(import.meta.env.VITE_SHOW_AI_RETRY_TOAST || "").toLowerCase()
      );
      const retryToastId = "ai-answer-retry";

      let streamedAny = false;
      try {
        const token = getAccessToken();

        const openStream = async () => {
          const res = await fetch(streamUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            credentials: "include",
            body: JSON.stringify({
              question,
              draft: draftText,
              // Ensure transcript includes this Q/A even when Parakeet fails.
              persist: true,
              sttProvider: String(session?.settings?.sttProvider || "").trim(),
              sttModel: String(session?.settings?.sttModel || "").trim(),
            }),
          });

          if (!res.ok || !res.body) {
            const errText = await res.text().catch(() => "");
            const e = new Error(errText || `Stream failed (${res.status})`);
            e.status = res.status;
            // Try to extract a nice JSON error message.
            try {
              const parsed = JSON.parse(errText);
              const msg =
                parsed?.error?.message ||
                parsed?.message ||
                parsed?.error?.type ||
                "Stream failed";
              e.message = `${msg} (HTTP ${res.status})`;
            } catch {
              // ignore
            }
            throw e;
          }

          return res;
        };

        let res;
        const maxRetries = 2;
        for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
          try {
            res = await openStream();
            if (showRetryToast) toast.dismiss(retryToastId);
            break;
          } catch (e) {
            const status = e?.status;
            const canRetry =
              !streamedAny && attempt < maxRetries && isTransient(status);
            if (!canRetry) throw e;

            if (showRetryToast && attempt >= 1) {
              toast.loading("Retrying…", { id: retryToastId });
            }
            const base = 300;
            const backoff = base * Math.pow(2, attempt);
            const jitter = Math.floor(Math.random() * 120);
            await sleep(backoff + jitter);
          }
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let lastUiUpdateAt = 0;

        const flushUi = () => {
          const formatted = formatAiAnswerText(aiAnswerRawRef.current);
          setAiAnswer(formatted);
        };

        let streamDone = false;
        while (!streamDone) {
          const { done, value } = await reader.read();
          if (done) {
            streamDone = true;
            break;
          }
          buffer += decoder.decode(value, { stream: true });

          // SSE frames are separated by a blank line.
          let idx;
          while ((idx = buffer.indexOf("\n\n")) !== -1) {
            const frame = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 2);

            const lines = frame.split("\n");
            let eventName = "message";
            const dataLines = [];

            for (const line of lines) {
              if (line.startsWith("event:")) {
                eventName = line.slice(6).trim();
              } else if (line.startsWith("data:")) {
                dataLines.push(line.slice(5).trimStart());
              }
            }

            const dataText = dataLines.join("\n");
            if (!dataText) continue;

            let payload;
            try {
              payload = JSON.parse(dataText);
            } catch {
              payload = { token: dataText };
            }

            if (eventName === "token") {
              const t = String(payload?.token || "");
              if (t) {
                streamedAny = true;
                aiAnswerRawRef.current += t;

                // Throttle UI updates to keep mobile smooth.
                const now = Date.now();
                // Reduce flicker: update UI at most ~4x/sec.
                if (now - lastUiUpdateAt > 250) {
                  lastUiUpdateAt = now;
                  flushUi();
                }
              }
            } else if (eventName === "done") {
              flushUi();
            } else if (eventName === "error") {
              const msg = String(payload?.message || "Stream error");
              throw new Error(msg);
            }
          }
        }

        flushUi();
      } catch (streamErr) {
        if (showRetryToast) toast.dismiss(retryToastId);
        // Fallback to the existing non-streaming endpoint.
        const response = await api.post(`/sessions/${id}/ai-answer`, {
          question,
          draft: draftText,
        });
        const text = String(response?.data?.text || "").trim();
        if (!text) {
          toast.error("AI Answer returned empty response");
          return;
        }
        setAiAnswer(formatAiAnswerText(text));
        if (!streamedAny) {
          // Only surface streaming failures if we didn't already show output.
          // Keeps UX clean when fallback works.

          const _ = streamErr;
        }
      }
    } catch (err) {
      const status = err?.response?.status;
      const serverMsg = String(err?.response?.data?.message || "").trim();
      const combined = `${serverMsg} ${String(err?.message || "")}`
        .trim()
        .toLowerCase();
      const isQuota =
        status === 429 ||
        combined.includes("quota") ||
        combined.includes("rate limit") ||
        combined.includes("too many requests") ||
        combined.includes("limit exceeded") ||
        combined.includes("exceeded the quota");

      if (isQuota) {
        toast.error("Limit exceeded — quota reached. Try again later.", {
          id: "quota-exceeded",
        });
      } else {
        const msg = serverMsg || "Failed to generate AI answer";
        toast.error(msg);
      }
    } finally {
      setIsGeneratingAnswer(false);
      isGeneratingAnswerRef.current = false;

      // Resume live Listening after AI Answer.
      if (wasRecording && shouldKeepListeningRef.current) {
        try {
          speechBaseTextRef.current = "";
          listeningTextRef.current = "";
        } catch {
          // ignore
        }
      }
    }
  };

  const handleRegenerateParakeet = async () => {
    if (isGeneratingAnswerRef.current) return;
    if (!id) return;
    if (!parakeetAnswer) return;
    const cleaned = String(parakeetCleaned || "").trim();
    const fallbackQ = String(
      parakeetAnswer?.verbatim_asr || capturedQuestion || ""
    ).trim();
    const questionToUse = cleaned || fallbackQ;
    if (!questionToUse) return;

    isGeneratingAnswerRef.current = true;
    setIsGeneratingAnswer(true);
    try {
      const selectedModel = String(
        quickAiModel || session?.settings?.aiModel || ""
      ).trim();
      const groqKey = String(import.meta.env.VITE_GROQ_API_KEY || "").trim();
      const isGroqDirectModel =
        selectedModel === "openai/gpt-oss-120b" ||
        selectedModel === "openai/gpt-oss-20b" ||
        selectedModel === QUICK_MODEL_FAST;

      if (groqKey && isGroqDirectModel) {
        const nextAttempt = (regenAttemptRef.current || 0) + 1;
        regenAttemptRef.current = nextAttempt;

        const resp = await requestGroqDirectParakeet({
          question: questionToUse,
          model: selectedModel,
          apiKey: groqKey,
          variation: {
            attempt: nextAttempt,
            avoid: regenAvoidRef.current,
          },
        });
        const pkRaw = resp?.parakeet;
        if (pkRaw && typeof pkRaw === "object") {
          const pk = { ...pkRaw };
          if (
            !String(pk?.detailed_explanation || "").trim() &&
            String(pk?.explanation || "").trim()
          ) {
            pk.detailed_explanation = pk.explanation;
          }
          setParakeetCleaned(String(resp?.cleaned || questionToUse).trim());
          setParakeetAnswer(pk);
          try {
            const raw = String(pk?._raw || "").trim();
            if (raw)
              regenAvoidRef.current = [...regenAvoidRef.current, raw].slice(-3);
          } catch {
            // ignore
          }
          return;
        }
        throw new Error("Invalid Groq response");
      }

      const resp = await requestParakeetAiAnswer({
        sessionId: id,
        question: questionToUse,
        cleaned: questionToUse,
        rawASR: String(parakeetAnswer?.verbatim_asr || ""),
      });
      const pkRaw = resp?.parakeet;
      if (pkRaw && typeof pkRaw === "object") {
        const pk = { ...pkRaw };
        if (
          !String(pk?.detailed_explanation || "").trim() &&
          String(pk?.explanation || "").trim()
        ) {
          pk.detailed_explanation = pk.explanation;
        }
        setParakeetCleaned(String(resp?.cleaned || questionToUse).trim());
        setParakeetAnswer(pk);
      } else {
        throw new Error("Invalid Parakeet response");
      }
    } catch (e) {
      const status = e?.response?.status;
      const serverMsg = String(e?.response?.data?.message || "").trim();
      const combined = `${serverMsg} ${String(e?.message || "")}`
        .trim()
        .toLowerCase();
      const isQuota =
        status === 429 ||
        combined.includes("quota") ||
        combined.includes("rate limit") ||
        combined.includes("too many requests") ||
        combined.includes("limit exceeded") ||
        combined.includes("exceeded the quota");

      if (isQuota) {
        toast.error("Limit exceeded — quota reached. Try again later.", {
          id: "quota-exceeded",
        });
      } else {
        toast.error(serverMsg || e?.message || "Regenerate failed");
      }
    } finally {
      setIsGeneratingAnswer(false);
      isGeneratingAnswerRef.current = false;
    }
  };

  // Cleanup on unmount / route change to avoid stale mic/SR state on back/refresh.
  useEffect(() => {
    return () => {
      try {
        shouldKeepListeningRef.current = false;
      } catch {
        // noop
      }
      try {
        stopElevenLabsClientRealtime();
      } catch {
        // noop
      }
      try {
        setRecordingState(false);
      } catch {
        // noop
      }
    };
  }, [id, setRecordingState, stopElevenLabsClientRealtime]);

  const handleStartRecording = useCallback(
    async ({ fromUserGesture } = {}) => {
      if (isRecordingRef.current) return;
      shouldKeepListeningRef.current = true;

      if (isProbablyInsecureContext()) {
        setNeedsUserGestureResume(false);
        setListeningText(
          "Microphone requires HTTPS on Android Chrome. Open the app on an https:// link (or localhost)."
        );
        toast.error("Microphone requires HTTPS on Android Chrome.");
        shouldKeepListeningRef.current = false;
        setRecordingState(false);
        return;
      }

      // Android Chrome: connecting realtime STT without a user gesture can be blocked/unstable.
      if (isAndroidBrowser() && !fromUserGesture) {
        try {
          setNeedsUserGestureResume(true);
        } catch {
          // ignore
        }
        setListeningText((prev) => prev || "Tap to enable microphone…");
        showMicResumeToast();
        return;
      }

      try {
        speechBaseTextRef.current = "";

        if (elevenClientConnectInFlightRef.current) return;
        elevenClientConnectInFlightRef.current = true;

        elevenClientBaseRef.current = "";
        elevenClientFallbackTriggeredRef.current = false;

        await reconnectElevenLabsClientRealtime({
          api,
          scribeRef,
          elevenLanguageCode,
        });

        setRecordingState(true);
      } catch (e) {
        const derivedReason = String(
          e?.response?.data?.message ||
            e?.message ||
            "ElevenLabs realtime failed to start."
        ).trim();

        const { toastMessage } = classifyElevenLabsRealtimeError({
          reason: derivedReason,
          err: e,
        });

        toast.error(toastMessage || derivedReason, {
          id: TOAST_ID_ELEVEN_DISCONNECT,
        });

        shouldKeepListeningRef.current = false;
        setRecordingState(false);
      } finally {
        elevenClientConnectInFlightRef.current = false;
      }
    },
    [elevenLanguageCode, setRecordingState, showMicResumeToast]
  );

  handleStartRecordingRef.current = handleStartRecording;

  const handleStopRecording = useCallback(() => {
    shouldKeepListeningRef.current = false;
    try {
      stopElevenLabsClientRealtime();
    } catch {
      // ignore
    }
    elevenClientBaseRef.current = "";
    elevenClientFallbackTriggeredRef.current = false;
    setRecordingState(false);
  }, [setRecordingState, stopElevenLabsClientRealtime]);

  handleStopRecordingRef.current = handleStopRecording;

  const [endSessionDialog, setEndSessionDialog] = useState({
    open: false,
    reason: "manual", // 'manual' | 'expired'
  });

  const sessionExpiredDialogShownRef = useRef(false);

  const openEndSessionDialog = useCallback((reason) => {
    setEndSessionDialog({ open: true, reason });
  }, []);

  const closeEndSessionDialog = () => {
    setEndSessionDialog((prev) => ({ ...prev, open: false }));
  };

  const confirmEndSession = () => {
    endSessionReasonRef.current = endSessionDialog.reason;
    if (endSessionDialog.reason === "expired") {
      sessionExpiredDialogShownRef.current = true;
    }
    closeEndSessionDialog();
    endSessionMutation.mutate();
  };

  const handleEndSession = useCallback(() => {
    if (endSessionMutation.isPending) return;
    openEndSessionDialog("manual");
  }, [endSessionMutation.isPending, openEndSessionDialog]);

  const handleSessionExpired = useCallback(() => {
    if (endSessionMutation.isPending) return;
    if (sessionExpiredDialogShownRef.current) return;
    sessionExpiredDialogShownRef.current = true;
    openEndSessionDialog("expired");
  }, [endSessionMutation.isPending, openEndSessionDialog]);

  const { setMobileTopBar } = useContext(MobileTopBarContext);
  const isSessionActive = session?.status === "active";

  useEffect(() => {
    if (!setMobileTopBar) return;

    if (!session) {
      setMobileTopBar(null);
      return;
    }
    const bar = buildMobileTopBar({
      session,
      elevenClientConnected,
      elevenClientReconnecting,
      isSessionActive,
      onExpire: handleSessionExpired,
      onOpenSettings: () => setConnectOpen(true),
      onEndSession: handleEndSession,
    });

    setMobileTopBar(bar);
    return () => setMobileTopBar(null);
  }, [
    setMobileTopBar,
    session,
    elevenClientConnected,
    elevenClientReconnecting,
    isSessionActive,
    handleEndSession,
    handleSessionExpired,
  ]);

  if (isLoading || !session) {
    return (
      <div className="min-h-screen overflow-x-hidden bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800 p-4 md:p-6">
        <div className="max-w-6xl mx-auto">
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl shadow p-6">
            <div className="flex items-center justify-between">
              <div className="flex-1">
                <Skeleton className="h-7 w-72" rounded="rounded-lg" />
                <Skeleton className="mt-3 h-4 w-56" rounded="rounded-lg" />
              </div>
              <Skeleton className="h-10 w-24" rounded="rounded-lg" />
            </div>

            <div className="mt-6 grid grid-cols-1 lg:grid-cols-3 gap-4">
              <div className="lg:col-span-2 rounded-xl border border-gray-200 dark:border-gray-800 p-4">
                <Skeleton className="h-4 w-44" rounded="rounded-lg" />
                <Skeleton className="mt-3 h-40 w-full" rounded="rounded-xl" />
                <Skeleton className="mt-4 h-10 w-full" rounded="rounded-lg" />
              </div>
              <div className="rounded-xl border border-gray-200 dark:border-gray-800 p-4">
                <Skeleton className="h-4 w-36" rounded="rounded-lg" />
                <Skeleton className="mt-3 h-56 w-full" rounded="rounded-xl" />
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="min-h-screen overflow-x-hidden bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800">
      {renderEndSessionDialog({
        dialog: endSessionDialog,
        isPending: endSessionMutation.isPending,
        onClose: closeEndSessionDialog,
        onConfirm: confirmEndSession,
      })}
      {/* Header */}
      <header className="hidden lg:block bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-1 py-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start sm:items-center min-w-0">
              <div className="min-w-0">
                <div className="flex items-center text-xs sm:text-sm text-gray-500 dark:text-gray-400 truncate">
                  <Clock className="h-4 w-4 mr-1" />
                  <SessionTimer
                    startedAt={session.startedAt}
                    expiresAt={session.expiresAt}
                    onExpire={handleSessionExpired}
                  />
                  <span className="mx-2">•</span>
                  <Zap className="h-4 w-4 mr-1" />
                  <span>
                    {session.settings.aiModel.replace(/-/g, " ").toUpperCase()}
                  </span>
                </div>

                <div className="mt-0.5 min-w-0 text-xs text-gray-500 dark:text-gray-400 truncate">
                  {buildElevenClientStatusLabel({
                    elevenClientConnected,
                    elevenClientReconnecting,
                  })}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 sm:gap-4 sm:self-auto">
              <button
                onClick={() => setConnectOpen(true)}
                className="p-2 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                title="Settings"
              >
                <Settings className="h-5 w-5" />
                <span className="sr-only">Settings</span>
              </button>

              {isSessionActive && (
                <button
                  onClick={handleEndSession}
                  className="p-2 rounded-lg bg-red-600 text-white hover:bg-red-700 transition-colors"
                  title="End Session"
                >
                  <Power className="h-5 w-5" />
                  <span className="sr-only">End Session</span>
                </button>
              )}
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-2 sm:py-4">
        <div className="grid grid-cols-1 gap-3">
          {/* Left Panel - Chat */}
          <div>
            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg h-[calc(100dvh-8rem)] sm:h-[calc(100dvh-10rem)] flex flex-col">
              {/* Messages Container */}
              <div className="flex-1 overflow-y-auto p-3 sm:p-6 pb-32">
                <div className="space-y-2">
                  <div className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden">
                    {/* Listening */}
                    <div className="p-2.5 bg-gray-50 dark:bg-gray-900/30">
                      <div className="flex items-center justify-between gap-3">
                        <div className="shrink-0 text-sm font-semibold text-gray-900 dark:text-white">
                          Listening
                        </div>

                        <div className="min-w-0 flex-1 text-center text-[11px] sm:text-xs font-semibold text-gray-500 dark:text-gray-400 truncate">
                          STT: ElevenLabs (Client)
                        </div>

                        <div className="shrink-0 text-xs font-semibold text-gray-600 dark:text-gray-300">
                          {isRecording ? (
                            <span className="text-red-600 dark:text-red-400">
                              Listening…
                            </span>
                          ) : elevenClientReconnecting ||
                            (shouldKeepListeningRef.current &&
                              !elevenClientConnected) ? (
                            <span className="text-red-600 dark:text-red-400">
                              Reconnecting…
                            </span>
                          ) : (
                            <span>Waiting…</span>
                          )}
                        </div>
                      </div>

                      <div className="mt-1">
                        <input
                          ref={listeningInputRef}
                          type="text"
                          value={String(listeningText || "")}
                          onChange={(e) => setListeningText(e.target.value)}
                          placeholder="Start speaking…"
                          className="w-full bg-transparent text-sm text-gray-900 dark:text-white placeholder:text-gray-500 dark:placeholder:text-gray-400 outline-none border-0 p-0 m-0 overflow-x-auto"
                          aria-label="Live transcription"
                          autoCapitalize="none"
                          autoCorrect="off"
                          spellCheck={false}
                        />
                      </div>
                    </div>

                    {/* Question + Answer (single section) */}
                    <div className="border-t border-gray-200 dark:border-gray-700 p-2.5 bg-white dark:bg-gray-800 min-h-[50vh]">
                      {String(capturedQuestion || "").trim() ||
                      String(
                        formatParakeetToMarkdown(parakeetAnswer) ||
                          parakeetAnswer?.star_answer ||
                          aiAnswer ||
                          ""
                      ).trim() ? (
                        <>
                          <div className="text-sm text-gray-900 dark:text-white font-semibold">
                            <span className="mr-2">💬</span>
                            <span>Question:</span>{" "}
                            <span className="font-semibold">
                              {capturedQuestion || ""}
                            </span>
                          </div>

                          <div className="my-2 h-px bg-gray-200 dark:bg-gray-700" />

                          <div className="text-sm font-semibold text-gray-900 dark:text-white">
                            <span className="mr-2">⭐</span>
                            Answer:
                          </div>

                          <div className="mt-1 text-sm text-gray-900 dark:text-white">
                            {(() => {
                              const p =
                                parakeetAnswer &&
                                typeof parakeetAnswer === "object"
                                  ? parakeetAnswer
                                  : null;
                              const shortText = String(
                                p?.short_definition || p?.tl_dr || ""
                              ).trim();
                              const detailedText = String(
                                p?.detailed_explanation ||
                                  p?.explanation ||
                                  p?.star_answer ||
                                  aiAnswer ||
                                  ""
                              ).trim();
                              const bulletItems = Array.isArray(p?.bullets)
                                ? p.bullets
                                : Array.isArray(p?.key_steps)
                                  ? p.key_steps
                                  : [];
                              const code = String(
                                p?.code_example?.code || ""
                              ).trim();

                              const stripLeading = (v) =>
                                String(v || "")
                                  .trim()
                                  .replace(/^\s*([•*\-–—]|\d+[.)])\s+/, "")
                                  .trim();

                              return (
                                <div>
                                  {shortText ? (
                                    <div>
                                      <div className="font-semibold">
                                        Short explanation:
                                      </div>
                                      <div className="mt-0.5 leading-relaxed">
                                        {renderMultilineRich(shortText)}
                                      </div>
                                    </div>
                                  ) : null}

                                  {detailedText ? (
                                    <div className={shortText ? "mt-3" : ""}>
                                      <div className="font-semibold">
                                        Detailed explanation:
                                      </div>
                                      <div className="mt-0.5 leading-relaxed">
                                        {renderMultilineRich(detailedText)}
                                      </div>
                                    </div>
                                  ) : null}

                                  {bulletItems?.length ? (
                                    <div className="mt-3">
                                      <div className="font-semibold">
                                        Bullet points:
                                      </div>
                                      {bulletItems
                                        .filter(Boolean)
                                        .slice(0, 12)
                                        .map((b, idx) => {
                                          const t = stripLeading(b);
                                          if (!t) return null;
                                          return (
                                            <div
                                              key={`b-${idx}`}
                                              className="mt-1 leading-relaxed whitespace-pre-wrap"
                                            >
                                              <span className="mr-2">-</span>
                                              {renderInlineRich(t)}
                                            </div>
                                          );
                                        })}
                                    </div>
                                  ) : null}

                                  {code ? (
                                    <div className="mt-3">
                                      <div className="font-semibold">
                                        Code example:
                                      </div>
                                      <pre className="mt-1 overflow-x-hidden rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 p-3 text-xs font-mono">
                                        <code className="whitespace-pre-wrap break-words">
                                          {renderHighlightedCode(code) || code}
                                        </code>
                                      </pre>
                                    </div>
                                  ) : null}
                                </div>
                              );
                            })()}
                          </div>
                        </>
                      ) : null}
                    </div>
                  </div>
                </div>
              </div>

              {/* Input Area */}
              <div className="fixed bottom-[calc(env(safe-area-inset-bottom)+0.75rem)] left-0 right-0 z-50 px-3">
                <div className="max-w-7xl mx-auto">
                  <div className="w-fit mx-auto bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl shadow-lg p-1.5 sm:p-3">
                    <div className="flex items-center justify-center gap-2">
                      <button
                        type="button"
                        onClick={handleGenerateAIAnswer}
                        disabled={isGeneratingAnswer}
                        className="w-28 sm:w-32 px-2.5 py-1.5 rounded-lg bg-gray-900 text-white text-xs sm:text-sm font-semibold hover:bg-black transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {isGeneratingAnswer ? "Generating…" : "AI Answer"}
                      </button>

                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={handleRegenerateParakeet}
                          disabled={
                            isGeneratingAnswer ||
                            !(
                              parakeetAnswer &&
                              String(
                                parakeetCleaned ||
                                  parakeetAnswer?.verbatim_asr ||
                                  capturedQuestion ||
                                  ""
                              ).trim()
                            )
                          }
                          className="px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm font-semibold hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                          title="Regenerate answer"
                        >
                          Regenerate
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            const next =
                              (quickAiModel || QUICK_MODEL_SMART) ===
                              QUICK_MODEL_FAST
                                ? QUICK_MODEL_SMART
                                : QUICK_MODEL_FAST;
                            setQuickAiModel(next);
                            // Update header label immediately (local only).
                            try {
                              queryClient.setQueryData(
                                ["session", id],
                                (old) => {
                                  if (!old) return old;
                                  return {
                                    ...old,
                                    settings: {
                                      ...(old.settings || {}),
                                      aiModel: next,
                                    },
                                  };
                                }
                              );
                            } catch {
                              // ignore
                            }
                          }}
                          disabled={isGeneratingAnswer}
                          className="h-9 w-10 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-xs font-bold hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          title={
                            (quickAiModel || QUICK_MODEL_SMART) ===
                            QUICK_MODEL_FAST
                              ? "Switch to GPT-OSS 120B (Smart)"
                              : "Switch to LLAMA 3.1 8B Instant"
                          }
                          aria-label="Toggle AI model"
                        >
                          {(quickAiModel || QUICK_MODEL_SMART) ===
                          QUICK_MODEL_FAST
                            ? "8B"
                            : "120B"}
                        </button>
                      </div>

                      <button
                        type="button"
                        onClick={handleClearCapture}
                        className="px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm font-semibold hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors whitespace-nowrap"
                        title="Clear"
                      >
                        Clear
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Evaluation Modal */}
      <EvaluationModal
        isOpen={showEvaluation}
        onClose={() => setShowEvaluation(false)}
        sessionId={id}
      />

      <ConnectModal
        open={connectOpen}
        onBack={() => {
          connectDismissedRef.current = true;
          setConnectOpen(false);
          navigate("/sessions/create");
        }}
        onClose={() => {
          connectDismissedRef.current = true;
          setConnectOpen(false);
        }}
        session={session}
        isSubmitting={
          startSessionMutation.isPending || updateSettingsMutation.isPending
        }
        onConnect={async (payload) => {
          try {
            const safePayload = {
              ...(payload || {}),
              language: "english",
              sttProvider: STT_PROVIDER,
              sttModel: STT_MODEL,
            };

            // Optimistically update cached settings for immediate UI consistency.
            try {
              queryClient.setQueryData(["session", id], (old) => {
                if (!old) return old;
                return {
                  ...old,
                  settings: {
                    ...(old.settings || {}),
                    ...(safePayload || {}),
                  },
                };
              });
            } catch {
              // ignore
            }

            if (session?.status === "active") {
              await updateSettingsMutation.mutateAsync(safePayload);
            } else {
              startSessionRequestedRef.current = true;
              await startSessionMutation.mutateAsync(safePayload);
            }
            connectDismissedRef.current = false;
            setConnectOpen(false);
          } catch {
            // startSessionMutation handles toast
          }
        }}
      />
    </div>
  );
};

export default InterviewSession;
