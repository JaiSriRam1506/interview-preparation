// src/pages/sessions/InterviewSession.jsx
import React, { useContext, useState, useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
// eslint-disable-next-line no-unused-vars
import { motion, AnimatePresence } from "framer-motion";
import {
  Send,
  Mic,
  MicOff,
  Clock,
  Zap,
  BookOpen,
  ThumbsUp,
  ThumbsDown,
  Download,
  RotateCcw,
  X,
  Settings,
  Power,
  MoreVertical,
  Bot,
  User,
} from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { useAuth } from "../../contexts/AuthContext";
import { useSocket } from "../../contexts/SocketContext";
import { api } from "../../services/api";
import { getAccessToken } from "../../services/token";
import toast from "react-hot-toast";
import SpeechRecognition, {
  useSpeechRecognition,
} from "react-speech-recognition";
import { useScribe } from "@elevenlabs/react";
import { makeWS, packFrame } from "../../utils/audioSender";
import { classifyElevenLabsRealtimeError } from "../../utils/elevenlabsRealtime";
import {
  stopElevenLabsClientRealtime as stopElevenLabsClientRealtimeUtil,
  reconnectElevenLabsClientRealtime,
} from "./_interviewSession/elevenlabsClient";
import {
  isWebSpeechLiveUsableImpl,
  scheduleWebSpeechRecoveryImpl,
  startWebSpeechRecognitionImpl,
  stopSpeechRecognitionImpl,
} from "./_interviewSession/webSpeech";
import {
  startBackgroundServerSttLoopImpl,
  stopBackgroundServerSttLoopImpl,
} from "./_interviewSession/backgroundServerStt";
import {
  getBufferedAudioBlobImpl,
  getLastRingBlobImpl,
} from "./_interviewSession/audioRing";
import { transcribeBufferedAudioForQuestionImpl } from "./_interviewSession/onDemandTranscription";
import { handleMediaRecorderDataAvailableImpl } from "./_interviewSession/mediaRecorderData";
import {
  buildBlobFromChunksImpl,
  stopSegmentImpl,
} from "./_interviewSession/segmentTranscription";
import { startSilenceDetectionLoopImpl } from "./_interviewSession/silenceDetection";
import {
  buildWsPcmUrlWithTokenImpl,
  startWsPcmStreamingImpl,
  stopWsPcmStreamingImpl,
  wsPcmHandleWorkletMessageImpl,
  wsPcmSendFinalMarkerImpl,
} from "./_interviewSession/wsPcmStreaming";
import LoadingSpinner from "../../components/common/LoadingSpinner";
import TypingIndicator from "../../components/sessions/TypingIndicator";
import SessionTimer from "../../components/sessions/SessionTimer";
import EvaluationModal from "../../components/sessions/EvaluationModal";
import ConnectModal from "../../components/sessions/ConnectModal";
import ParakeetAnswer from "../../components/sessions/ParakeetAnswer";
import { MobileTopBarContext } from "../../components/layout/Layout";
import { requestParakeetAiAnswer } from "../../services/aiAnswer";
import { requestGroqDirectParakeet } from "../../services/groqDirect";

const InterviewSession = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  useAuth();
  const { socket } = useSocket();
  const queryClient = useQueryClient();

  // English-only listening: force ElevenLabs language to English.
  const elevenLanguageCode = "en";

  const enableAssemblyAiBackup = ["1", "true", "yes", "on"].includes(
    String(import.meta.env.VITE_ENABLE_ASSEMBLYAI_BACKUP || "").toLowerCase()
  );

  const enableWsPcmStt = ["1", "true", "yes", "on"].includes(
    String(import.meta.env.VITE_ENABLE_WS_PCM_STT || "").toLowerCase()
  );
  const wsPcmSttUrlEnv = String(
    import.meta.env.VITE_WS_PCM_STT_URL || ""
  ).trim();

  const {
    transcript: srTranscriptRaw,
    interimTranscript: srInterimRaw,
    finalTranscript: srFinalRaw,
    listening: srListening,
    resetTranscript: srResetTranscript,
    browserSupportsSpeechRecognition: srSupports,
    isMicrophoneAvailable: srMicAvailable,
  } = useSpeechRecognition();

  const _srTranscript = String(srTranscriptRaw || "");
  const srInterim = String(srInterimRaw || "");
  const srFinal = String(srFinalRaw || "");
  const nativeSpeechRecognitionAvailable =
    typeof window !== "undefined" &&
    ("webkitSpeechRecognition" in window || "SpeechRecognition" in window);

  const srCanUse =
    typeof srSupports === "boolean"
      ? srSupports
      : typeof SpeechRecognition?.browserSupportsSpeechRecognition ===
          "function"
        ? SpeechRecognition.browserSupportsSpeechRecognition()
        : !!nativeSpeechRecognitionAvailable;
  const srReset =
    typeof srResetTranscript === "function" ? srResetTranscript : () => {};

  // TEMP: Hide extra panels for mobile co-pilot usage.
  const hideExtras = true;

  const [message, setMessage] = useState("");
  const [listeningText, setListeningText] = useState("");
  const [aiAnswer, setAiAnswer] = useState("");
  const [parakeetAnswer, setParakeetAnswer] = useState(null);
  const [parakeetCleaned, setParakeetCleaned] = useState("");
  const [capturedQuestion, setCapturedQuestion] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const [showEvaluation, setShowEvaluation] = useState(false);
  const [selectedMessage, setSelectedMessage] = useState(null);
  const [transcriptItems, setTranscriptItems] = useState([]);
  const [transcriptAutoScroll, setTranscriptAutoScroll] = useState(true);
  const [isSharing, setIsSharing] = useState(false);
  const [isAnalyzingScreen, setIsAnalyzingScreen] = useState(false);
  const [isGeneratingAnswer, setIsGeneratingAnswer] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);
  const [srBlocked, setSrBlocked] = useState(false);
  const [socketConnected, setSocketConnected] = useState(false);
  const [elevenClientConnected, setElevenClientConnected] = useState(false);

  // ElevenLabs SDK can sometimes throw an unhandled rejection when closing an
  // already-closed AudioContext. This is benign but noisy; suppress only that case.
  useEffect(() => {
    const handler = (event) => {
      try {
        const reason = event?.reason;
        const name = String(reason?.name || "");
        const msg = String(reason?.message || "").toLowerCase();
        if (
          name === "InvalidStateError" &&
          msg.includes("cannot close a closed audiocontext")
        ) {
          event.preventDefault?.();
        }
      } catch {
        // ignore
      }
    };

    window.addEventListener("unhandledrejection", handler);
    return () => window.removeEventListener("unhandledrejection", handler);
  }, []);

  const aiAnswerRawRef = useRef("");

  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const listeningInputRef = useRef(null);
  const listeningTextRef = useRef("");
  const transcriptItemsRef = useRef([]);
  const lastSrFinalCommittedRef = useRef("");
  const assemblyRtErrorNotifiedRef = useRef(false);
  const serverSttConfigErrorNotifiedRef = useRef(false);
  const serverSttUnreachableNotifiedRef = useRef(false);
  const isRecordingRef = useRef(false);
  const startSessionRequestedRef = useRef(false);
  const connectDismissedRef = useRef(false);
  const speechRecognitionRef = useRef(null);
  const speechRecognitionStopRequestedRef = useRef(false);
  const speechRecognitionDisabledRef = useRef(false);
  const speechRecognitionErrorNotifiedRef = useRef(false);
  const speechRecognitionBlockedRef = useRef(false);
  const shouldKeepListeningRef = useRef(false);
  const speechBaseTextRef = useRef("");
  const forceEmptySeedOnNextSrStartRef = useRef(false);

  const lastSrRestartAtRef = useRef(0);
  const srListeningRef = useRef(false);
  const srRecoverySeqRef = useRef(0);

  const lastLocalSpeechUpdateAtRef = useRef(0);
  const continuousPrefixRef = useRef("");
  const continuousWhisperIntervalRef = useRef(null);
  const continuousWhisperInFlightRef = useRef(false);
  const lastServerSttTextRef = useRef("");
  const serverSttDisabledRef = useRef(false);
  const serverSttBackoffUntilRef = useRef(0);
  const lastServerSttCallAtRef = useRef(0);

  const finalPassInFlightRef = useRef(false);
  const finalPassBackoffUntilRef = useRef(0);
  const lastFinalPassAtRef = useRef(0);

  const enableBackgroundServerStt = ["1", "true", "yes", "on"].includes(
    String(
      import.meta.env.VITE_ENABLE_BACKGROUND_SERVER_STT || ""
    ).toLowerCase()
  );

  const readPersistedSttProvider = () => {
    try {
      return String(localStorage.getItem("parakeet.sttProvider") || "")
        .trim()
        .toLowerCase();
    } catch {
      return "";
    }
  };

  const readPersistedSttModel = () => {
    try {
      return String(localStorage.getItem("parakeet.sttModel") || "").trim();
    } catch {
      return "";
    }
  };

  const writePersistedStt = ({ sttProvider, sttModel } = {}) => {
    try {
      if (sttProvider)
        localStorage.setItem("parakeet.sttProvider", String(sttProvider));
      if (typeof sttModel === "string")
        localStorage.setItem("parakeet.sttModel", String(sttModel));
    } catch {
      // ignore
    }
  };

  const defaultSttProvider = readPersistedSttProvider() || "elevenlabs_client";
  const defaultSttModel = readPersistedSttModel() || "scribe_v2_realtime";

  const sttProviderRef = useRef(defaultSttProvider);

  const autoStartListeningRef = useRef(false);
  const prevConnectOpenRef = useRef(false);

  const mediaRecorderRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const audioChunksRef = useRef([]);
  const audioRingRef = useRef([]);
  const audioHeaderChunkRef = useRef(null);
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const silenceRafRef = useRef(null);
  const silenceStateRef = useRef({
    lastTs: null,
    silentMs: 0,
    segmenting: false,
  });

  const assemblyRtActiveRef = useRef(false);
  const assemblyRtBaseRef = useRef("");
  const assemblyRtAudioCtxRef = useRef(null);
  const assemblyRtProcessorRef = useRef(null);
  const assemblyRtSourceRef = useRef(null);

  // AudioWorklet -> 16k PCM -> WebSocket streaming STT (backend gateway)
  const wsPcmRef = useRef(null);
  const wsPcmSeqRef = useRef(0);
  const wsPcmPartialBufferRef = useRef(null); // Int16Array leftover
  const wsPcmSpeechTimerRef = useRef(null);
  const wsPcmAudioCtxRef = useRef(null);
  const wsPcmWorkletNodeRef = useRef(null);
  const wsPcmSourceRef = useRef(null);
  const wsPcmSinkRef = useRef(null);
  const wsPcmErrorNotifiedRef = useRef(false);

  const showWsPcmDebug = !!import.meta.env.DEV;
  const [wsPcmStatus, setWsPcmStatus] = useState("idle");
  const [wsPcmLastError, setWsPcmLastError] = useState("");

  const transcriptEndRef = useRef(null);
  const sharedVideoRef = useRef(null);

  const recordingStartedAtRef = useRef(0);

  const elevenClientBaseRef = useRef("");
  const elevenClientErrorNotifiedRef = useRef(false);
  const elevenClientFallbackTriggeredRef = useRef(false);
  const elevenClientDisabledRef = useRef(false);
  const elevenClientLastFallbackAtRef = useRef(0);
  const elevenClientConnectInFlightRef = useRef(false);
  const elevenClientIgnoreDisconnectUntilRef = useRef(0);
  const elevenClientRuntimeFallbackRef = useRef("");
  const scribeRef = useRef(null);

  const [needsUserGestureResume, setNeedsUserGestureResume] = useState(false);
  const gestureResumeToastShownRef = useRef(false);
  const gestureResumeToastLastAtRef = useRef(0);

  const [micPermissionDialog, setMicPermissionDialog] = useState({
    open: false,
    message: "",
  });
  const micPermissionDialogShownRef = useRef(false);

  const TOAST_ID_MIC_RESUME = "mic-resume";
  const TOAST_ID_ELEVEN_DISCONNECT = "eleven-disconnect";

  // WebSpeech can re-emit old srFinal/srInterim briefly after srReset().
  // We use this to avoid repopulating Listening right after Clear/AI Answer.
  const srIgnoreUpdatesUntilRef = useRef(0);
  const srIgnoreUntilDifferentRef = useRef(0);
  const srTextAtClearRef = useRef("");
  const srStripPrefixRef = useRef("");
  const srStripPrefixUntilRef = useRef(0);

  // Some realtime STT providers can deliver a final chunk shortly after Clear.
  // Briefly ignore those events to avoid old text being appended.
  const ignoreRealtimeUntilRef = useRef(0);

  // MediaRecorder can deliver a queued chunk after Clear that still contains
  // pre-clear audio. Ignore it so old audio can't be transcribed again.
  const audioRingIgnoreUntilRef = useRef(0);

  // Used to drop stale async transcript results (e.g., background server STT)
  // that complete after the user clicks Clear.
  const listeningEpochRef = useRef(0);
  const bumpListeningEpoch = () => {
    listeningEpochRef.current = (listeningEpochRef.current || 0) + 1;
    return listeningEpochRef.current;
  };

  const normalizeSpeechText = (s) =>
    String(s || "")
      .replace(/\s+/g, " ")
      .trimStart();

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

  useEffect(() => {
    srListeningRef.current = !!srListening;
  }, [srListening]);

  const getDefaultWsPcmUrl = () => {
    try {
      const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
      return `${proto}//${window.location.host}/api/v1/stt/stream`;
    } catch {
      return "";
    }
  };

  const buildWsPcmUrlWithToken = () => {
    const base = wsPcmSttUrlEnv || getDefaultWsPcmUrl();
    if (!base) return "";
    const token = getAccessToken();
    if (!token) return "";
    try {
      const u = new URL(base);
      u.searchParams.set("token", token);
      return u.toString();
    } catch {
      // base might be relative. Construct absolute.
      const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
      const abs = base.startsWith("/")
        ? `${proto}//${window.location.host}${base}`
        : base;
      try {
        const u2 = new URL(abs);
        u2.searchParams.set("token", token);
        return u2.toString();
      } catch {
        return "";
      }
    }
  };

  const stopWsPcmStreaming = ({ sendFinalize } = {}) => {
    try {
      if (wsPcmSpeechTimerRef.current) {
        clearTimeout(wsPcmSpeechTimerRef.current);
        wsPcmSpeechTimerRef.current = null;
      }

      if (sendFinalize && wsPcmRef.current?.readyState === WebSocket.OPEN) {
        try {
          wsPcmRef.current.send(
            JSON.stringify({
              type: "finalize",
              sessionId: id,
              ts: Date.now(),
            })
          );
        } catch {
          // ignore
        }
      }

      try {
        wsPcmRef.current?.close?.();
      } catch {
        // ignore
      }
      wsPcmRef.current = null;
      try {
        setWsPcmStatus("closed");
      } catch {
        // ignore
      }
      wsPcmSeqRef.current = 0;
      wsPcmPartialBufferRef.current = null;

      try {
        wsPcmWorkletNodeRef.current?.port?.postMessage?.({ type: "stop" });
      } catch {
        // ignore
      }

      try {
        wsPcmSourceRef.current?.disconnect?.();
      } catch {
        // ignore
      }
      try {
        wsPcmWorkletNodeRef.current?.disconnect?.();
      } catch {
        // ignore
      }
      try {
        wsPcmSinkRef.current?.disconnect?.();
      } catch {
        // ignore
      }

      wsPcmSourceRef.current = null;
      wsPcmWorkletNodeRef.current = null;
      wsPcmSinkRef.current = null;

      try {
        wsPcmAudioCtxRef.current?.close?.();
      } catch {
        // ignore
      }
      wsPcmAudioCtxRef.current = null;
    } catch {
      // ignore
    }
  };

  const wsPcmSendFinalMarker = () => {
    const ws = wsPcmRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    const leftover = wsPcmPartialBufferRef.current;
    if (leftover && leftover.length > 0) {
      const header = {
        type: "audio_frame",
        sessionId: id,
        seq: wsPcmSeqRef.current++,
        ts: Date.now(),
        sampleRate: 16000,
        isFinal: true,
      };
      try {
        ws.send(packFrame(header, leftover));
      } catch {
        // ignore
      }
      wsPcmPartialBufferRef.current = null;
      return;
    }

    try {
      ws.send(
        JSON.stringify({
          type: "utterance_end",
          sessionId: id,
          ts: Date.now(),
        })
      );
    } catch {
      // ignore
    }
  };

  const wsPcmHandleWorkletMessage = ({ audioBuffer, isSpeech }) => {
    const ws = wsPcmRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (!audioBuffer) return;

    const FRAME_SAMPLES = 320; // 20ms @ 16k

    const int16 = new Int16Array(audioBuffer);
    let prev = wsPcmPartialBufferRef.current;
    if (!prev) prev = new Int16Array(0);

    const combined = new Int16Array(prev.length + int16.length);
    combined.set(prev, 0);
    combined.set(int16, prev.length);

    let offset = 0;
    while (combined.length - offset >= FRAME_SAMPLES) {
      const frame = combined.slice(offset, offset + FRAME_SAMPLES);
      offset += FRAME_SAMPLES;

      const header = {
        type: "audio_frame",
        sessionId: id,
        seq: wsPcmSeqRef.current++,
        ts: Date.now(),
        sampleRate: 16000,
        isFinal: false,
      };

      try {
        ws.send(packFrame(header, frame));
      } catch {
        // ignore
      }
    }

    wsPcmPartialBufferRef.current = combined.slice(offset);

    if (isSpeech) {
      if (wsPcmSpeechTimerRef.current) {
        clearTimeout(wsPcmSpeechTimerRef.current);
      }
      wsPcmSpeechTimerRef.current = setTimeout(() => {
        wsPcmSendFinalMarker();
      }, 600);
    }
  };

  const startWsPcmStreaming = async ({ stream }) => {
    if (!enableWsPcmStt) return;
    if (!id) return;
    if (!stream) return;
    if (wsPcmRef.current) return;

    // If we already have a realtime provider connected, don't double-stream.
    const providerKey = String(sttProviderRef.current || "")
      .trim()
      .toLowerCase();
    if (providerKey === "elevenlabs_client" || providerKey === "assemblyai") {
      return;
    }

    const wsUrl = buildWsPcmUrlWithToken();
    if (!wsUrl) {
      if (!wsPcmErrorNotifiedRef.current) {
        wsPcmErrorNotifiedRef.current = true;
        toast.error("WS STT unavailable (missing auth token). ");
      }
      return;
    }

    try {
      setWsPcmLastError("");
      setWsPcmStatus("connecting");

      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;

      const audioCtx = new AudioContext();
      wsPcmAudioCtxRef.current = audioCtx;

      await audioCtx.audioWorklet.addModule("/audio-worklet-processor.js");

      const source = audioCtx.createMediaStreamSource(stream);
      const node = new AudioWorkletNode(audioCtx, "downsample-vad-processor");

      // Mute sink to keep the graph alive without echo.
      const sink = audioCtx.createGain();
      sink.gain.value = 0;
      node.connect(sink);
      sink.connect(audioCtx.destination);
      source.connect(node);

      wsPcmSourceRef.current = source;
      wsPcmWorkletNodeRef.current = node;
      wsPcmSinkRef.current = sink;

      node.port.onmessage = (ev) => {
        try {
          wsPcmHandleWorkletMessage(ev?.data || {});
        } catch {
          // ignore
        }
      };

      wsPcmSeqRef.current = 0;
      wsPcmPartialBufferRef.current = null;

      const ws = makeWS(wsUrl, (ev) => {
        try {
          const raw = ev?.data;
          if (typeof raw !== "string") return;
          const msg = JSON.parse(raw);

          const type = String(msg?.type || "")
            .trim()
            .toLowerCase();
          if (type === "final") {
            const ignoreUntil = Number(ignoreRealtimeUntilRef.current || 0);
            if (ignoreUntil && Date.now() < ignoreUntil) return;

            const text = String(msg?.text || "").trim();
            if (!text) return;

            lastLocalSpeechUpdateAtRef.current = Date.now();

            // Commit like other mic sources.
            pushTranscript(text, "mic", { broadcast: true });
            const next = `${speechBaseTextRef.current}${text} `.trimStart();
            setMessage(next);
            speechBaseTextRef.current = `${next.trimEnd()} `;
          } else if (type === "error") {
            const status = Number(msg?.status || 0);
            if (status === 401 && !wsPcmErrorNotifiedRef.current) {
              wsPcmErrorNotifiedRef.current = true;
              toast.error("WS STT unauthorized. Please re-login.");
            }

            try {
              const m = String(msg?.message || "").trim();
              setWsPcmLastError(m || `WS STT error (HTTP ${status || "?"})`);
              setWsPcmStatus("error");
            } catch {
              // ignore
            }
          }
        } catch {
          // ignore
        }
      });

      wsPcmRef.current = ws;

      ws.onopen = () => {
        try {
          setWsPcmStatus("connected");
        } catch {
          // ignore
        }
        try {
          ws.send(
            JSON.stringify({
              type: "hello",
              sessionId: id,
              sampleRate: 16000,
              ts: Date.now(),
            })
          );
        } catch {
          // ignore
        }
      };

      ws.onclose = () => {
        try {
          setWsPcmStatus("closed");
        } catch {
          // ignore
        }
      };

      ws.onerror = () => {
        try {
          setWsPcmStatus("error");
          setWsPcmLastError((prev) => prev || "WS STT network error");
        } catch {
          // ignore
        }
      };
    } catch {
      stopWsPcmStreaming({ sendFinalize: false });
      if (!wsPcmErrorNotifiedRef.current) {
        wsPcmErrorNotifiedRef.current = true;
        toast.error("Could not start WS STT.");
      }
    }
  };

  // Android/Chrome: mic and WebSpeech can be blocked unless started in direct
  // response to a user gesture. If a disconnect triggers fallback, arm a one-
  // time resume on the next tap/key.
  useEffect(() => {
    if (!hideExtras) return;
    if (!needsUserGestureResume) return;

    const resume = () => {
      try {
        setNeedsUserGestureResume(false);
      } catch {
        // ignore
      }
      try {
        // Allow toasts again, but throttle to prevent stacking.
        gestureResumeToastShownRef.current = false;
      } catch {
        // ignore
      }
      try {
        void handleStartRecording?.({ fromUserGesture: true });
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hideExtras, needsUserGestureResume]);

  const scheduleWebSpeechRecovery = (..._args) => {
    scheduleWebSpeechRecoveryImpl({
      hideExtras,
      shouldKeepListeningRef,
      isRecordingRef,
      srCanUse,
      srMicAvailable,
      speechRecognitionDisabledRef,
      speechRecognitionBlockedRef,
      setSrBlocked,
      srRecoverySeqRef,
      srListeningRef,
      startWebSpeechRecognition,
    });
  };

  useEffect(() => {
    transcriptItemsRef.current = transcriptItems;
  }, [transcriptItems]);

  // Frontend-only STT: keep Listening updated from react-speech-recognition.
  useEffect(() => {
    if (!shouldKeepListeningRef.current) return;

    if (hideExtras) {
      const until = Number(srIgnoreUpdatesUntilRef.current || 0);
      if (until && Date.now() < until) return;

      const untilDiff = Number(srIgnoreUntilDifferentRef.current || 0);
      if (untilDiff && Date.now() < untilDiff) {
        const combined = normalizeSpeechText(
          `${String(srFinal || "")} ${String(srInterim || "")}`
        );
        if (combined && combined === String(srTextAtClearRef.current || "")) {
          return;
        }
      }
    }

    const seed = speechBaseTextRef.current || "";

    let raw = normalizeSpeechText(
      `${String(srFinal || "")} ${String(srInterim || "")}`
    );
    if (hideExtras) {
      const stripUntil = Number(srStripPrefixUntilRef.current || 0);
      const stripPrefix = normalizeSpeechText(srStripPrefixRef.current || "");
      if (stripUntil && Date.now() < stripUntil && stripPrefix) {
        const rawLower = raw.toLowerCase();
        const prefixLower = stripPrefix.toLowerCase();

        if (rawLower.startsWith(prefixLower)) {
          raw = raw.slice(stripPrefix.length).trimStart();
        } else {
          // Fuzzy strip: if at least a few starting words match, strip by word-count.
          const pWords = prefixLower.split(" ").filter(Boolean);
          const rWordsLower = rawLower.split(" ").filter(Boolean);
          const rWordsOrig = raw.split(" ").filter(Boolean);

          let k = 0;
          while (k < pWords.length && k < rWordsLower.length) {
            if (pWords[k] !== rWordsLower[k]) break;
            k += 1;
          }

          const minWordsToStrip = Math.min(4, pWords.length);
          if (k >= minWordsToStrip) {
            raw = rWordsOrig.slice(k).join(" ").trimStart();
          }
        }
      } else if (stripPrefix && stripUntil && Date.now() >= stripUntil) {
        srStripPrefixRef.current = "";
        srStripPrefixUntilRef.current = 0;
      }
    }

    const next = `${seed}${raw}`.trimStart();

    // If we're waiting for a user gesture to (re)start mic, don't clobber the
    // UI hint with empty SR output.
    if (hideExtras && needsUserGestureResume) {
      if (!String(next || "").trim()) return;
    }

    if (next !== listeningTextRef.current) {
      if (String(srFinal || srInterim || "").trim()) {
        lastLocalSpeechUpdateAtRef.current = Date.now();
      }
      setListeningText(next);
      if (!hideExtras) setMessage(next);
    }
  }, [srFinal, srInterim, hideExtras]);

  const isProbablyInsecureContext = () => {
    try {
      if (typeof window === "undefined") return false;
      if (window.isSecureContext) return false;
      const host = String(window.location?.hostname || "").toLowerCase();
      // localhost is treated as secure in many browsers.
      if (host === "localhost" || host === "127.0.0.1") return false;
      return true;
    } catch {
      return false;
    }
  };

  const isAndroidBrowser = () => {
    try {
      return /android/i.test(String(navigator?.userAgent || ""));
    } catch {
      return false;
    }
  };

  // Co-pilot reliability: WebSpeech often stops on its own (or after other UI
  // actions). If we're still recording, restart it with a small backoff.
  useEffect(() => {
    if (!hideExtras) return;
    if (!shouldKeepListeningRef.current) return;
    if (!isRecordingRef.current) return;
    if (srListening) return;
    if (!srCanUse) return;
    if (srMicAvailable === false) return;
    if (speechRecognitionDisabledRef.current) return;

    const now = Date.now();
    if (now - (lastSrRestartAtRef.current || 0) < 1500) return;
    lastSrRestartAtRef.current = now;

    // If SR is marked blocked due to a transient start error, keep trying.
    scheduleWebSpeechRecovery("auto");

    return () => {};
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hideExtras, srListening, srCanUse, srMicAvailable]);

  // Co-pilot: if WebSpeech isn't usable (iOS/ngrok cases), ensure background server STT
  // loop is running so Listening keeps updating.
  useEffect(() => {
    if (!hideExtras) return;
    if (!shouldKeepListeningRef.current) return;
    if (!isRecordingRef.current) return;
    if (isWebSpeechLiveUsable()) return;
    startBackgroundServerSttLoop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hideExtras, srListening, srCanUse, srMicAvailable]);

  const languageToLocale = (language) => {
    switch ((language || "english").toLowerCase()) {
      case "hindi":
        return "hi-IN";
      case "spanish":
        return "es-ES";
      case "french":
        return "fr-FR";
      case "german":
        return "de-DE";
      case "english":
      default:
        // Better default for Indian accent/English on mobile.
        return "en-IN";
    }
  };

  const setRecordingState = (next) => {
    isRecordingRef.current = next;
    setIsRecording(next);

    if (next) {
      try {
        setNeedsUserGestureResume(false);
      } catch {
        // ignore
      }
    }

    if (next) {
      if (!recordingStartedAtRef.current) {
        recordingStartedAtRef.current = Date.now();
      }
    } else {
      recordingStartedAtRef.current = 0;
    }
  };

  const stopElevenLabsClientRealtime = () =>
    stopElevenLabsClientRealtimeUtil({ scribeRef });

  const fallbackFromElevenLabsClientRealtime = ({ reason, err } = {}) => {
    try {
      if (
        String(sttProviderRef.current || "").toLowerCase() !==
        "elevenlabs_client"
      ) {
        return;
      }

      const now = Date.now();
      if (now - (elevenClientLastFallbackAtRef.current || 0) < 2500) {
        return;
      }
      elevenClientLastFallbackAtRef.current = now;

      if (elevenClientFallbackTriggeredRef.current) return;
      elevenClientFallbackTriggeredRef.current = true;

      // Stop the underlying mic/WebSocket pipeline immediately.
      // Otherwise the SDK worker keeps emitting frames and throws
      // "WebSocket is not connected" repeatedly.
      shouldKeepListeningRef.current = false;
      setRecordingState(false);
      stopElevenLabsClientRealtime();
      elevenClientBaseRef.current = "";

      const { hardFailure, toastMessage } = classifyElevenLabsRealtimeError({
        reason,
        err,
      });

      if (hardFailure) {
        elevenClientDisabledRef.current = true;
      }

      if (!elevenClientErrorNotifiedRef.current) {
        elevenClientErrorNotifiedRef.current = true;
        toast.error(toastMessage, { id: TOAST_ID_ELEVEN_DISCONNECT });
      }

      const canUseWebSpeech = srCanUse && srMicAvailable !== false;
      const fallbackProvider = canUseWebSpeech ? "webspeech" : "groq";

      // IMPORTANT: do NOT change the selected STT provider automatically.
      // Keep the user's setting (elevenlabs_client) and only apply a runtime fallback.
      elevenClientRuntimeFallbackRef.current = fallbackProvider;

      shouldKeepListeningRef.current = true;

      // Android: even on HTTPS, starting mic/SR from a disconnect callback is
      // frequently blocked. Always show a resume hint and arm the next tap/key
      // as a guaranteed user gesture.
      try {
        setNeedsUserGestureResume(true);
      } catch {
        // ignore
      }
      setListeningText((prev) => prev || "Tap to resume listening…");
    } catch {
      // ignore
    }
  };

  const showMicResumeToast = () => {
    const ts = Date.now();
    if (ts - (gestureResumeToastLastAtRef.current || 0) < 5000) return;
    gestureResumeToastLastAtRef.current = ts;
    gestureResumeToastShownRef.current = true;
    toast.error("Tap anywhere to resume microphone listening.", {
      id: TOAST_ID_MIC_RESUME,
    });
  };

  const openMicPermissionDialog = (message) => {
    try {
      micPermissionDialogShownRef.current = true;
      setMicPermissionDialog({
        open: true,
        message:
          String(message || "") ||
          "To use speech-to-text, please allow microphone access.",
      });
    } catch {
      // ignore
    }
  };

  const closeMicPermissionDialog = () => {
    try {
      setMicPermissionDialog((prev) => ({ ...prev, open: false }));
    } catch {
      // ignore
    }
  };

  const getEffectiveSttProvider = ({ canUseWebSpeech } = {}) => {
    const selected = String(sttProviderRef.current || "groq")
      .trim()
      .toLowerCase();

    if (selected !== "elevenlabs_client") return selected || "groq";

    // If ElevenLabs has fallen back or is disabled, use a runtime-only fallback,
    // but never mutate the selected provider.
    const runtimeFallback = String(elevenClientRuntimeFallbackRef.current || "")
      .trim()
      .toLowerCase();

    if (runtimeFallback) return runtimeFallback;

    if (
      elevenClientDisabledRef.current ||
      elevenClientFallbackTriggeredRef.current
    ) {
      return canUseWebSpeech ? "webspeech" : "groq";
    }

    return "elevenlabs_client";
  };

  const startWebSpeechRecognition = async ({ force } = {}) => {
    return await startWebSpeechRecognitionImpl(
      {
        srCanUse,
        srMicAvailable,
        hideExtras,
        message,
        session,
        SpeechRecognition,
        srReset,
        setSrBlocked,
        setRecordingState,
        languageToLocale,
        listeningTextRef,
        speechBaseTextRef,
        lastSrFinalCommittedRef,
        forceEmptySeedOnNextSrStartRef,
        speechRecognitionDisabledRef,
        speechRecognitionBlockedRef,
        speechRecognitionStopRequestedRef,
        speechRecognitionRef,
        stopSpeechRecognition,
      },
      { force }
    );
  };

  const isWebSpeechLiveUsable = () =>
    isWebSpeechLiveUsableImpl({
      srCanUse,
      srMicAvailable,
      speechRecognitionDisabledRef,
      speechRecognitionBlockedRef,
    });

  const isWebSpeechLikelyStalled = () => {
    try {
      if (!hideExtras) return false;
      if (!isRecordingRef.current) return false;
      if (!shouldKeepListeningRef.current) return false;
      if (!isWebSpeechLiveUsable()) return false;

      const startedAt = recordingStartedAtRef.current || 0;
      if (!startedAt) return false;
      if (Date.now() - startedAt < 6500) return false;

      // Only attempt server fallback once we actually have some audio buffered.
      const ringParts = audioRingRef.current?.length || 0;
      if (ringParts < 6) return false;

      const hasLive = !!String(listeningTextRef.current || "").trim();
      const sinceLocal = Date.now() - (lastLocalSpeechUpdateAtRef.current || 0);

      // SR can claim it's supported but never actually start or emit results.
      if (!srListeningRef.current && sinceLocal > 6000) return true;
      if (!hasLive && sinceLocal > 7000) return true;
      if (sinceLocal > 12000) return true;
      return false;
    } catch {
      return false;
    }
  };

  const pickRecorderMimeType = () => {
    if (typeof window === "undefined" || !window.MediaRecorder) return "";

    const candidates = [
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/mp4",
      "audio/mpeg",
      "audio/wav",
    ];

    for (const type of candidates) {
      try {
        if (window.MediaRecorder.isTypeSupported(type)) return type;
      } catch {
        // ignore
      }
    }
    return "";
  };

  const stopAndCleanupMedia = async () => {
    try {
      if (continuousWhisperIntervalRef.current) {
        clearInterval(continuousWhisperIntervalRef.current);
      }
    } catch {
      // noop
    }
    continuousWhisperIntervalRef.current = null;
    continuousWhisperInFlightRef.current = false;
    lastServerSttTextRef.current = "";
    serverSttBackoffUntilRef.current = 0;

    try {
      if (silenceRafRef.current) cancelAnimationFrame(silenceRafRef.current);
    } catch {
      // noop
    }
    silenceRafRef.current = null;
    silenceStateRef.current = { lastTs: null, silentMs: 0, segmenting: false };

    try {
      analyserRef.current = null;
      if (audioContextRef.current) {
        await audioContextRef.current.close();
      }
    } catch {
      // noop
    }
    audioContextRef.current = null;

    // Also stop the WS PCM streaming pipeline if active.
    stopWsPcmStreaming({ sendFinalize: false });

    try {
      if (
        mediaRecorderRef.current &&
        mediaRecorderRef.current.state !== "inactive"
      ) {
        mediaRecorderRef.current.stop();
      }
    } catch {
      // noop
    }
    mediaRecorderRef.current = null;

    try {
      mediaStreamRef.current?.getTracks?.().forEach((t) => t.stop());
    } catch {
      // noop
    }
    mediaStreamRef.current = null;
    audioChunksRef.current = [];
    audioRingRef.current = [];
    audioHeaderChunkRef.current = null;
  };

  const stopSpeechRecognition = () =>
    stopSpeechRecognitionImpl({
      SpeechRecognition,
      speechRecognitionStopRequestedRef,
      speechRecognitionRef,
    });

  const downsampleFloat32ToInt16 = (
    float32Array,
    inSampleRate,
    outSampleRate
  ) => {
    if (!float32Array?.length) return null;
    if (!inSampleRate || !outSampleRate) return null;
    if (outSampleRate === inSampleRate) {
      const out = new Int16Array(float32Array.length);
      for (let i = 0; i < float32Array.length; i += 1) {
        const s = Math.max(-1, Math.min(1, float32Array[i]));
        out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }
      return out;
    }

    const ratio = inSampleRate / outSampleRate;
    const outLength = Math.max(1, Math.floor(float32Array.length / ratio));
    const out = new Int16Array(outLength);

    let offset = 0;
    for (let i = 0; i < outLength; i += 1) {
      const nextOffset = Math.floor((i + 1) * ratio);
      let sum = 0;
      let count = 0;
      for (let j = offset; j < nextOffset && j < float32Array.length; j += 1) {
        sum += float32Array[j];
        count += 1;
      }
      offset = nextOffset;
      const avg = count ? sum / count : 0;
      const s = Math.max(-1, Math.min(1, avg));
      out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return out;
  };

  const stopAssemblyAiRealtime = () => {
    assemblyRtActiveRef.current = false;
    assemblyRtBaseRef.current = "";

    try {
      if (socket && id) {
        socket.emit("stt_stop", { sessionId: id });
      }
    } catch {
      // ignore
    }

    try {
      assemblyRtProcessorRef.current?.disconnect?.();
    } catch {
      // ignore
    }
    try {
      assemblyRtSourceRef.current?.disconnect?.();
    } catch {
      // ignore
    }
    try {
      const ctx = assemblyRtAudioCtxRef.current;
      if (ctx) ctx.close?.();
    } catch {
      // ignore
    }

    assemblyRtProcessorRef.current = null;
    assemblyRtSourceRef.current = null;
    assemblyRtAudioCtxRef.current = null;
  };

  const startAssemblyAiRealtime = async (stream, { provider } = {}) => {
    if (!socket || !id) {
      return { ok: false, message: "Socket not ready for realtime STT" };
    }
    if (!stream) {
      return { ok: false, message: "Missing microphone stream" };
    }

    const providerKey = String(provider || "assemblyai")
      .trim()
      .toLowerCase();

    try {
      // Start realtime session on backend (backend proxies AssemblyAI API key)
      const resp = await new Promise((resolve) => {
        try {
          socket.emit(
            "stt_start",
            {
              provider: providerKey,
              sessionId: id,
              sampleRate: 16000,
              ...(providerKey === "assemblyai"
                ? {
                    wordBoost: getSttBoostWords(),
                    boostParam: "high",
                  }
                : {
                    modelId: "scribe_v2_realtime",
                    audioFormat: "pcm_16000",
                    commitStrategy: "vad",
                  }),
            },
            (r) => resolve(r || null)
          );
        } catch {
          resolve(null);
        }
      });
      const ok = !!resp?.ok;
      if (!ok) {
        stopAssemblyAiRealtime();
        return {
          ok: false,
          status: resp?.status,
          message:
            resp?.message ||
            (providerKey === "assemblyai"
              ? "AssemblyAI realtime is not available. Enable it on the server or choose Groq/OpenAI."
              : "ElevenLabs realtime is not available. Enable it on the server or choose Groq/OpenAI."),
        };
      }

      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) {
        stopAssemblyAiRealtime();
        return { ok: false, message: "AudioContext is not available" };
      }

      // Prefer low-latency audio processing.
      // Note: some browsers ignore `latencyHint`.
      const ctx = new AudioContext({ latencyHint: "interactive" });
      assemblyRtAudioCtxRef.current = ctx;

      const source = ctx.createMediaStreamSource(stream);
      assemblyRtSourceRef.current = source;

      // ScriptProcessor is deprecated but widely supported and fine for MVP.
      // We'll accumulate and send ~50ms frames to match AssemblyAI guidance.
      const processor = ctx.createScriptProcessor(2048, 1, 1);
      assemblyRtProcessorRef.current = processor;

      const TARGET_SAMPLE_RATE = 16000;
      const SAMPLES_PER_CHUNK = 800; // 50ms at 16kHz
      let pendingParts = [];
      let pendingLen = 0;

      const takeSamples = (n) => {
        if (pendingLen < n) return null;
        const out = new Int16Array(n);
        let outOff = 0;

        while (outOff < n && pendingParts.length) {
          const head = pendingParts[0];
          const need = n - outOff;
          const take = Math.min(need, head.length);
          out.set(head.subarray(0, take), outOff);
          outOff += take;

          if (take === head.length) {
            pendingParts.shift();
          } else {
            pendingParts[0] = head.subarray(take);
          }
        }

        pendingLen -= n;
        return out;
      };

      processor.onaudioprocess = (event) => {
        try {
          if (!assemblyRtActiveRef.current) return;
          if (!socket?.connected) return;

          const input = event.inputBuffer.getChannelData(0);
          const pcm16 = downsampleFloat32ToInt16(
            input,
            ctx.sampleRate,
            TARGET_SAMPLE_RATE
          );
          if (!pcm16 || !pcm16.length) return;

          pendingParts.push(pcm16);
          pendingLen += pcm16.length;

          // Send 50ms frames for lower latency and more stable STT.
          while (pendingLen >= SAMPLES_PER_CHUNK) {
            const frame = takeSamples(SAMPLES_PER_CHUNK);
            if (!frame) break;
            socket.emit("stt_audio", id, frame.buffer);
          }
        } catch {
          // ignore
        }
      };

      source.connect(processor);
      // Connect to destination to keep processor running (some browsers require it).
      processor.connect(ctx.destination);

      assemblyRtBaseRef.current = "";
      assemblyRtActiveRef.current = true;
      assemblyRtErrorNotifiedRef.current = false;
      return { ok: true };
    } catch {
      stopAssemblyAiRealtime();
      return {
        ok: false,
        message:
          providerKey === "assemblyai"
            ? "AssemblyAI realtime failed to start. Enable it on the server or choose Groq/OpenAI."
            : "ElevenLabs realtime failed to start. Enable it on the server or choose Groq/OpenAI.",
      };
    }
  };

  useEffect(() => {
    if (!socket) {
      setSocketConnected(false);
      return;
    }

    const onConnect = () => setSocketConnected(true);
    const onDisconnect = () => setSocketConnected(false);

    setSocketConnected(!!socket.connected);
    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
    };
  }, [socket]);

  // If recording started before Socket.IO connected, kick off realtime STT once ready.
  useEffect(() => {
    if (!hideExtras) return;
    if (!socketConnected) return;
    if (!isRecordingRef.current) return;

    const p = String(sttProviderRef.current || "").toLowerCase();
    const wantsRealtime = p === "assemblyai";
    if (!wantsRealtime) {
      if (assemblyRtActiveRef.current) stopAssemblyAiRealtime();
      return;
    }

    // Keep existing toggle behavior for AssemblyAI auto-start.
    if (p === "assemblyai" && !enableAssemblyAiBackup) return;

    if (assemblyRtActiveRef.current) return;

    const stream = mediaStreamRef.current;
    if (!stream) return;

    // Hybrid mode: keep WebSpeech running for instant feedback.
    stopAssemblyAiRealtime();
    void startAssemblyAiRealtime(stream, { provider: p });
  }, [hideExtras, socketConnected, id, enableAssemblyAiBackup]);

  const transcribeAudioBlob = async (
    audioBlob,
    { prompt, correctWithAi } = {}
  ) => {
    const formData = new FormData();
    const type = String(audioBlob?.type || "").toLowerCase();
    const ext = type.includes("wav")
      ? "wav"
      : type.includes("mp4")
        ? "mp4"
        : type.includes("mpeg") || type.includes("mp3")
          ? "mp3"
          : "webm";
    const filename = `audio-${Date.now()}.${ext}`;
    formData.append("audio", audioBlob, filename);
    if (prompt) {
      // Keep prompts small for faster Whisper-family decoding.
      // Backend also enforces its own max via STT_PROMPT_MAX_CHARS.
      formData.append("prompt", String(prompt).slice(0, 240));
    }
    if (correctWithAi) {
      formData.append("correctWithAi", "1");
    }
    const response = await api.post(`/sessions/${id}/transcribe`, formData);
    return response.data;
  };

  const getSttPromptText = () => {
    const techHint =
      "Technical interview. Prefer these terms if ambiguous: JavaScript, TypeScript, HTML, CSS, React, Node.js, Express, MongoDB, REST, GraphQL, AWS, CI/CD, NPM, Git, MERN, full stack. Example: closure (not closer).";
    const roleHint = session?.job?.title
      ? `Role: ${String(session.job.title).trim()}.`
      : "";

    // In co-pilot mode, `message` is typically empty, so use live SR text + recent transcript.
    const now = Date.now();
    const recent = (transcriptItemsRef.current || [])
      .filter((t) => {
        const ts = t?.ts ? Date.parse(t.ts) : NaN;
        if (!Number.isFinite(ts)) return false;
        return now - ts <= 60_000;
      })
      .map((t) => String(t?.text || "").trim())
      .filter(Boolean)
      .join(" ")
      .trim();

    const live = String(listeningTextRef.current || "").trim();
    const base = (recent || live).replace(/\s+/g, " ").trim();
    // Keep prompt short; providers typically recommend a few hundred chars.
    const contextual = base ? base.slice(-220) : "";
    const combined = [techHint, roleHint, contextual].filter(Boolean).join(" ");
    // Groq's whisper-large-v3* benefits from short, high-signal prompts.
    return combined.slice(0, 240);
  };

  const getSttBoostWords = () => {
    const base = String(getSttPromptText() || "");

    const fixed = [
      "JavaScript",
      "TypeScript",
      "HTML",
      "CSS",
      "React",
      "Node.js",
      "Express",
      "MongoDB",
      "REST",
      "GraphQL",
      "Socket.IO",
      "AWS",
      "CI/CD",
      "Git",
      "NPM",
      "MERN",
      "full stack",
      "closure",
    ];

    const tokens = base
      .replace(/[^a-zA-Z0-9_+./-]+/g, " ")
      .split(/\s+/)
      .map((t) => t.trim())
      .filter(Boolean)
      .filter((t) => t.length >= 3);

    const out = [];
    const seen = new Set();
    const push = (w) => {
      const s = String(w || "").trim();
      if (!s) return;
      const key = s.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      out.push(s);
    };

    for (const w of fixed) push(w);
    for (const t of tokens) push(t);

    return out.slice(0, 60);
  };

  const getBufferedAudioBlob = () => {
    return getBufferedAudioBlobImpl({
      audioHeaderChunkRef,
      audioRingRef,
      mediaRecorderRef,
    });
  };

  const getLastRingBlob = (seconds = 6) => {
    return getLastRingBlobImpl({
      seconds,
      audioHeaderChunkRef,
      audioRingRef,
      mediaRecorderRef,
    });
  };

  const mergeTailText = (baseText, refinedText) => {
    const base = String(baseText || "")
      .replace(/\s+/g, " ")
      .trim();
    const refined = String(refinedText || "")
      .replace(/\s+/g, " ")
      .trim();
    if (!refined) return base;
    if (!base) return refined;
    if (base.includes(refined)) return base;
    if (refined.includes(base)) return refined;

    const baseWords = base.split(" ");
    const refinedWords = refined.split(" ");
    const maxK = Math.min(8, baseWords.length, refinedWords.length);
    for (let k = maxK; k >= 2; k -= 1) {
      const suffix = baseWords.slice(-k).join(" ").toLowerCase();
      const prefix = refinedWords.slice(0, k).join(" ").toLowerCase();
      if (suffix === prefix) {
        const merged = [...baseWords.slice(0, -k), ...refinedWords]
          .join(" ")
          .replace(/\s+/g, " ")
          .trim();
        return merged;
      }
    }
    return `${base} ${refined}`.replace(/\s+/g, " ").trim();
  };

  const normalizeTechTerms = (inputText) => {
    let text = String(inputText || "");
    if (!text.trim()) return text;

    const rules = [
      [/\bjava\s*script\b/gi, "JavaScript"],
      [/\btype\s*script\b/gi, "TypeScript"],
      [/\breact\s*js\b/gi, "React"],
      [/\bnode\s*js\b/gi, "Node.js"],
      [/\bnext\s*js\b/gi, "Next.js"],
      [/\bvue\s*js\b/gi, "Vue"],
      [/\bexpress\s*js\b/gi, "Express"],
      [/\bmongo\s*db\b/gi, "MongoDB"],
      [/\bpost\s*gres\b/gi, "Postgres"],
      [/\bpostgre\s*sql\b/gi, "PostgreSQL"],
      [/\bweb\s*socket\b/gi, "WebSocket"],
      [/\bgraph\s*ql\b/gi, "GraphQL"],
      [/\brest\s*api\b/gi, "REST API"],
      [/\bci\s*cd\b/gi, "CI/CD"],
      [/\bk\s*8\s*s\b/gi, "Kubernetes"],
      [/\bkubernetes\b/gi, "Kubernetes"],
      [/\bsocket\s*io\b/gi, "Socket.IO"],
    ];

    for (const [re, replacement] of rules) {
      text = text.replace(re, replacement);
    }

    return text;
  };

  // Note: Co-pilot mode no longer runs background server STT/final-pass refinement.
  // We only update Listening via WebSpeech/Realtime, and we only call server STT when
  // user explicitly taps “AI Answer”.

  const transcribeBufferedAudioForQuestion = async () => {
    return transcribeBufferedAudioForQuestionImpl({
      srCanUse,
      srMicAvailable,
      getEffectiveSttProvider,
      listeningTextRef,
      getLastRingBlob,
      getBufferedAudioBlob,
      transcribeAudioBlob,
      getSttPromptText,
    });
  };

  const formatAiAnswerText = (raw) => {
    const input = String(raw || "")
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      .trim();
    if (!input) return "";

    // Drop common noisy prefixes some models add.
    let text = input
      .replace(/^\s*(answer|final answer|response|ai answer)\s*:\s*/i, "")
      .trim();

    // Normalize bullets/numbering into Markdown.
    const lines = text.split("\n");
    const out = [];
    for (const line of lines) {
      const trimmed = line.trimStart();
      const indent = " ".repeat(line.length - trimmed.length);

      // If the model already double-prefixed list markers (e.g. "- - item" or "- • item"), collapse to a single marker.
      const doubleList = trimmed.match(/^([-–—])\s+([•*\-–—])\s+(.*)$/);
      if (doubleList) {
        out.push(`${indent}- ${doubleList[3]}`.trimEnd());
        continue;
      }

      // Convert unicode/alt bullets to '- '
      const bulletMatch = trimmed.match(/^([•*]|[-–—])\s+(.*)$/);
      if (bulletMatch) {
        out.push(`${indent}- ${bulletMatch[2]}`.trimEnd());
        continue;
      }

      // Convert '1)' or '1 -' to '1.'
      const numMatch = trimmed.match(/^(\d{1,2})(\)|\s*[-–—])\s+(.*)$/);
      if (numMatch) {
        out.push(`${indent}${numMatch[1]}. ${numMatch[3]}`.trimEnd());
        continue;
      }

      out.push(line.trimEnd());
    }

    // Ensure a blank line before lists.
    const spaced = [];
    for (let i = 0; i < out.length; i += 1) {
      const cur = out[i];
      const prev = spaced.length ? spaced[spaced.length - 1] : "";
      const curIsList =
        cur.trimStart().startsWith("- ") || /^\d+\.\s+/.test(cur.trimStart());
      const prevIsList =
        prev.trimStart().startsWith("- ") || /^\d+\.\s+/.test(prev.trimStart());

      if (curIsList && prev && prev.trim() !== "" && !prevIsList) {
        spaced.push("");
      }
      spaced.push(cur);
    }

    text = spaced.join("\n");
    // Collapse excessive blank lines.
    text = text.replace(/\n{3,}/g, "\n\n").trim();
    return text;
  };

  const formatParakeetToMarkdown = (parakeet) => {
    const p = parakeet && typeof parakeet === "object" ? parakeet : null;
    if (!p) return "";

    const stripLeadingListMarker = (value) => {
      let s = String(value || "").trim();
      if (!s) return "";
      // Remove repeated leading list markers that sometimes appear (e.g. "- - foo", "• foo").
      for (let i = 0; i < 3; i += 1) {
        const next = s.replace(/^\s*([•*\-–—]|\d+[.)])\s+/, "").trim();
        if (next === s) break;
        s = next;
      }
      // Also strip a stray leading quote before a list marker.
      s = s.replace(/^\s*["']\s*([•*\-–—]|\d+[.)])\s+/, "").trim();
      return s;
    };

    const wrapMongoTokensOutsideFences = (value) => {
      const src = String(value || "");
      if (!src.trim()) return "";
      const lines = src.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
      let inFence = false;
      const out = [];
      for (const line of lines) {
        const trimmed = line.trimStart();
        if (trimmed.startsWith("```")) {
          inFence = !inFence;
          out.push(line);
          continue;
        }
        if (inFence) {
          out.push(line);
          continue;
        }
        out.push(
          line.replace(/(^|[^`])(\$[a-zA-Z_]+)\b/g, (m, p1, token) => {
            return `${p1}\`${token}\``;
          })
        );
      }
      return out.join("\n");
    };

    const compactMarkdownListItems = (value) => {
      const src = String(value || "");
      if (!src.trim()) return "";

      const lines = src.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
      let inFence = false;
      let activeListIndent = null;
      const out = [];

      const isListStart = (line) =>
        /^(\s*)([-*+]|\d+\.)\s+/.test(String(line || ""));

      const isSingleTokenLine = (line) => {
        const t = String(line || "").trim();
        if (!t) return false;
        if (t.length > 80) return false;
        if (/\s/.test(t)) return false;
        return true;
      };

      for (const line of lines) {
        const trimmed = line.trimStart();
        if (trimmed.startsWith("```")) {
          inFence = !inFence;
          activeListIndent = null;
          out.push(line.trimEnd());
          continue;
        }

        if (inFence) {
          out.push(line);
          continue;
        }

        const listMatch = line.match(/^(\s*)([-*+]|\d+\.)\s+(.*)$/);
        if (listMatch) {
          activeListIndent = listMatch[1].length;
          out.push(line.trimEnd());
          continue;
        }

        if (activeListIndent !== null) {
          if (!line.trim()) {
            continue;
          }

          const leadingSpaces = (line.match(/^(\s*)/) || [""])[1].length;
          const continuation =
            leadingSpaces > activeListIndent ||
            isSingleTokenLine(line) ||
            (/^`[^`]+`$/.test(line.trim()) && line.trim().length <= 96);

          if (continuation && out.length) {
            out[out.length - 1] =
              `${out[out.length - 1].trimEnd()} ${line.trim()}`;
            continue;
          }

          activeListIndent = null;
        }

        out.push(line.trimEnd());
      }

      return out.join("\n");
    };

    const sanitizeInline = (value) => {
      let text = String(value || "");
      if (!text.trim()) return "";

      // Remove accidental markdown code fences inside bullet strings.
      text = text.replace(/```[a-z0-9_-]*\n?/gi, "");
      text = text.replace(/```/g, "");

      // Force bullets to be single-line.
      text = text.replace(/\r\n/g, "\n");
      text = text.replace(/\r/g, "\n");
      text = text.replace(/\n+/g, " ");

      // Wrap common MongoDB pipeline stages in inline code style.
      // This avoids them becoming big black blocks and makes them stand out.
      text = text.replace(/(^|\s)(\$[a-zA-Z_]+)\b/g, (m, p1, token) => {
        // If already wrapped with backticks nearby, leave it.
        if (m.includes("`")) return m;
        return `${p1}\`${token}\``;
      });

      // Remove spaces before punctuation introduced by newline collapsing.
      text = text.replace(/\s+([,.;:!?])/g, "$1");
      text = text.replace(/\(\s+/g, "(");
      text = text.replace(/\s+\)/g, ")");

      return text.replace(/\s{2,}/g, " ").trim();
    };

    const sanitizeParagraphs = (value) => {
      const raw = String(value || "");
      if (!raw.trim()) return "";

      // Keep markdown structure, but remove "blank-line per word" artifacts inside list items.
      let text = raw;
      text = formatAiAnswerText(text);
      text = compactMarkdownListItems(text);
      text = wrapMongoTokensOutsideFences(text);

      // Tighten whitespace without destroying paragraphs.
      text = text.replace(/\s+([,.;:!?])/g, "$1");
      text = text.replace(/\(\s+/g, "(");
      text = text.replace(/\s+\)/g, ")");
      text = text.replace(/\n{3,}/g, "\n\n");
      return text.trim();
    };

    const shortDefinition = String(p.short_definition || "").trim();
    const tlDr = String(p.tl_dr || "").trim();
    const explanation = String(
      p.explanation || p.detailed_explanation || ""
    ).trim();
    const bullets = Array.isArray(p.bullets)
      ? p.bullets
          .filter(Boolean)
          .map((v) => String(v).trim())
          .filter(Boolean)
      : Array.isArray(p.key_steps)
        ? p.key_steps
            .filter(Boolean)
            .map((v) => String(v).trim())
            .filter(Boolean)
        : [];

    const code = String(p?.code_example?.code || "").trim();
    const lang = String(p?.code_example?.language || "").trim() || "javascript";

    const parts = [];
    const answerText =
      shortDefinition && tlDr && shortDefinition !== tlDr
        ? `${shortDefinition} ${tlDr}`
        : shortDefinition || tlDr || String(p.star_answer || "").trim();
    const safeAnswer = sanitizeInline(answerText);
    if (safeAnswer) parts.push(safeAnswer);

    if (bullets.length) {
      for (const b of bullets.slice(0, 12)) {
        const safe = sanitizeInline(stripLeadingListMarker(b));
        if (safe) parts.push(`- ${safe}`);
      }
    }

    if (code) {
      parts.push("");
      parts.push("```" + lang);
      parts.push(code);
      parts.push("```");
    }

    if (explanation) {
      parts.push("");
      parts.push(sanitizeParagraphs(explanation));
    }

    return parts.join("\n").trim();
  };

  // Minimal rich-text renderer (no markdown libs):
  // - **bold** => bold
  // - `keyword` => colored + bold
  const renderInlineRich = (value) => {
    const src = String(value || "");
    if (!src) return null;

    const nodes = [];
    let i = 0;
    let key = 0;

    const pushText = (t) => {
      if (!t) return;
      nodes.push(<React.Fragment key={`t-${key++}`}>{t}</React.Fragment>);
    };

    while (i < src.length) {
      const nextBacktick = src.indexOf("`", i);
      const nextBold = src.indexOf("**", i);

      let nextIdx = -1;
      let kind = "";
      if (nextBacktick >= 0 && nextBold >= 0) {
        nextIdx = Math.min(nextBacktick, nextBold);
        kind = nextIdx === nextBacktick ? "code" : "bold";
      } else if (nextBacktick >= 0) {
        nextIdx = nextBacktick;
        kind = "code";
      } else if (nextBold >= 0) {
        nextIdx = nextBold;
        kind = "bold";
      } else {
        pushText(src.slice(i));
        break;
      }

      if (nextIdx > i) pushText(src.slice(i, nextIdx));

      if (kind === "code") {
        const end = src.indexOf("`", nextIdx + 1);
        if (end < 0) {
          pushText(src.slice(nextIdx));
          break;
        }
        const inner = src.slice(nextIdx + 1, end);
        nodes.push(
          <span
            key={`c-${key++}`}
            className="font-semibold text-primary-700 dark:text-primary-300"
          >
            {inner}
          </span>
        );
        i = end + 1;
        continue;
      }

      // kind === "bold"
      const end = src.indexOf("**", nextIdx + 2);
      if (end < 0) {
        pushText(src.slice(nextIdx));
        break;
      }
      const inner = src.slice(nextIdx + 2, end);
      nodes.push(
        <span key={`b-${key++}`} className="font-semibold">
          {inner}
        </span>
      );
      i = end + 2;
    }

    return nodes;
  };

  const renderMultilineRich = (value) => {
    const text = String(value || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    if (!text.trim()) return null;
    const lines = text.split("\n");
    return (
      <div>
        {lines.map((line, idx) => {
          if (!String(line).trim()) {
            return <div key={`br-${idx}`} className="h-2" />;
          }
          return (
            <div key={`ln-${idx}`} className="leading-relaxed whitespace-pre-wrap">
              {renderInlineRich(line)}
            </div>
          );
        })}
      </div>
    );
  };

  // Minimal JS syntax highlighting (no libs) for code blocks.
  const renderHighlightedCode = (value) => {
    const src = String(value || "");
    if (!src) return null;

    const jsKeywords = new Set([
      "var",
      "let",
      "const",
      "function",
      "return",
      "if",
      "else",
      "for",
      "while",
      "do",
      "switch",
      "case",
      "break",
      "continue",
      "try",
      "catch",
      "finally",
      "throw",
      "new",
      "class",
      "extends",
      "super",
      "import",
      "from",
      "export",
      "default",
      "await",
      "async",
      "typeof",
      "instanceof",
      "in",
    ]);

    const literals = new Set(["true", "false", "null", "undefined"]);
    const isIdentStart = (ch) => /[A-Za-z_$]/.test(ch);
    const isIdent = (ch) => /[A-Za-z0-9_$]/.test(ch);
    const isDigit = (ch) => /[0-9]/.test(ch);

    const nodes = [];
    let i = 0;
    let key = 0;

    const pushSpan = (cls, text) => {
      if (!text) return;
      nodes.push(
        <span key={`tok-${key++}`} className={cls}>
          {text}
        </span>
      );
    };

    while (i < src.length) {
      const ch = src[i];
      const next = src[i + 1];

      // Line comment
      if (ch === "/" && next === "/") {
        let j = i + 2;
        while (j < src.length && src[j] !== "\n") j += 1;
        pushSpan("text-green-700 dark:text-green-400", src.slice(i, j));
        i = j;
        continue;
      }

      // Block comment
      if (ch === "/" && next === "*") {
        let j = i + 2;
        while (j < src.length - 1 && !(src[j] === "*" && src[j + 1] === "/"))
          j += 1;
        j = Math.min(src.length, j + 2);
        pushSpan("text-green-700 dark:text-green-400", src.slice(i, j));
        i = j;
        continue;
      }

      // Strings: ', ", `
      if (ch === "'" || ch === '"' || ch === "`") {
        const quote = ch;
        let j = i + 1;
        while (j < src.length) {
          const cj = src[j];
          if (cj === "\\") {
            j += 2;
            continue;
          }
          if (cj === quote) {
            j += 1;
            break;
          }
          if (quote !== "`" && cj === "\n") break;
          j += 1;
        }
        pushSpan("text-amber-700 dark:text-amber-300", src.slice(i, j));
        i = j;
        continue;
      }

      // Numbers
      if (isDigit(ch)) {
        let j = i + 1;
        while (j < src.length && /[0-9._]/.test(src[j])) j += 1;
        pushSpan("text-purple-700 dark:text-purple-300", src.slice(i, j));
        i = j;
        continue;
      }

      // Identifiers
      if (isIdentStart(ch)) {
        let j = i + 1;
        while (j < src.length && isIdent(src[j])) j += 1;
        const ident = src.slice(i, j);
        const lower = ident.toLowerCase();

        if (ident.startsWith("$")) {
          pushSpan("font-semibold text-primary-700 dark:text-primary-300", ident);
        } else if (jsKeywords.has(lower)) {
          pushSpan("font-semibold text-blue-700 dark:text-blue-300", ident);
        } else if (literals.has(lower)) {
          pushSpan("font-semibold text-purple-700 dark:text-purple-300", ident);
        } else {
          nodes.push(<React.Fragment key={`raw-${key++}`}>{ident}</React.Fragment>);
        }

        i = j;
        continue;
      }

      nodes.push(<React.Fragment key={`ch-${key++}`}>{ch}</React.Fragment>);
      i += 1;
    }

    return nodes;
  };

  const normalizeInlineStageBlocks = (markdown) => {
    let text = String(markdown || "");
    if (!text.trim()) return "";

    const stageNames = new Set([
      "match",
      "group",
      "project",
      "sort",
      "lookup",
      "unwind",
      "addfields",
      "set",
      "unset",
      "facet",
      "limit",
      "skip",
      "count",
      "replaceRoot".toLowerCase(),
      "replaceWith".toLowerCase(),
      "geoNear".toLowerCase(),
      "sample",
    ]);

    const isSingleToken = (value) => {
      const v = String(value || "").trim();
      if (!v) return false;
      if (v.length > 48) return false;
      if (/[\s\n\r\t]/.test(v)) return false;
      return true;
    };

    const canonicalStageToken = (token) => {
      const t = String(token || "").trim();
      if (!t) return "";
      if (t.startsWith("$")) return t;
      const lower = t.toLowerCase();
      if (stageNames.has(lower)) return `$${lower}`;
      return t;
    };

    // Convert tiny fenced blocks like ```match``` or ```$match``` into inline code.
    text = text.replace(
      /```[a-z0-9_-]*\s*\n([\s\S]*?)\n```/gi,
      (all, inner) => {
        const rawInner = String(inner || "").trim();
        if (!isSingleToken(rawInner)) return all;
        const canonical = canonicalStageToken(rawInner);
        const isStageLike =
          /^\$[a-zA-Z_]+$/.test(canonical) ||
          stageNames.has(canonical.replace(/^\$/g, "").toLowerCase());
        if (!isStageLike) return all;
        return `\`${canonical}\``;
      }
    );

    text = text.replace(/\r\n/g, "\n");
    text = text.replace(/\r/g, "\n");
    text = text.replace(/\n{3,}/g, "\n\n");

    const rawParas = text
      .split(/\n{2,}/g)
      .map((p) => String(p || "").trim())
      .filter(Boolean);

    // Merge "floating" tokens like `match` or punctuation-only lines back into the previous paragraph.
    const merged = [];
    for (const para of rawParas) {
      if (!merged.length) {
        merged.push(para);
        continue;
      }

      const isJustInlineToken = /^`[^`]+`$/.test(para);
      const isJustPunctuation = /^[,.;:!?]$/.test(para);
      const isConjunction =
        /^(,\s*)?(and|or)\b/i.test(para) && para.length <= 16;
      const isConjunctionPlusToken = /^(,\s*)?(and|or)\s+`[^`]+`$/i.test(para);

      if (
        isJustInlineToken ||
        isJustPunctuation ||
        isConjunction ||
        isConjunctionPlusToken
      ) {
        merged[merged.length - 1] = `${merged[merged.length - 1]} ${para}`
          .replace(/\s+([,.;:!?])/g, "$1")
          .replace(/\(\s+/g, "(")
          .replace(/\s+\)/g, ")")
          .replace(/\s{2,}/g, " ")
          .trim();
      } else {
        merged.push(para);
      }
    }

    // Collapse single newlines inside normal paragraphs (but keep lists/code intact).
    const normalizedParas = merged.map((para) => {
      if (para.includes("```")) return para;
      if (/(^|\n)\s*(-\s+|\d+\.\s+)/.test(para)) return para;
      if (/^\s{4,}\S/m.test(para)) return para;
      return String(para)
        .replace(/\n+/g, " ")
        .replace(/\s+([,.;:!?])/g, "$1")
        .replace(/\(\s+/g, "(")
        .replace(/\s+\)/g, ")")
        .replace(/\s{2,}/g, " ")
        .trim();
    });

    return normalizedParas.join("\n\n").trim();
  };

  const pushTranscript = (text, source = "mic", options = {}) => {
    if (hideExtras) return;
    const trimmed = String(text || "").trim();
    if (!trimmed) return;
    const {
      broadcast = false,
      isFinal = true,
      ts = Date.now(),
    } = options || {};

    setTranscriptItems((prev) => [
      ...prev,
      {
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        text: trimmed,
        source,
        ts: new Date().toISOString(),
      },
    ]);

    if (broadcast && socket && id) {
      try {
        socket.emit("transcript_append", {
          sessionId: id,
          text: trimmed,
          source,
          isFinal,
          ts,
        });
      } catch {
        // ignore
      }
    }
  };

  // ElevenLabs client-side realtime (lowest latency): uses single-use token from backend.
  // We keep it inert unless the user selects sttProvider=elevenlabs_client.
  const scribe = useScribe({
    modelId: "scribe_v2_realtime",
    languageCode: elevenLanguageCode || "en",
    onConnect: () => {
      try {
        setElevenClientConnected(true);
        // Reset fallback trigger when a new connection is established.
        elevenClientFallbackTriggeredRef.current = false;
      } catch {
        // ignore
      }
    },
    onDisconnect: (info) => {
      try {
        setElevenClientConnected(false);
        const suppressUntil = Number(
          elevenClientIgnoreDisconnectUntilRef.current || 0
        );
        if (suppressUntil && Date.now() < suppressUntil) return;
        const reason =
          info?.reason || info?.message || info?.code || "disconnected";
        fallbackFromElevenLabsClientRealtime({ reason, err: info });
      } catch {
        // ignore
      }
    },
    onPartialTranscript: (data) => {
      try {
        if (!shouldKeepListeningRef.current) return;
        if (!isRecordingRef.current) return;
        const ignoreUntil = Number(ignoreRealtimeUntilRef.current || 0);
        if (ignoreUntil && Date.now() < ignoreUntil) return;
        if (
          String(sttProviderRef.current || "").toLowerCase() !==
          "elevenlabs_client"
        ) {
          return;
        }

        const partial = String(data?.text || "").trim();
        if (!partial) return;
        lastLocalSpeechUpdateAtRef.current = Date.now();
        const composed =
          `${speechBaseTextRef.current}${elevenClientBaseRef.current}${partial}`
            .replace(/\s+/g, " ")
            .trimStart();
        setListeningText(composed);
      } catch {
        // ignore
      }
    },
    onCommittedTranscript: (data) => {
      try {
        if (!shouldKeepListeningRef.current) return;
        if (!isRecordingRef.current) return;
        const ignoreUntil = Number(ignoreRealtimeUntilRef.current || 0);
        if (ignoreUntil && Date.now() < ignoreUntil) return;
        if (
          String(sttProviderRef.current || "").toLowerCase() !==
          "elevenlabs_client"
        ) {
          return;
        }

        const text = String(data?.text || "").trim();
        if (!text) return;
        lastLocalSpeechUpdateAtRef.current = Date.now();

        elevenClientBaseRef.current =
          `${elevenClientBaseRef.current}${text} `.replace(/\s+/g, " ");

        // Update Listening with committed base.
        setListeningText(
          `${speechBaseTextRef.current}${elevenClientBaseRef.current}`
            .replace(/\s+/g, " ")
            .trimStart()
        );

        // Classic mode transcript list + cross-device mirror.
        pushTranscript(text, "mic", { broadcast: true, isFinal: true });
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
        fallbackFromElevenLabsClientRealtime({ reason, err });
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
        fallbackFromElevenLabsClientRealtime({ reason, err });
      } catch {
        // ignore
      }
    },
  });

  useEffect(() => {
    scribeRef.current = scribe;
  }, [scribe]);

  // Cross-device sync: when WebSpeech is used, broadcast *final* transcript deltas.
  useEffect(() => {
    if (!hideExtras) return;
    if (!shouldKeepListeningRef.current) return;
    if (!isRecordingRef.current) return;
    if (!srCanUse) return;

    const full = String(srFinal || "");
    if (!full.trim()) return;

    const prev = String(lastSrFinalCommittedRef.current || "");
    let delta = "";
    if (full.startsWith(prev)) delta = full.slice(prev.length);
    else delta = full;

    lastSrFinalCommittedRef.current = full;

    const trimmed = String(delta || "").trim();
    if (!trimmed) return;
    pushTranscript(trimmed, "mic", { broadcast: true });
  }, [srFinal, hideExtras, srCanUse]);

  // Fetch session details
  const { data: session, isLoading } = useQuery({
    queryKey: ["session", id],
    queryFn: async () => (await api.get(`/sessions/${id}`)).data,
    enabled: !!id,
    refetchInterval: (data) =>
      String(data?.status || "").toLowerCase() === "active" ? 10000 : false,
  });

  useEffect(() => {
    const p = String(session?.settings?.sttProvider || defaultSttProvider)
      .trim()
      .toLowerCase();
    sttProviderRef.current = p || defaultSttProvider;

    // If user switches away from ElevenLabs client, treat it as disconnected for UI.
    if (sttProviderRef.current !== "elevenlabs_client") {
      try {
        setElevenClientConnected(false);
      } catch {
        // ignore
      }
    }

    try {
      writePersistedStt({
        sttProvider: sttProviderRef.current,
        sttModel: String(session?.settings?.sttModel || defaultSttModel),
      });
    } catch {
      // ignore
    }

    const canUseWebSpeech = srCanUse && srMicAvailable !== false;
    if (sttProviderRef.current === "webspeech" && canUseWebSpeech) {
      serverSttDisabledRef.current = true;
      try {
        if (continuousWhisperIntervalRef.current) {
          clearInterval(continuousWhisperIntervalRef.current);
        }
      } catch {
        // noop
      }
      continuousWhisperIntervalRef.current = null;
      continuousWhisperInFlightRef.current = false;
    } else {
      serverSttDisabledRef.current = false;
    }
  }, [session?.settings?.sttProvider, srCanUse, srMicAvailable]);

  // Fetch messages
  const { data: messagesData } = useQuery({
    queryKey: ["messages", id],
    queryFn: async () => (await api.get(`/sessions/${id}/messages`)).data,
    enabled: !!id,
  });

  // Co-pilot: ensure SR is started on the first user gesture.
  // Newer Chrome/Windows builds may silently block SR start until a gesture.
  useEffect(() => {
    if (!hideExtras) return;
    if (session?.status !== "active") return;
    if (!isRecording) return;
    if (speechRecognitionRef.current) return;
    if (speechRecognitionDisabledRef.current) return;

    if (!srCanUse) return;

    const onGesture = async () => {
      try {
        await startWebSpeechRecognition({ force: true });
      } catch {
        // ignore
      }
    };

    window.addEventListener("pointerdown", onGesture, { once: true });
    window.addEventListener("keydown", onGesture, { once: true });
    return () => {
      window.removeEventListener("pointerdown", onGesture);
      window.removeEventListener("keydown", onGesture);
    };
  }, [hideExtras, session?.status, isRecording, srCanUse]);

  // Send message mutation
  const sendMessageMutation = useMutation({
    mutationFn: async (content) => {
      const response = await api.post(`/sessions/${id}/messages`, { content });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries(["messages", id]);
      setMessage("");
    },
    onError: (error) => {
      toast.error(error.response?.data?.message || "Failed to send message");
    },
  });

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
      if (
        String(endSessionReasonRef.current || "").toLowerCase() === "manual"
      ) {
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

  // AI response mutation
  const getAIResponseMutation = useMutation({
    mutationFn: async (lastMessage) => {
      const response = await api.post(`/sessions/${id}/ai-response`, {
        lastMessage,
      });
      return response.data;
    },
    onSuccess: () => {
      setIsTyping(false);
      queryClient.invalidateQueries(["messages", id]);
    },
    onError: () => {
      setIsTyping(false);
      toast.error("Failed to get AI response");
    },
  });

  // Socket event listeners
  useEffect(() => {
    if (!socket || !id) return;

    socket.emit("join_session", id);

    socket.on("new_message", () => {
      queryClient.invalidateQueries(["messages", id]);
    });

    socket.on("typing_start", () => {
      setIsTyping(true);
    });

    socket.on("typing_end", () => {
      setIsTyping(false);
    });

    socket.on("session_updated", (payload) => {
      const sessionId = String(payload?.sessionId || "");
      if (!sessionId || sessionId !== String(id)) return;
      queryClient.invalidateQueries(["session", id]);
    });

    if (!hideExtras) {
      socket.on("transcript_append", (payload) => {
        const sessionId = String(payload?.sessionId || "");
        if (!sessionId || sessionId !== String(id)) return;
        const text = String(payload?.text || "").trim();
        if (!text) return;
        const source = String(payload?.source || "mic");
        pushTranscript(text, source, {
          broadcast: false,
          isFinal: Boolean(payload?.isFinal),
          ts: Number.isFinite(Number(payload?.ts))
            ? Number(payload.ts)
            : Date.now(),
        });
      });
    }

    return () => {
      socket.off("new_message");
      socket.off("typing_start");
      socket.off("typing_end");
      socket.off("session_updated");
      socket.off("transcript_append");
    };
  }, [socket, id, queryClient, hideExtras]);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messagesData?.messages]);

  useEffect(() => {
    if (hideExtras) return;
    if (!transcriptAutoScroll) return;
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcriptItems, transcriptAutoScroll, hideExtras]);

  // Stop any ongoing speech/recording on unmount
  useEffect(() => {
    const sharedVideoEl = sharedVideoRef.current;
    return () => {
      try {
        stopSpeechRecognition();
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
      stopAndCleanupMedia();

      try {
        const stream = sharedVideoEl?.srcObject;
        if (stream?.getTracks) {
          stream.getTracks().forEach((t) => t.stop());
        }
      } catch {
        // noop
      }
      try {
        if (sharedVideoEl) {
          sharedVideoEl.srcObject = null;
        }
      } catch {
        // noop
      }
    };
  }, []);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Reset one-time guards when session id changes
  useEffect(() => {
    startSessionRequestedRef.current = false;
    autoStartListeningRef.current = false;
    speechRecognitionDisabledRef.current = false;
    speechRecognitionErrorNotifiedRef.current = false;
    speechRecognitionBlockedRef.current = false;
    connectDismissedRef.current = false;
    setConnectOpen(false);

    micPermissionDialogShownRef.current = false;
    setMicPermissionDialog({ open: false, message: "" });
  }, [id]);

  // Co-pilot: if SR is blocked until a gesture, retry on first user interaction.
  useEffect(() => {
    if (!hideExtras) return;
    if (session?.status !== "active") return;
    if (!isRecording) return;
    if (!srBlocked) return;
    if (speechRecognitionRef.current) return;

    const onGesture = async () => {
      try {
        await startWebSpeechRecognition({ force: true });
      } catch {
        // ignore
      }

      if (!speechRecognitionBlockedRef.current) {
        window.removeEventListener("pointerdown", onGesture);
        window.removeEventListener("keydown", onGesture);
      }
    };

    window.addEventListener("pointerdown", onGesture, { once: true });
    window.addEventListener("keydown", onGesture, { once: true });
    return () => {
      window.removeEventListener("pointerdown", onGesture);
      window.removeEventListener("keydown", onGesture);
    };
  }, [hideExtras, session?.status, isRecording, srBlocked]);

  // Start session on mount if not started
  useEffect(() => {
    if (session?.status !== "created") return;
    if (hideExtras) {
      if (startSessionMutation.isPending) return;
      if (startSessionRequestedRef.current) return;
      if (!connectDismissedRef.current) setConnectOpen(true);
      return;
    }

    if (startSessionRequestedRef.current) return;
    if (startSessionMutation.isPending) return;

    startSessionRequestedRef.current = true;
    startSessionMutation.mutate({});
  }, [session?.status, startSessionMutation]);

  // Co-pilot: closing Settings/Connect modal can interrupt WebSpeech.
  useEffect(() => {
    if (!hideExtras) return;
    const prev = !!prevConnectOpenRef.current;
    const next = !!connectOpen;
    prevConnectOpenRef.current = next;

    if (prev && !next) {
      scheduleWebSpeechRecovery("settings_close");
      startBackgroundServerSttLoop();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hideExtras, connectOpen]);

  // Co-pilot UX: request mic permission + start listening automatically.
  useEffect(() => {
    if (!hideExtras) return;
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
              handleStartRecording();
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
              setListeningText((prev) => prev || "Microphone permission denied.");
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
  }, [hideExtras, session?._id, session?.status]);

  // Stop mic when session ends.
  useEffect(() => {
    if (!hideExtras) return;
    if (!session?._id) return;
    if (session?.status === "active") return;
    if (!isRecordingRef.current) return;
    handleStopRecording();
  }, [hideExtras, session?._id, session?.status]);

  const sendAndTriggerAI = async (content) => {
    const trimmed = String(content || "").trim();
    if (!trimmed) return;
    if (sendMessageMutation.isLoading || getAIResponseMutation.isLoading)
      return;

    try {
      // In simplified co-pilot mode, don't auto-generate follow-up questions.
      if (hideExtras) {
        await sendMessageMutation.mutateAsync(trimmed);
        return;
      }

      setIsTyping(true);
      await sendMessageMutation.mutateAsync(trimmed);
      await getAIResponseMutation.mutateAsync(trimmed);
    } catch {
      setIsTyping(false);
    }
  };

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
    const fallback = String(hideExtras ? listeningText : message || "").trim();
    // Keep it readable; long transcripts hurt both UI and the model.
    const value = (joined || fallback).slice(0, 500).trim();
    return normalizeTechTerms(value);
  };

  const copyToClipboard = async (text, label) => {
    const value = String(text || "").trim();
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`${label} copied`);
    } catch {
      toast.error("Copy failed");
    }
  };

  const handleGenerateAIAnswer = async () => {
    if (isGeneratingAnswer) return;
    setIsGeneratingAnswer(true);

    const wasRecording = !!isRecordingRef.current;
    try {
      // If the browser blocked auto-start, try again on user gesture.
      if (hideExtras && !isRecordingRef.current) {
        shouldKeepListeningRef.current = true;
        await handleStartRecording({ fromUserGesture: true });
      }

      if (hideExtras) {
        // Keep MediaRecorder running, but pause SR while we clear/capture.
        try {
          stopSpeechRecognition();
        } catch {
          // noop
        }
      }

      const draftText = hideExtras ? listeningText : message;

      // In co-pilot mode, prefer server STT (Whisper) using the last few seconds
      // of recorded audio. This is usually more accurate than browser SR.
      let question = getCapturedQuestion();
      const rawAsrVerbatim = String(question || "");

      if (hideExtras) {
        // Single Q/A only: clear old Question/Answer + Listening immediately on tap.
        bumpListeningEpoch();
        setCapturedQuestion("");
        aiAnswerRawRef.current = "";
        setAiAnswer("");
        setParakeetAnswer(null);
        setParakeetCleaned("");
        forceEmptySeedOnNextSrStartRef.current = true;
        speechBaseTextRef.current = "";
        listeningTextRef.current = "";
        assemblyRtBaseRef.current = "";
        elevenClientBaseRef.current = "";
        lastSrFinalCommittedRef.current = "";
        ignoreRealtimeUntilRef.current = Date.now() + 1200;
        try {
          scribeRef.current?.clearTranscripts?.();
        } catch {
          // ignore
        }
        srTextAtClearRef.current = normalizeSpeechText(
          `${String(srFinal || "")} ${String(srInterim || "")}`
        );
        srStripPrefixRef.current = srTextAtClearRef.current;
        srStripPrefixUntilRef.current = Date.now() + 15_000;
        srIgnoreUpdatesUntilRef.current = Date.now() + 1200;
        srIgnoreUntilDifferentRef.current = Date.now() + 7000;
        setListeningText("");
        setTranscriptItems([]);
      }

      if (hideExtras) {
        // If AssemblyAI realtime is active, we already have fast transcripts.
        if (
          sttProviderRef.current !== "webspeech" &&
          sttProviderRef.current !== "assemblyai"
        ) {
          try {
            const refined = await transcribeBufferedAudioForQuestion();
            if (refined) {
              question = refined;
              pushTranscript(refined, "mic", { broadcast: true });
              // Reset ring buffer so old audio doesn't pollute the next question.
              audioRingRef.current = [];
              lastServerSttTextRef.current = "";
            }
          } catch (err) {
            // If server STT isn't configured, quietly fall back to browser SR.
            if (err?.response?.status === 501) {
              // no toast spam
            }
          }
        }
      }
      if (!question) {
        toast.error(
          "No question captured yet. Use Listen and repeat the question."
        );
        return;
      }

      if (hideExtras) {
        setCapturedQuestion(question);

        // Start fresh for the next question: avoid appending old SR text.
        forceEmptySeedOnNextSrStartRef.current = true;
        speechBaseTextRef.current = "";
        listeningTextRef.current = "";
        assemblyRtBaseRef.current = "";
        elevenClientBaseRef.current = "";
        lastSrFinalCommittedRef.current = "";
        ignoreRealtimeUntilRef.current = Date.now() + 1200;
        try {
          scribeRef.current?.clearTranscripts?.();
        } catch {
          // ignore
        }
        srTextAtClearRef.current = normalizeSpeechText(
          `${String(srFinal || "")} ${String(srInterim || "")}`
        );
        srStripPrefixRef.current = srTextAtClearRef.current;
        srStripPrefixUntilRef.current = Date.now() + 15_000;
        srIgnoreUpdatesUntilRef.current = Date.now() + 1200;
        srIgnoreUntilDifferentRef.current = Date.now() + 7000;
        try {
          srReset();
        } catch {
          // noop
        }
        setListeningText("");
        setTranscriptItems([]);
        audioRingRef.current = [];
        lastServerSttTextRef.current = "";
        continuousPrefixRef.current = "";
      }

      // Clear previous answer so streaming doesn't append visually.
      aiAnswerRawRef.current = "";
      setAiAnswer("");
      setParakeetAnswer(null);
      setParakeetCleaned("");

      // Direct Groq (no backend) for OSS models when API key is present.
      // Note: this exposes the API key to the browser environment.
      const selectedModel = String(session?.settings?.aiModel || "").trim();
      const groqKey = String(import.meta.env.VITE_GROQ_API_KEY || "").trim();
      const isGroqOssModel =
        selectedModel === "openai/gpt-oss-120b" ||
        selectedModel === "openai/gpt-oss-20b";

      if (groqKey && isGroqOssModel) {
        try {
          let lastUiUpdateAt = 0;
          const resp = await requestGroqDirectParakeet({
            question,
            model: selectedModel,
            apiKey: groqKey,
            onToken: (_tok, full) => {
              // Keep UI responsive on mobile.
              const now = Date.now();
              if (now - lastUiUpdateAt < 60) return;
              lastUiUpdateAt = now;
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
            inputRef.current?.focus?.();
            return;
          }

          throw new Error("Invalid Groq response");
        } catch (e) {
          // If direct Groq fails (CORS/quota/etc), fall back to backend flow.
          // eslint-disable-next-line no-unused-vars
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
          inputRef.current?.focus?.();
          return;
        }
        throw new Error("Invalid Parakeet response");
      } catch (parakeetErr) {
        // Fallback to existing streaming Markdown endpoint.
        // eslint-disable-next-line no-unused-vars
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
            body: JSON.stringify({ question, draft: draftText }),
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

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
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
                if (now - lastUiUpdateAt > 60) {
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
          // eslint-disable-next-line no-unused-vars
          const _ = streamErr;
        }
      }

      inputRef.current?.focus?.();
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

      // Resume live Listening after AI Answer.
      if (hideExtras && wasRecording && shouldKeepListeningRef.current) {
        try {
          forceEmptySeedOnNextSrStartRef.current = true;
          speechBaseTextRef.current = "";
          listeningTextRef.current = "";
          const canUseWebSpeech = srCanUse && srMicAvailable !== false;
          const effectiveProvider = getEffectiveSttProvider({
            canUseWebSpeech,
          });

          // If ElevenLabs client is active, do not start WebSpeech.
          // ElevenLabs will continue driving Listening.
          if (effectiveProvider !== "elevenlabs_client") {
            void startWebSpeechRecognition({ force: true });
            scheduleWebSpeechRecovery("ai_answer");
            startBackgroundServerSttLoop();
          }
        } catch {
          // ignore
        }
      }
    }
  };

  const handleRegenerateParakeet = async () => {
    if (isGeneratingAnswer) return;
    if (!id) return;
    if (!parakeetAnswer) return;
    const cleaned = String(parakeetCleaned || "").trim();
    if (!cleaned) return;

    setIsGeneratingAnswer(true);
    try {
      const selectedModel = String(session?.settings?.aiModel || "").trim();
      const groqKey = String(import.meta.env.VITE_GROQ_API_KEY || "").trim();
      const isGroqOssModel =
        selectedModel === "openai/gpt-oss-120b" ||
        selectedModel === "openai/gpt-oss-20b";

      if (groqKey && isGroqOssModel) {
        const resp = await requestGroqDirectParakeet({
          question: cleaned,
          model: selectedModel,
          apiKey: groqKey,
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
          setParakeetCleaned(String(resp?.cleaned || cleaned).trim());
          setParakeetAnswer(pk);
          return;
        }
        throw new Error("Invalid Groq response");
      }

      const resp = await requestParakeetAiAnswer({
        sessionId: id,
        cleaned,
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
        setParakeetCleaned(String(resp?.cleaned || cleaned).trim());
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
    }
  };

  const handleClearCapture = () => {
    // Co-pilot UX: Clear should only reset captured question/transcription.
    // It should NOT stop listening.
    if (hideExtras) {
      const prevListening = normalizeSpeechText(listeningTextRef.current || "");
      const prevSrCombined = normalizeSpeechText(
        `${String(srFinal || "")} ${String(srInterim || "")}`
      );

      bumpListeningEpoch();
      forceEmptySeedOnNextSrStartRef.current = true;
      speechBaseTextRef.current = "";
      listeningTextRef.current = "";
      assemblyRtBaseRef.current = "";
      elevenClientBaseRef.current = "";
      lastSrFinalCommittedRef.current = "";
      ignoreRealtimeUntilRef.current = Date.now() + 1200;

      // Drop any queued MediaRecorder chunk that may still contain pre-clear audio.
      audioRingIgnoreUntilRef.current = Date.now() + 1500;
      audioRingRef.current = [];
      audioHeaderChunkRef.current = null;
      try {
        scribeRef.current?.clearTranscripts?.();
      } catch {
        // ignore
      }
      srTextAtClearRef.current = prevSrCombined;
      srStripPrefixRef.current = prevListening || prevSrCombined;
      srStripPrefixUntilRef.current = Date.now() + 15_000;
      srIgnoreUpdatesUntilRef.current = Date.now() + 1200;
      srIgnoreUntilDifferentRef.current = Date.now() + 7000;
      try {
        SpeechRecognition.abortListening?.();
      } catch {
        // noop
      }
      try {
        srReset();
      } catch {
        // noop
      }
      setTranscriptItems([]);
      setMessage("");
      setListeningText("");
      setCapturedQuestion("");
      aiAnswerRawRef.current = "";
      setAiAnswer("");
      audioRingRef.current = [];
      lastServerSttTextRef.current = "";
      continuousPrefixRef.current = "";
      inputRef.current?.focus?.();

      // After clearing, SR can remain stopped. Restart for reliability.
      if (isRecordingRef.current && shouldKeepListeningRef.current) {
        try {
          const canUseWebSpeech = srCanUse && srMicAvailable !== false;
          const effectiveProvider = getEffectiveSttProvider({
            canUseWebSpeech,
          });

          if (effectiveProvider === "elevenlabs_client") {
            // If ElevenLabs realtime is already connected, do NOT force a reconnect
            // on Clear. Reconnecting briefly flips the status to Disconnected and
            // can disturb the live pipeline on some browsers.
            if (elevenClientConnected && scribeRef.current) {
              elevenClientBaseRef.current = "";
              ignoreRealtimeUntilRef.current = Date.now() + 800;
              return;
            }
            if (elevenClientConnectInFlightRef.current) return;
            elevenClientConnectInFlightRef.current = true;
            // Suppress fallback/toasts while we intentionally reconnect.
            elevenClientIgnoreDisconnectUntilRef.current = Date.now() + 4000;
            ignoreRealtimeUntilRef.current = Date.now() + 2000;
            elevenClientBaseRef.current = "";

            void (async () => {
              try {
                await reconnectElevenLabsClientRealtime({
                  api,
                  scribeRef,
                  elevenLanguageCode,
                  onBeforeReconnect: () => {
                    try {
                      stopElevenLabsClientRealtime();
                    } catch {
                      // ignore
                    }
                  },
                });
              } catch (e) {
                const reason =
                  e?.response?.data?.message ||
                  e?.message ||
                  "ElevenLabs realtime reconnect failed.";
                fallbackFromElevenLabsClientRealtime({ reason });
              } finally {
                elevenClientConnectInFlightRef.current = false;
              }
            })();
            return;
          }

          void startWebSpeechRecognition({ force: true });
          scheduleWebSpeechRecovery("clear");
          startBackgroundServerSttLoop();
        } catch {
          // ignore
        }
      }
      return;
    }

    try {
      stopSpeechRecognition();
    } catch {
      // noop
    }
    try {
      stopAndCleanupMedia();
    } catch {
      // noop
    }
    setIsRecording(false);
    speechBaseTextRef.current = "";
    setTranscriptItems([]);
    setMessage("");
    try {
      window.speechSynthesis?.cancel?.();
    } catch {
      // noop
    }
    inputRef.current?.focus?.();
  };

  const stopScreenShare = () => {
    try {
      const stream = sharedVideoRef.current?.srcObject;
      if (stream?.getTracks) {
        stream.getTracks().forEach((t) => t.stop());
      }
    } catch {
      // noop
    }
    try {
      if (sharedVideoRef.current) {
        sharedVideoRef.current.srcObject = null;
      }
    } catch {
      // noop
    }
    setIsSharing(false);
  };

  const stopBackgroundServerSttLoop = () => {
    stopBackgroundServerSttLoopImpl({
      continuousWhisperIntervalRef,
      continuousWhisperInFlightRef,
    });
  };

  const startBackgroundServerSttLoop = () => {
    startBackgroundServerSttLoopImpl({
      hideExtras,
      isRecordingRef,
      shouldKeepListeningRef,
      serverSttDisabledRef,
      continuousWhisperIntervalRef,
      continuousWhisperInFlightRef,
      lastLocalSpeechUpdateAtRef,
      listeningTextRef,
      serverSttBackoffUntilRef,
      lastServerSttCallAtRef,
      lastServerSttTextRef,
      listeningEpochRef,
      serverSttUnreachableNotifiedRef,
      serverSttConfigErrorNotifiedRef,
      isWebSpeechLikelyStalled,
      isWebSpeechLiveUsable,
      enableBackgroundServerStt,
      sttProviderRef,
      enableAssemblyAiBackup,
      assemblyRtActiveRef,
      getLastRingBlob,
      getBufferedAudioBlob,
      transcribeAudioBlob,
      getSttPromptText,
      setListeningText,
      toast,
    });
  };

  // Co-pilot: periodically check if WebSpeech is stalled and start background
  // server STT as a fallback (helps Android Chrome where SR can be flaky).
  useEffect(() => {
    if (!hideExtras) return;
    if (!isRecording) return;
    if (!enableBackgroundServerStt) return;

    const id = setInterval(() => {
      try {
        startBackgroundServerSttLoop();
      } catch {
        // ignore
      }
    }, 2000);

    return () => {
      try {
        clearInterval(id);
      } catch {
        // ignore
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hideExtras, isRecording, enableBackgroundServerStt]);

  // Cleanup on unmount / route change to avoid stale mic/SR state on back/refresh.
  useEffect(() => {
    return () => {
      try {
        shouldKeepListeningRef.current = false;
      } catch {
        // noop
      }
      try {
        stopSpeechRecognition();
      } catch {
        // noop
      }
      try {
        stopAssemblyAiRealtime();
      } catch {
        // noop
      }
      try {
        stopBackgroundServerSttLoop();
      } catch {
        // noop
      }
      try {
        void stopAndCleanupMedia();
      } catch {
        // noop
      }
      try {
        setRecordingState(false);
      } catch {
        // noop
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const startScreenShare = async () => {
    if (!navigator.mediaDevices?.getDisplayMedia) {
      toast.error("Screen sharing isn’t supported in this browser.");
      return;
    }

    try {
      stopScreenShare();
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: false,
      });
      const videoTrack = stream.getVideoTracks?.()?.[0];
      if (videoTrack) {
        videoTrack.addEventListener("ended", () => {
          stopScreenShare();
        });
      }

      if (sharedVideoRef.current) {
        sharedVideoRef.current.srcObject = stream;
        try {
          await sharedVideoRef.current.play();
        } catch {
          // ignore autoplay restrictions
        }
      }
      setIsSharing(true);
    } catch (err) {
      const name = err?.name;
      if (name === "NotAllowedError")
        toast.error("Screen share permission denied.");
      else toast.error("Could not start screen sharing.");
      setIsSharing(false);
    }
  };

  const handleAnalyzeScreen = async () => {
    if (isAnalyzingScreen) return;
    if (!isSharing || !sharedVideoRef.current) {
      toast.error("Start screen sharing first.");
      return;
    }

    const video = sharedVideoRef.current;
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) {
      toast.error("Screen preview not ready yet.");
      return;
    }

    setIsAnalyzingScreen(true);
    try {
      const canvas = document.createElement("canvas");
      canvas.width = vw;
      canvas.height = vh;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(video, 0, 0, vw, vh);

      const blob = await new Promise((resolve) =>
        canvas.toBlob((b) => resolve(b), "image/png", 0.92)
      );
      if (!blob) {
        toast.error("Could not capture screen image.");
        return;
      }

      const formData = new FormData();
      formData.append("image", blob, `screen-${Date.now()}.png`);
      await api.post(`/sessions/${id}/analyze-screen`, formData);
      queryClient.invalidateQueries(["messages", id]);
      toast.success("Screen analyzed");
    } catch (err) {
      const msg = err?.response?.data?.message || "Screen analysis failed";
      toast.error(msg);
    } finally {
      setIsAnalyzingScreen(false);
    }
  };

  const handleSendMessage = async (e) => {
    e.preventDefault();
    if (hideExtras) return;
    if (!message.trim()) return;
    const content = message;
    setMessage("");
    await sendAndTriggerAI(content);
  };

  const handleStartRecording = async ({ fromUserGesture } = {}) => {
    if (isRecordingRef.current) return;

    shouldKeepListeningRef.current = true;
    speechRecognitionStopRequestedRef.current = false;

    // Co-pilot: start both (1) MediaRecorder ring-buffer (for accurate Whisper on-demand)
    // and (2) WebSpeechRecognition (for instant on-device interim text).

    // Prefer MediaRecorder (works on mobile too), with backend transcription.
    if (!navigator.mediaDevices?.getUserMedia) {
      toast.error("Microphone is not available in this browser.");
      return;
    }

    if (hideExtras && isProbablyInsecureContext()) {
      setNeedsUserGestureResume(false);
      setListeningText(
        "Microphone requires HTTPS on Android Chrome. Open the app on an https:// link (or localhost)."
      );
      toast.error("Microphone requires HTTPS on Android Chrome.");
      shouldKeepListeningRef.current = false;
      setRecordingState(false);
      return;
    }

    try {
      speechBaseTextRef.current = message ? `${message.trimEnd()} ` : "";
      continuousPrefixRef.current = speechBaseTextRef.current;
      if (!hideExtras) stopSpeechRecognition();

      const canUseWebSpeech = srCanUse && srMicAvailable !== false;

      // If the user explicitly tapped to start listening, allow retrying ElevenLabs
      // even if we previously fell back at runtime.
      if (
        fromUserGesture &&
        String(sttProviderRef.current || "").toLowerCase() ===
          "elevenlabs_client"
      ) {
        elevenClientRuntimeFallbackRef.current = "";
        elevenClientFallbackTriggeredRef.current = false;
      }

      const effectiveProvider = getEffectiveSttProvider({ canUseWebSpeech });

      // Client-side ElevenLabs: connect directly using single-use token (lowest latency).
      if (effectiveProvider === "elevenlabs_client") {
        if (elevenClientDisabledRef.current) {
          // Keep selection as-is; use runtime fallback.
          elevenClientRuntimeFallbackRef.current = canUseWebSpeech
            ? "webspeech"
            : "groq";
        } else {
          // Android Chrome: starting ElevenLabs realtime from an auto-start effect
          // is frequently blocked/unstable and can immediately disconnect.
          // Require a user gesture (tap / AI Answer) before connecting.
          if (hideExtras && isAndroidBrowser() && !fromUserGesture) {
            try {
              setNeedsUserGestureResume(true);
            } catch {
              // ignore
            }
            setListeningText((prev) => prev || "Tap to enable microphone…");
            return;
          }

          if (elevenClientConnectInFlightRef.current) return;
          elevenClientConnectInFlightRef.current = true;

          elevenClientBaseRef.current = "";
          // Do NOT reset these if we've already hard-disabled the provider.
          elevenClientErrorNotifiedRef.current = false;
          elevenClientFallbackTriggeredRef.current = false;
          try {
            await reconnectElevenLabsClientRealtime({
              api,
              scribeRef,
              elevenLanguageCode,
            });

            // Mark recording state and exit early (no MediaRecorder/SR needed).
            setRecordingState(true);
            return;
          } catch (e) {
            const msg =
              e?.response?.data?.message ||
              e?.message ||
              "ElevenLabs realtime failed to start.";
            toast.error(msg);
            setRecordingState(false);
            return;
          } finally {
            elevenClientConnectInFlightRef.current = false;
          }
        }
      }

      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
            channelCount: 1,
          },
        });
      } catch {
        // iOS/WebKit can reject some optional constraints; retry with a minimal request.
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      }
      mediaStreamRef.current = stream;

      // Optional: low-latency WS PCM streaming pipeline.
      // Uses the same mic stream (no double getUserMedia).
      try {
        if (hideExtras && enableWsPcmStt) {
          await startWsPcmStreaming({ stream });
        }
      } catch {
        // ignore
      }

      if (!window.MediaRecorder) {
        toast.error(
          "Speech-to-text isn’t supported here. Use Chrome/Edge or enable server transcription."
        );
        stream.getTracks().forEach((t) => t.stop());
        mediaStreamRef.current = null;
        return;
      }

      const mimeType = pickRecorderMimeType();
      const recorder = new MediaRecorder(
        stream,
        mimeType ? { mimeType } : undefined
      );
      mediaRecorderRef.current = recorder;
      audioChunksRef.current = [];
      audioRingRef.current = [];
      audioHeaderChunkRef.current = null;

      recorder.ondataavailable = (evt) => {
        handleMediaRecorderDataAvailableImpl({
          evt,
          hideExtras,
          audioRingIgnoreUntilRef,
          audioHeaderChunkRef,
          audioRingRef,
          audioChunksRef,
          maxParts: 16, // ~16 seconds if timeslice=1000
        });
      };

      recorder.onerror = () => {
        toast.error("Audio recording failed. Try again.");
        setRecordingState(false);
        stopAndCleanupMedia();
      };

      const buildBlobFromChunks = () => {
        return buildBlobFromChunksImpl({
          hideExtras,
          audioHeaderChunkRef,
          audioChunksRef,
          recorder,
        });
      };

      const stopSegment = async ({ restart }) => {
        await stopSegmentImpl({
          restart,
          hideExtras,
          mediaRecorderRef,
          silenceStateRef,
          audioChunksRef,
          audioHeaderChunkRef,
          isRecordingRef,
          buildBlobFromChunks,
          serverSttDisabledRef,
          lastServerSttCallAtRef,
          serverSttBackoffUntilRef,
          transcribeAudioBlob,
          pushTranscript,
          speechBaseTextRef,
          setMessage,
          toast,
        });
      };

      // Silence detection:
      // - Classic mode: segment on long pauses and transcribe the segment.
      // - Co-pilot mode: trigger a "final pass" refinement shortly after pauses.
      startSilenceDetectionLoopImpl({
        stream,
        hideExtras,
        audioContextRef,
        analyserRef,
        silenceRafRef,
        silenceStateRef,
        isRecordingRef,
        mediaRecorderRef,
        audioChunksRef,
        stopSegment,
      });

      // Classic mode only: silence-based segmentation + server STT on pauses.
      // Copilot Option C: server STT is on-demand only (AI Answer tap).
      if (!hideExtras) {
        try {
          // no-op (silence loop is started above)
        } catch {
          // If analyser fails, recording still works.
        }
      }

      if (hideExtras) {
        // Emit data every ~1s so we can maintain an on-demand ring buffer.
        recorder.start(1000);
      } else {
        recorder.start();
      }
      setRecordingState(true);

      // If user selected AssemblyAI, run realtime streaming as an accuracy layer.
      // Keep WebSpeech running where available for instant word-by-word Listening.
      if (
        hideExtras &&
        enableAssemblyAiBackup &&
        sttProviderRef.current === "assemblyai"
      ) {
        stopAssemblyAiRealtime();
        const rt = await startAssemblyAiRealtime(stream);
        if (!rt?.ok && !assemblyRtErrorNotifiedRef.current) {
          assemblyRtErrorNotifiedRef.current = true;
          toast.error(
            rt?.message ||
              "AssemblyAI realtime isn’t available. Falling back to server transcription."
          );
        }
      }

      if (hideExtras) {
        stopBackgroundServerSttLoop();
        startBackgroundServerSttLoop();
      }

      // Start SR after mic permission is granted.
      // (In some browsers SR is blocked without user gesture; we'll retry on AI Answer tap.)
      if (hideExtras && !speechRecognitionRef.current) {
        try {
          if (
            !(
              sttProviderRef.current === "assemblyai" &&
              enableAssemblyAiBackup &&
              assemblyRtActiveRef.current
            )
          ) {
            const srStarted = await startWebSpeechRecognition({ force: true });

            // iOS/WebKit often has no Web Speech; use realtime STT backup for low latency.
            if (
              !srStarted &&
              enableAssemblyAiBackup &&
              !assemblyRtActiveRef.current
            ) {
              stopSpeechRecognition();
              stopAssemblyAiRealtime();
              const rt = await startAssemblyAiRealtime(stream);
              if (!rt?.ok && !assemblyRtErrorNotifiedRef.current) {
                assemblyRtErrorNotifiedRef.current = true;
                toast.error(
                  rt?.message ||
                    "Realtime speech-to-text isn’t available. Falling back to server transcription."
                );
              }
            }
          }
        } catch {
          // ignore
        }
      }
    } catch (err) {
      const name = err?.name;
      if (name === "NotAllowedError" || name === "PermissionDeniedError") {
        // Android can throw NotAllowedError when not started from a user gesture.
        try {
          if (hideExtras) {
            // Avoid a second in-app popup; let the browser permission sheet handle it.
            setListeningText((prev) => prev || "Tap to enable microphone…");
            try {
              const perms = navigator?.permissions;
              if (perms?.query) {
                const status = await perms.query({ name: "microphone" });
                if (status?.state === "denied") {
                  toast.error(
                    "Microphone permission denied. Enable it in browser settings and reload."
                  );
                } else {
                  setNeedsUserGestureResume(true);
                  showMicResumeToast();
                }
              } else {
                setNeedsUserGestureResume(true);
                showMicResumeToast();
              }
            } catch {
              setNeedsUserGestureResume(true);
              showMicResumeToast();
            }
          } else {
            toast.error(
              "Microphone permission denied. Allow mic access and retry."
            );
          }
        } catch {
          toast.error(
            "Microphone permission denied. Allow mic access and retry."
          );
        }
      } else if (
        name === "SecurityError" ||
        name === "NotFoundError" ||
        name === "NotReadableError"
      ) {
        if (hideExtras) {
          // Treat as recoverable via user interaction / permissions.
          setNeedsUserGestureResume(true);
          setListeningText(
            (prev) =>
              prev ||
              (name === "SecurityError"
                ? "Microphone blocked by browser security (HTTPS required)."
                : name === "NotFoundError"
                  ? "No microphone found. Connect a mic and tap to retry…"
                  : "Microphone is busy. Close other apps using mic and tap to retry…")
          );
          showMicResumeToast();
        } else {
          toast.error("Couldn’t access microphone. Check browser permissions.");
        }
      } else {
        toast.error("Couldn’t access microphone. Check browser permissions.");
      }
      setRecordingState(false);
      stopAndCleanupMedia();
    }
  };

  const handleStopRecording = () => {
    shouldKeepListeningRef.current = false;
    stopSpeechRecognition();
    stopAssemblyAiRealtime();

    // Stop WS PCM streaming (if enabled).
    stopWsPcmStreaming({ sendFinalize: true });

    if (
      String(sttProviderRef.current || "").toLowerCase() === "elevenlabs_client"
    ) {
      try {
        stopElevenLabsClientRealtime();
      } catch {
        // ignore
      }
      elevenClientBaseRef.current = "";
      elevenClientFallbackTriggeredRef.current = false;
      setRecordingState(false);
      return;
    }

    if (hideExtras) {
      stopAndCleanupMedia();
      setRecordingState(false);
      return;
    }

    // If MediaRecorder is active, finalize one last segment before cleanup
    const recorder = mediaRecorderRef.current;
    if (
      recorder &&
      recorder.state !== "inactive" &&
      audioChunksRef.current.length > 0
    ) {
      const chunks = audioChunksRef.current;
      const type = recorder.mimeType || "audio/webm";
      const blob = new Blob(chunks, { type });
      if (serverSttDisabledRef.current) {
        stopAndCleanupMedia();
      } else {
        transcribeAudioBlob(blob)
          .then((result) => {
            const text = String(result?.text || "").trim();
            if (text) {
              pushTranscript(text, "mic", { broadcast: true });
              const next = `${speechBaseTextRef.current}${text} `.trimStart();
              setMessage(next);
              speechBaseTextRef.current = `${next.trimEnd()} `;
            }
          })
          .catch(() => {
            // Avoid extra toasts on manual stop.
          })
          .finally(() => {
            stopAndCleanupMedia();
          });
      }
    } else {
      stopAndCleanupMedia();
    }
    setRecordingState(false);
  };

  useEffect(() => {
    if (!socket || !id) return;

    const onTranscript = (payload) => {
      try {
        if (String(payload?.sessionId || "") !== String(id)) return;
        const ignoreUntil = Number(ignoreRealtimeUntilRef.current || 0);
        if (ignoreUntil && Date.now() < ignoreUntil) return;
        const prov = String(payload?.provider || "")
          .trim()
          .toLowerCase();
        if (prov !== "assemblyai" && prov !== "elevenlabs") return;

        const text = String(payload?.text || "").trim();
        if (!text) return;

        lastLocalSpeechUpdateAtRef.current = Date.now();

        const webSpeechUsable =
          !!srCanUse &&
          srMicAvailable !== false &&
          !speechRecognitionBlockedRef.current;

        if (payload?.isFinal) {
          // Commit final segment
          const nextBase = `${assemblyRtBaseRef.current}${text} `.replace(
            /\s+/g,
            " "
          );
          assemblyRtBaseRef.current = nextBase;
          pushTranscript(text, "mic");

          // Only drive the Listening UI from AssemblyAI when Web Speech isn't usable
          // (e.g., iOS Safari). Otherwise Web Speech remains the instant UI.
          if (!webSpeechUsable) {
            setListeningText(nextBase.trim());
          }
        } else {
          const composed = `${assemblyRtBaseRef.current}${text}`
            .replace(/\s+/g, " ")
            .trim();
          if (!webSpeechUsable) {
            setListeningText(composed);
          }
        }
      } catch {
        // ignore
      }
    };

    const onError = (payload) => {
      try {
        if (String(payload?.sessionId || "") !== String(id)) return;
        const prov = String(payload?.provider || "")
          .trim()
          .toLowerCase();
        if (prov !== "assemblyai" && prov !== "elevenlabs") return;
        // Fallback to WebSpeech if realtime fails.
        stopAssemblyAiRealtime();
        if (hideExtras && isRecordingRef.current) {
          void startWebSpeechRecognition({ force: true });
        }
      } catch {
        // ignore
      }
    };

    socket.on("stt_transcript", onTranscript);
    socket.on("stt_error", onError);
    return () => {
      socket.off("stt_transcript", onTranscript);
      socket.off("stt_error", onError);
    };
  }, [socket, id, hideExtras, srCanUse, srMicAvailable]);

  const [endSessionDialog, setEndSessionDialog] = useState({
    open: false,
    reason: "manual", // 'manual' | 'expired'
  });

  const sessionExpiredDialogShownRef = useRef(false);

  const openEndSessionDialog = (reason) => {
    setEndSessionDialog({ open: true, reason });
  };

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

  const handleEndSession = () => {
    if (endSessionMutation.isPending) return;
    openEndSessionDialog("manual");
  };

  const handleSessionExpired = () => {
    if (endSessionMutation.isPending) return;
    if (sessionExpiredDialogShownRef.current) return;
    sessionExpiredDialogShownRef.current = true;
    openEndSessionDialog("expired");
  };

  const handleDownloadTranscript = async () => {
    try {
      const response = await api.get(`/sessions/${id}/transcript`, {
        responseType: "blob",
      });

      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", `interview-transcript-${id}.txt`);
      document.body.appendChild(link);
      link.click();
      link.remove();

      toast.success("Transcript downloaded successfully!");
    } catch (error) {
      toast.error("Failed to download transcript");
    }
  };

  const handleEvaluateMessage = (message) => {
    setSelectedMessage(message);
  };

  const { setMobileTopBar } = useContext(MobileTopBarContext);
  const isSessionActive = session?.status === "active";

  useEffect(() => {
    if (!setMobileTopBar) return;

    if (!session) {
      setMobileTopBar(null);
      return;
    }
    const p = String(session?.settings?.sttProvider || "groq")
      .trim()
      .toLowerCase();
    const m = String(session?.settings?.sttModel || "").trim();

    const core = (() => {
      if (p === "groq") return `Groq${m ? ` (${m})` : ""}`;
      if (p === "assemblyai") return "AssemblyAI";
      if (p === "webspeech") return "Local (Web Speech)";
      if (p === "deepspeech") return "DeepSpeech";
      if (p === "openai") return `OpenAI${m ? ` (${m})` : ""}`;
      if (p === "elevenlabs_client")
        return `ElevenLabs (Client)${m ? ` (${m})` : ""}`;
      if (p === "elevenlabs") return `ElevenLabs${m ? ` (${m})` : ""}`;
      return p || "-";
    })();

    const sttLabel = (() => {
      if (hideExtras) {
        const hybrid = enableAssemblyAiBackup && p === "assemblyai";
        if (hybrid) return "STT: AssemblyAI";
        return `STT: ${core}`;
      }
      return `STT: ${core}`;
    })();

    const sttWsLabel = (() => {
      if (p === "elevenlabs_client") {
        return `${sttLabel} • ElevenLabs: ${
          elevenClientConnected ? "Connected" : "Disconnected (tap Settings)"
        }`;
      }

      if (showWsPcmDebug && enableWsPcmStt && hideExtras) {
        return `${sttLabel} • WS: ${wsPcmStatus}`;
      }

      return sttLabel;
    })();

    const center = (
      <div className="min-w-0">
        <div className="flex items-center text-xs text-gray-500 dark:text-gray-400 truncate">
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
        <div className="mt-0.5 text-xs text-gray-500 dark:text-gray-400 leading-snug truncate sm:whitespace-normal sm:break-words">
          {sttWsLabel}
        </div>
      </div>
    );

    const right = (
      <>
        <button
          onClick={() => setConnectOpen(true)}
          className="p-2 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
          title="Settings"
          aria-label="Settings"
        >
          <Settings className="h-5 w-5" />
        </button>

        {isSessionActive && (
          <button
            onClick={handleEndSession}
            className="p-2 rounded-lg bg-red-600 text-white hover:bg-red-700 transition-colors"
            title="End Session"
            aria-label="End Session"
          >
            <Power className="h-5 w-5" />
          </button>
        )}
      </>
    );

    setMobileTopBar({ center, right });
    return () => setMobileTopBar(null);
  }, [
    setMobileTopBar,
    session,
    hideExtras,
    enableAssemblyAiBackup,
    enableWsPcmStt,
    showWsPcmDebug,
    wsPcmStatus,
    isSessionActive,
  ]);

  if (isLoading || !session) {
    return <LoadingSpinner />;
  }

  const messages = messagesData?.messages || [];

  return (
    <div className="min-h-screen overflow-x-hidden bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800">
      {hideExtras && micPermissionDialog.open && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={closeMicPermissionDialog}
          />
          <div className="relative w-full max-w-md bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl shadow-xl">
            <div className="p-5 border-b border-gray-200 dark:border-gray-800">
              <div className="text-lg font-bold text-gray-900 dark:text-white">
                Enable microphone
              </div>
              <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                {micPermissionDialog.message ||
                  "Allow microphone access to use speech-to-text."}
              </div>
            </div>
            <div className="p-5 flex items-center justify-end gap-3">
              <button
                onClick={closeMicPermissionDialog}
                className="px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-800 text-gray-900 dark:text-white font-semibold"
              >
                Not now
              </button>
              <button
                onClick={() => {
                  closeMicPermissionDialog();
                  try {
                    shouldKeepListeningRef.current = true;
                  } catch {
                    // ignore
                  }
                  try {
                    void handleStartRecording({ fromUserGesture: true });
                  } catch {
                    // ignore
                  }
                }}
                className="px-4 py-2 rounded-lg bg-gray-900 text-white font-semibold hover:bg-black disabled:opacity-50"
              >
                Allow microphone
              </button>
            </div>
          </div>
        </div>
      )}

      {endSessionDialog.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={
              endSessionDialog.reason === "manual"
                ? closeEndSessionDialog
                : undefined
            }
          />
          <div className="relative w-full max-w-md bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl shadow-xl">
            <div className="p-5 border-b border-gray-200 dark:border-gray-800">
              <div className="text-lg font-bold text-gray-900 dark:text-white">
                {endSessionDialog.reason === "expired"
                  ? "Session expired"
                  : "End session?"}
              </div>
              <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                {endSessionDialog.reason === "expired"
                  ? "Time is up. End the session to view your evaluation."
                  : "Are you sure you want to end the session? You cannot resume it later."}
              </div>
            </div>
            <div className="p-5 flex items-center justify-end gap-3">
              {endSessionDialog.reason === "manual" && (
                <button
                  onClick={closeEndSessionDialog}
                  className="px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-800 text-gray-900 dark:text-white font-semibold"
                >
                  Cancel
                </button>
              )}
              <button
                onClick={confirmEndSession}
                className="px-4 py-2 rounded-lg bg-red-600 text-white font-semibold hover:bg-red-700 disabled:opacity-50"
                disabled={endSessionMutation.isPending}
              >
                {endSessionDialog.reason === "expired" ? "OK" : "End session"}
              </button>
            </div>
          </div>
        </div>
      )}
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
                  {(() => {
                    const p = String(session?.settings?.sttProvider || "groq")
                      .trim()
                      .toLowerCase();
                    const m = String(session?.settings?.sttModel || "").trim();

                    const core = (() => {
                      if (p === "groq") return `Groq${m ? ` (${m})` : ""}`;
                      if (p === "assemblyai") return "AssemblyAI";
                      if (p === "webspeech") return "Local (Web Speech)";
                      if (p === "deepspeech") return "DeepSpeech";
                      if (p === "openai") return `OpenAI${m ? ` (${m})` : ""}`;
                      if (p === "elevenlabs_client")
                        return `ElevenLabs (Client)${m ? ` (${m})` : ""}`;
                      if (p === "elevenlabs")
                        return `ElevenLabs${m ? ` (${m})` : ""}`;
                      return p || "-";
                    })();

                    const sttLabel = (() => {
                      if (hideExtras) {
                        const hybrid =
                          enableAssemblyAiBackup && p === "assemblyai";
                        if (hybrid) return "STT: AssemblyAI";
                        return `STT: ${core}`;
                      }
                      return `STT: ${core}`;
                    })();

                    if (p === "elevenlabs_client") {
                      const canUseWebSpeech = srCanUse && srMicAvailable !== false;
                      const effective = getEffectiveSttProvider({ canUseWebSpeech });
                      const fallbackNote =
                        !elevenClientConnected &&
                        effective &&
                        effective !== "elevenlabs_client"
                          ? ` • Using ${effective}`
                          : "";

                      return `${sttLabel} • ElevenLabs: ${
                        elevenClientConnected
                          ? "Connected"
                          : "Disconnected (tap Settings)"
                      }${fallbackNote}`;
                    }

                    if (showWsPcmDebug && enableWsPcmStt && hideExtras) {
                      return `${sttLabel} • WS: ${wsPcmStatus}`;
                    }

                    return sttLabel;
                  })()}
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

              {!hideExtras && (
                <button
                  onClick={handleDownloadTranscript}
                  className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                  title="Download transcript"
                >
                  <Download className="h-5 w-5 text-gray-600 dark:text-gray-300" />
                </button>
              )}

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
        <div
          className={
            hideExtras
              ? "grid grid-cols-1 gap-3"
              : "grid grid-cols-1 lg:grid-cols-4 gap-6"
          }
        >
          {/* Left Panel - Chat */}
          <div className={hideExtras ? "" : "lg:col-span-3"}>
            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg h-[calc(100dvh-8rem)] sm:h-[calc(100dvh-10rem)] flex flex-col">
              {/* Messages Container */}
              <div
                className={`flex-1 overflow-y-auto p-3 sm:p-6 ${
                  hideExtras ? "pb-32" : ""
                }`}
              >
                {hideExtras ? (
                  <div className="space-y-2">
                    <div className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden">
                      {/* Listening */}
                      <div className="p-2.5 bg-gray-50 dark:bg-gray-900/30">
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-sm font-semibold text-gray-900 dark:text-white">
                            <span className="text-gray-500 dark:text-gray-400 mr-2">
                              •
                            </span>
                            Listening
                          </div>

                          <div className="text-xs font-semibold text-gray-600 dark:text-gray-300">
                            {isRecording || srListening ? (
                              <span className="text-red-600 dark:text-red-400">
                                Listening…
                              </span>
                            ) : needsUserGestureResume ||
                              (shouldKeepListeningRef.current &&
                                !String(listeningText || "").trim()) ? (
                              <span>Tap to resume…</span>
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
                                  parakeetAnswer && typeof parakeetAnswer === "object"
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
                                const code = String(p?.code_example?.code || "").trim();

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
                ) : (
                  <>
                    <div className="space-y-6">
                      <AnimatePresence initial={false}>
                        {messages.map((msg, index) => (
                          <motion.div
                            key={msg._id || index}
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -20 }}
                            className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                          >
                            <div
                              className={`max-w-3xl rounded-2xl p-4 ${
                                msg.role === "user"
                                  ? "bg-primary-500 text-white rounded-br-none"
                                  : "bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-white rounded-bl-none"
                              }`}
                            >
                              <div className="flex items-center mb-2">
                                <div
                                  className={`h-8 w-8 rounded-full flex items-center justify-center mr-3 ${
                                    msg.role === "user"
                                      ? "bg-primary-600"
                                      : "bg-gray-600 dark:bg-gray-600"
                                  }`}
                                >
                                  {msg.role === "user" ? (
                                    <User className="h-4 w-4" />
                                  ) : (
                                    <Bot className="h-4 w-4" />
                                  )}
                                </div>
                                <span className="font-medium">
                                  {msg.role === "user" ? "You" : "Interviewer"}
                                </span>
                                <span className="text-xs opacity-75 ml-3">
                                  {format(new Date(msg.timestamp), "HH:mm")}
                                </span>
                              </div>
                              <div className="whitespace-pre-wrap">
                                {msg.content}
                              </div>

                              {msg.evaluation && (
                                <div className="mt-3 pt-3 border-t border-opacity-20">
                                  <div className="flex items-center justify-between">
                                    <div className="flex items-center">
                                      <div
                                        className={`px-2 py-1 rounded text-xs font-semibold ${
                                          msg.evaluation.score >= 8
                                            ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300"
                                            : msg.evaluation.score >= 6
                                              ? "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300"
                                              : "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300"
                                        }`}
                                      >
                                        Score: {msg.evaluation.score}/10
                                      </div>
                                    </div>
                                    <button
                                      onClick={() => handleEvaluateMessage(msg)}
                                      className="text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
                                    >
                                      View details
                                    </button>
                                  </div>
                                </div>
                              )}

                              {msg.role === "assistant" && !msg.evaluation && (
                                <div className="mt-3 flex space-x-2">
                                  <button
                                    onClick={() => handleEvaluateMessage(msg)}
                                    className="text-xs px-3 py-1 bg-gray-200 dark:bg-gray-600 rounded-full hover:bg-gray-300 dark:hover:bg-gray-500 transition-colors"
                                  >
                                    Evaluate Answer
                                  </button>
                                </div>
                              )}
                            </div>
                          </motion.div>
                        ))}
                      </AnimatePresence>

                      {isTyping && (
                        <motion.div
                          initial={{ opacity: 0, y: 20 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="flex justify-start"
                        >
                          <div className="bg-gray-100 dark:bg-gray-700 rounded-2xl rounded-bl-none p-4">
                            <TypingIndicator />
                          </div>
                        </motion.div>
                      )}

                      <div ref={messagesEndRef} />
                    </div>
                  </>
                )}
              </div>

              {/* Input Area */}
              <div
                className={
                  hideExtras
                    ? "fixed bottom-[calc(env(safe-area-inset-bottom)+0.75rem)] left-0 right-0 z-50 px-3"
                    : "border-t border-gray-200 dark:border-gray-700 p-2 sm:p-4"
                }
              >
                {hideExtras ? (
                  <div className="max-w-7xl mx-auto">
                    <div className="w-fit mx-auto bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl shadow-lg p-1.5 sm:p-3">
                      <div className="flex items-center justify-center gap-2">
                        <button
                          type="button"
                          onClick={handleGenerateAIAnswer}
                          disabled={isGeneratingAnswer}
                          className="w-36 sm:w-44 px-3 py-2 rounded-lg bg-gray-900 text-white text-sm font-semibold hover:bg-black transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {isGeneratingAnswer ? "Generating…" : "AI Answer"}
                        </button>

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
                ) : (
                  <>
                    <form
                      onSubmit={handleSendMessage}
                      className="flex items-center space-x-4"
                    >
                      <button
                        type="button"
                        onClick={
                          isRecording
                            ? handleStopRecording
                            : handleStartRecording
                        }
                        className={`p-3 rounded-full ${
                          isRecording
                            ? "bg-red-100 text-red-600 dark:bg-red-900 dark:text-red-300"
                            : "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300"
                        } hover:opacity-90 transition-opacity`}
                      >
                        {isRecording ? (
                          <MicOff className="h-5 w-5" />
                        ) : (
                          <Mic className="h-5 w-5" />
                        )}
                      </button>

                      <div className="flex-1 relative">
                        <textarea
                          ref={inputRef}
                          value={message}
                          onChange={(e) => setMessage(e.target.value)}
                          placeholder="Type your answer here..."
                          className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-primary-500 focus:border-transparent resize-none"
                          rows={1}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && !e.shiftKey) {
                              e.preventDefault();
                              handleSendMessage(e);
                            }
                          }}
                        />
                        <div className="hidden sm:block absolute right-3 top-3 text-xs text-gray-500">
                          Shift+Enter for new line
                        </div>
                      </div>

                      <button
                        type="submit"
                        disabled={
                          !message.trim() || sendMessageMutation.isLoading
                        }
                        className="p-3 bg-primary-600 text-white rounded-full hover:bg-primary-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <Send className="h-5 w-5" />
                      </button>
                    </form>
                  </>
                )}

                {!hideExtras && (
                  <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <button
                      type="button"
                      onClick={handleGenerateAIAnswer}
                      disabled={isGeneratingAnswer}
                      className="w-full px-4 py-3 rounded-lg bg-gray-900 text-white font-semibold hover:bg-black transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isGeneratingAnswer ? "Generating…" : "AI Answer"}
                    </button>
                    <button
                      type="button"
                      onClick={handleClearCapture}
                      className="w-full px-4 py-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white font-semibold hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                    >
                      Clear
                    </button>
                    <button
                      type="button"
                      onClick={handleAnalyzeScreen}
                      disabled={!isSharing || isAnalyzingScreen}
                      className="w-full px-4 py-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white font-semibold hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isAnalyzingScreen ? "Analyzing…" : "Analyze Screen"}
                    </button>
                  </div>
                )}

                {!hideExtras && (
                  <div className="mt-3 flex items-center justify-between text-sm text-gray-500 dark:text-gray-400">
                    <div>
                      {isRecording && (
                        <span className="flex items-center text-red-600 dark:text-red-400">
                          <span className="h-2 w-2 bg-red-600 rounded-full animate-ping mr-2" />
                          Recording...
                        </span>
                      )}
                    </div>
                    <div>
                      Messages: {messages.length} • Tokens:{" "}
                      {session.analytics?.totalTokens || 0}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Right Panel - Session Info & Tools */}
          {!hideExtras && (
            <div className="lg:col-span-1 space-y-6">
              {/* Screen Share */}
              <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-bold text-gray-900 dark:text-white">
                    Sharing
                  </h3>
                  {isSharing ? (
                    <button
                      onClick={stopScreenShare}
                      className="px-3 py-1.5 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700 transition-colors"
                    >
                      Stop
                    </button>
                  ) : (
                    <button
                      onClick={startScreenShare}
                      className="px-3 py-1.5 bg-primary-600 text-white text-sm font-medium rounded-lg hover:bg-primary-700 transition-colors"
                    >
                      Start
                    </button>
                  )}
                </div>

                <div className="rounded-xl overflow-hidden bg-gray-100 dark:bg-gray-700 border border-gray-200 dark:border-gray-600">
                  <video
                    ref={sharedVideoRef}
                    className="w-full aspect-video"
                    playsInline
                    muted
                    controls={false}
                  />
                </div>

                <div className="mt-4 flex items-center gap-3">
                  <button
                    onClick={() => {
                      const el = sharedVideoRef.current;
                      if (!el) return;
                      if (el.requestFullscreen) el.requestFullscreen();
                    }}
                    disabled={!isSharing}
                    className="flex-1 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Fullscreen
                  </button>
                  <button
                    onClick={startScreenShare}
                    className="flex-1 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                  >
                    Change Tab
                  </button>
                </div>
              </div>

              {/* Transcript */}
              <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-bold text-gray-900 dark:text-white">
                    Transcript
                  </h3>
                  <button
                    onClick={() => setTranscriptItems([])}
                    className="px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors text-sm"
                  >
                    Clear
                  </button>
                </div>

                <div className="flex items-center justify-between mb-3 text-sm text-gray-500 dark:text-gray-400">
                  <button
                    onClick={
                      isRecording ? handleStopRecording : handleStartRecording
                    }
                    className={`px-3 py-1.5 rounded-lg font-medium transition-colors ${
                      isRecording
                        ? "bg-red-600 text-white hover:bg-red-700"
                        : "bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600"
                    }`}
                  >
                    {isRecording ? "Stop" : "Listen"}
                  </button>
                  <label className="flex items-center gap-2 select-none">
                    <input
                      type="checkbox"
                      className="h-4 w-4"
                      checked={transcriptAutoScroll}
                      onChange={(e) =>
                        setTranscriptAutoScroll(e.target.checked)
                      }
                    />
                    AutoScroll
                  </label>
                </div>

                <div className="h-56 overflow-y-auto rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/30 p-3 space-y-2">
                  {transcriptItems.length === 0 ? (
                    <div className="text-sm text-gray-500 dark:text-gray-400">
                      Start listening to see live transcript.
                    </div>
                  ) : (
                    transcriptItems.map((t) => (
                      <div
                        key={t.id}
                        className="text-sm text-gray-800 dark:text-gray-200"
                      >
                        {t.text}
                      </div>
                    ))
                  )}
                  <div ref={transcriptEndRef} />
                </div>
              </div>

              {/* Session Info */}
              <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-6">
                <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4">
                  Session Info
                </h3>

                <div className="space-y-4">
                  <div>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">
                      Position
                    </p>
                    <p className="font-medium text-gray-900 dark:text-white">
                      {session.job.title}
                    </p>
                  </div>

                  <div>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">
                      Company
                    </p>
                    <p className="font-medium text-gray-900 dark:text-white">
                      {session.job.company}
                    </p>
                  </div>

                  <div>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">
                      AI Model
                    </p>
                    <div className="flex items-center">
                      <Zap className="h-4 w-4 text-yellow-500 mr-2" />
                      <span className="font-medium text-gray-900 dark:text-white">
                        {session.settings.aiModel
                          .replace(/-/g, " ")
                          .toUpperCase()}
                      </span>
                    </div>
                  </div>

                  <div>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">
                      Difficulty
                    </p>
                    <span
                      className={`px-2 py-1 rounded text-xs font-semibold capitalize ${
                        session.settings.difficulty === "beginner"
                          ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300"
                          : session.settings.difficulty === "intermediate"
                            ? "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300"
                            : session.settings.difficulty === "advanced"
                              ? "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300"
                              : "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300"
                      }`}
                    >
                      {session.settings.difficulty}
                    </span>
                  </div>
                </div>
              </div>

              {/* Quick Actions */}
              <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-6">
                <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4">
                  Quick Actions
                </h3>

                <div className="space-y-3">
                  <button
                    onClick={() =>
                      sendAndTriggerAI(
                        "Can you ask a different question on the same topic?"
                      )
                    }
                    className="w-full flex items-center justify-between p-3 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                  >
                    <div className="flex items-center">
                      <RotateCcw className="h-5 w-5 text-gray-600 dark:text-gray-300 mr-3" />
                      <span className="font-medium text-gray-900 dark:text-white">
                        Ask Different Question
                      </span>
                    </div>
                  </button>

                  <button
                    onClick={() =>
                      sendAndTriggerAI(
                        "Can you provide a hint or clarification?"
                      )
                    }
                    className="w-full flex items-center justify-between p-3 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                  >
                    <div className="flex items-center">
                      <BookOpen className="h-5 w-5 text-gray-600 dark:text-gray-300 mr-3" />
                      <span className="font-medium text-gray-900 dark:text-white">
                        Request Hint
                      </span>
                    </div>
                  </button>

                  <button
                    onClick={handleDownloadTranscript}
                    className="w-full flex items-center justify-between p-3 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                  >
                    <div className="flex items-center">
                      <Download className="h-5 w-5 text-gray-600 dark:text-gray-300 mr-3" />
                      <span className="font-medium text-gray-900 dark:text-white">
                        Download Transcript
                      </span>
                    </div>
                  </button>
                </div>
              </div>

              {/* Tips & Guidelines */}
              <div className="bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 rounded-2xl shadow-lg p-6">
                <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4 flex items-center">
                  <BookOpen className="h-5 w-5 mr-2" />
                  Interview Tips
                </h3>

                <ul className="space-y-3 text-sm">
                  <li className="flex items-start">
                    <div className="h-2 w-2 bg-blue-500 rounded-full mt-1 mr-3" />
                    <span className="text-gray-700 dark:text-gray-300">
                      Be specific and detailed in your answers
                    </span>
                  </li>
                  <li className="flex items-start">
                    <div className="h-2 w-2 bg-blue-500 rounded-full mt-1 mr-3" />
                    <span className="text-gray-700 dark:text-gray-300">
                      Think aloud - explain your thought process
                    </span>
                  </li>
                  <li className="flex items-start">
                    <div className="h-2 w-2 bg-blue-500 rounded-full mt-1 mr-3" />
                    <span className="text-gray-700 dark:text-gray-300">
                      Ask for clarification if needed
                    </span>
                  </li>
                  <li className="flex items-start">
                    <div className="h-2 w-2 bg-blue-500 rounded-full mt-1 mr-3" />
                    <span className="text-gray-700 dark:text-gray-300">
                      Use technical terms appropriately
                    </span>
                  </li>
                </ul>
              </div>
            </div>
          )}
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
            };

            // Persist selection immediately so refresh keeps it even if API fails.
            try {
              const nextProvider = String(safePayload?.sttProvider || "")
                .trim()
                .toLowerCase();
              const nextModel = String(safePayload?.sttModel || "").trim();
              if (nextProvider || nextModel) {
                writePersistedStt({
                  sttProvider: nextProvider || defaultSttProvider,
                  sttModel: nextModel || defaultSttModel,
                });
              }
            } catch {
              // ignore
            }

            // Immediately reflect dropdown selections in the header label.
            // This avoids waiting for the session refetch to update STT label.
            try {
              const nextProvider = String(safePayload?.sttProvider || "")
                .trim()
                .toLowerCase();
              if (nextProvider) sttProviderRef.current = nextProvider;
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

      {/* Message Evaluation Modal */}
      {selectedMessage && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-xl font-bold text-gray-900 dark:text-white">
                  Answer Evaluation
                </h3>
                <button
                  onClick={() => setSelectedMessage(null)}
                  className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
                >
                  <X className="h-6 w-6" />
                </button>
              </div>

              <div className="space-y-6">
                <div>
                  <h4 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-2">
                    Your Answer
                  </h4>
                  <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-4">
                    {selectedMessage.content}
                  </div>
                </div>

                {selectedMessage.evaluation ? (
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="bg-gradient-to-r from-green-50 to-emerald-50 dark:from-green-900/20 dark:to-emerald-900/20 p-4 rounded-lg">
                        <p className="text-sm text-gray-500 dark:text-gray-400">
                          Score
                        </p>
                        <p className="text-3xl font-bold text-green-600 dark:text-green-400">
                          {selectedMessage.evaluation.score}/10
                        </p>
                      </div>
                      <div className="bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 p-4 rounded-lg">
                        <p className="text-sm text-gray-500 dark:text-gray-400">
                          Accuracy
                        </p>
                        <p className="text-3xl font-bold text-blue-600 dark:text-blue-400">
                          {selectedMessage.evaluation.technicalAccuracy}%
                        </p>
                      </div>
                    </div>

                    <div>
                      <h4 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-2">
                        Feedback
                      </h4>
                      <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-4">
                        {selectedMessage.evaluation.feedback}
                      </div>
                    </div>

                    <div>
                      <h4 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-2">
                        Suggested Improvement
                      </h4>
                      <div className="bg-gradient-to-r from-purple-50 to-pink-50 dark:from-purple-900/20 dark:to-pink-900/20 rounded-lg p-4">
                        {selectedMessage.evaluation.suggestedAnswer}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-8">
                    <p className="text-gray-500 dark:text-gray-400">
                      This answer hasn't been evaluated yet.
                    </p>
                    <button
                      onClick={() => {
                        // Trigger evaluation
                        handleEvaluateMessage(selectedMessage);
                      }}
                      className="mt-4 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors"
                    >
                      Evaluate Now
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default InterviewSession;
