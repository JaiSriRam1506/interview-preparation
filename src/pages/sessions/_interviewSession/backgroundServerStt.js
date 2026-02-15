// frontend/src/pages/sessions/_interviewSession/backgroundServerStt.js

export const stopBackgroundServerSttLoopImpl = ({
  continuousWhisperIntervalRef,
  continuousWhisperInFlightRef,
} = {}) => {
  try {
    if (continuousWhisperIntervalRef.current) {
      clearInterval(continuousWhisperIntervalRef.current);
    }
  } catch {
    // noop
  }
  continuousWhisperIntervalRef.current = null;
  continuousWhisperInFlightRef.current = false;
};

export const startBackgroundServerSttLoopImpl = ({
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
} = {}) => {
  if (!hideExtras) return;
  if (!isRecordingRef.current) return;
  if (!shouldKeepListeningRef.current) return;
  if (serverSttDisabledRef.current) return;
  if (continuousWhisperIntervalRef.current) return;

  // Eleven-only mode: when using client-side ElevenLabs realtime, never run server STT.
  try {
    const provider = String(sttProviderRef?.current || "").trim().toLowerCase();
    if (provider === "elevenlabs_client") return;
  } catch {
    // ignore
  }

  try {
    const backoffUntil = Number(serverSttBackoffUntilRef?.current || 0);
    if (backoffUntil && Date.now() < backoffUntil) return;
  } catch {
    // ignore
  }

  const webSpeechStalled = isWebSpeechLikelyStalled();
  const autoServerLiveListening = !isWebSpeechLiveUsable() || webSpeechStalled;
  const shouldRunBackgroundServerStt =
    enableBackgroundServerStt || autoServerLiveListening;
  if (!shouldRunBackgroundServerStt) return;

  if (sttProviderRef.current === "assemblyai" && enableAssemblyAiBackup) {
    if (assemblyRtActiveRef.current) return;
  }

  const provider = String(sttProviderRef.current || "").toLowerCase();
  const intervalMs =
    provider === "fasterwhisper"
      ? 1_250
      : provider === "assemblyai"
        ? 4_000
        : 3_500;
  const windowSeconds = provider === "fasterwhisper" ? 2 : 4;

  const tick = async () => {
    try {
      if (!isRecordingRef.current) return;
      if (!shouldKeepListeningRef.current) return;
      if (continuousWhisperInFlightRef.current) return;
      if (serverSttDisabledRef.current) return;

      const sinceLocal = Date.now() - (lastLocalSpeechUpdateAtRef.current || 0);
      const hasLive = !!String(listeningTextRef.current || "").trim();
      if (hasLive && sinceLocal < 4000) return;

      const now = Date.now();
      const backoffUntil = serverSttBackoffUntilRef.current || 0;
      if (now < backoffUntil) return;

      const sinceLast = now - (lastServerSttCallAtRef.current || 0);
      if (sinceLast < intervalMs - 500) return;

      const blob = getLastRingBlob(windowSeconds) || getBufferedAudioBlob();
      if (!blob || blob.size < 4000) return;

      const epoch = Number(listeningEpochRef.current || 0);

      continuousWhisperInFlightRef.current = true;
      lastServerSttCallAtRef.current = now;

      const result = await transcribeAudioBlob(blob, {
        prompt: getSttPromptText(),
      });
      if (epoch !== Number(listeningEpochRef.current || 0)) return;
      const text = String(result?.text || "").trim();
      if (!text) return;
      if (text === lastServerSttTextRef.current) return;
      lastServerSttTextRef.current = text;

      if (Date.now() - (lastLocalSpeechUpdateAtRef.current || 0) < 1500) {
        return;
      }

      setListeningText((prev) => {
        const prevText = String(prev || "").trim();
        if (!prevText) return text;
        if (text.startsWith(prevText)) return text;
        if (prevText.startsWith(text)) return prevText;
        if (prevText.includes(text)) return prevText;
        return `${prevText} ${text}`.replace(/\s+/g, " ").trim();
      });
    } catch (err) {
      const status = err?.response?.status;
      const retryAfterSeconds =
        Number(err?.response?.data?.details?.retryAfterSeconds) ||
        Number(err?.response?.data?.retryAfterSeconds) ||
        0;

      // Vite/ngrok/proxy failures often surface as 502 or as a network error
      // with no HTTP status. Disable background STT to avoid spamming.
      if (status === 502 || !status) {
        serverSttDisabledRef.current = true;
        serverSttBackoffUntilRef.current = Date.now() + 60_000;
        try {
          if (!serverSttUnreachableNotifiedRef.current) {
            serverSttUnreachableNotifiedRef.current = true;
            toast.error(
              "Server transcription is unreachable (502). Ensure the backend is running and reachable from the ngrok tunnel."
            );
          }
        } catch {
          // ignore
        }

        stopBackgroundServerSttLoopImpl({
          continuousWhisperIntervalRef,
          continuousWhisperInFlightRef,
        });
        return;
      }

      if (status === 501) {
        serverSttDisabledRef.current = true;
        try {
          if (
            (autoServerLiveListening || enableBackgroundServerStt) &&
            !serverSttConfigErrorNotifiedRef.current
          ) {
            serverSttConfigErrorNotifiedRef.current = true;
            toast.error(
              err?.response?.data?.message ||
                "Server speech-to-text isn’t configured. Choose Groq/OpenAI in Connect or set STT API keys on the server."
            );
          }
        } catch {
          // ignore
        }

        stopBackgroundServerSttLoopImpl({
          continuousWhisperIntervalRef,
          continuousWhisperInFlightRef,
        });
        return;
      }

      if (status === 429) {
        const ms = Math.max(
          3000,
          Math.min(30000, (retryAfterSeconds || 10) * 1000)
        );
        serverSttBackoffUntilRef.current = Date.now() + ms;
        return;
      }

      serverSttBackoffUntilRef.current = Date.now() + 8000;
    } finally {
      continuousWhisperInFlightRef.current = false;
    }
  };

  setTimeout(() => {
    void tick();
  }, 1200);
  continuousWhisperIntervalRef.current = setInterval(() => {
    void tick();
  }, intervalMs);
};
