// frontend/src/pages/sessions/_interviewSession/webSpeech.js

export const stopSpeechRecognitionImpl = ({
  SpeechRecognition,
  speechRecognitionStopRequestedRef,
  speechRecognitionRef,
} = {}) => {
  speechRecognitionStopRequestedRef.current = true;
  try {
    try {
      // Abort if available to drop any pending partial results.
      SpeechRecognition.abortListening?.();
    } catch {
      // noop
    }
    try {
      SpeechRecognition.stopListening();
    } catch {
      // noop
    }
    speechRecognitionRef.current?.stop?.();
  } catch {
    // noop
  }
  speechRecognitionRef.current = null;
};

export const startWebSpeechRecognitionImpl = async (
  {
    srCanUse,
    srMicAvailable,
    hideExtras,
    message,
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
  } = {},
  { force } = {}
) => {
  if (!srCanUse) return false;
  if (speechRecognitionDisabledRef.current) return false;
  if (speechRecognitionBlockedRef.current && !force) return false;

  if (srMicAvailable === false && !force) {
    speechRecognitionBlockedRef.current = true;
    setSrBlocked(true);
    return false;
  }

  try {
    const seedFromExisting = !forceEmptySeedOnNextSrStartRef.current;
    forceEmptySeedOnNextSrStartRef.current = false;

    const seed = hideExtras
      ? seedFromExisting
        ? listeningTextRef.current
        : ""
      : message;
    speechBaseTextRef.current = seed ? `${seed.trimEnd()} ` : "";

    stopSpeechRecognition();
    speechRecognitionStopRequestedRef.current = false;

    srReset();
    lastSrFinalCommittedRef.current = "";

    // English-only listening: force Web Speech API to English.
    // This keeps behavior stable even if session settings include other languages.
    const forcedLocale =
      typeof languageToLocale === "function"
        ? languageToLocale("english")
        : "en-US";
    SpeechRecognition.startListening({
      continuous: true,
      language: forcedLocale,
    });

    speechRecognitionBlockedRef.current = false;
    setSrBlocked(false);

    // Mark as active for existing call sites that check this ref.
    speechRecognitionRef.current = {
      stop: () => SpeechRecognition.stopListening(),
    };

    if (!hideExtras) setRecordingState(true);
    return true;
  } catch {
    if (hideExtras) {
      speechRecognitionBlockedRef.current = true;
      setSrBlocked(true);
    }
    return false;
  }
};

export const isWebSpeechLiveUsableImpl = ({
  srCanUse,
  srMicAvailable,
  speechRecognitionDisabledRef,
  speechRecognitionBlockedRef,
} = {}) => {
  if (!srCanUse) return false;
  if (srMicAvailable === false) return false;
  if (speechRecognitionDisabledRef.current) return false;
  if (speechRecognitionBlockedRef.current) return false;
  return true;
};

export const scheduleWebSpeechRecoveryImpl = ({
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
} = {}) => {
  if (!hideExtras) return;
  if (!shouldKeepListeningRef.current) return;
  if (!isRecordingRef.current) return;
  if (!srCanUse) return;
  if (srMicAvailable === false) return;
  if (speechRecognitionDisabledRef.current) return;

  const seq = (srRecoverySeqRef.current || 0) + 1;
  srRecoverySeqRef.current = seq;

  const attempt = async () => {
    try {
      // Some browsers temporarily throw if start is called too quickly after stop.
      // Treat this as recoverable and do NOT permanently mark SR as blocked.
      speechRecognitionBlockedRef.current = false;
      setSrBlocked(false);
      await startWebSpeechRecognition({ force: true });
    } catch {
      // ignore
    }
  };

  // Attempt soon (covers Clear/AI Answer/closing modals)
  setTimeout(() => {
    if (srRecoverySeqRef.current !== seq) return;
    if (!shouldKeepListeningRef.current) return;
    if (!isRecordingRef.current) return;
    void attempt();
  }, 150);

  // Second attempt after the library/browser cools down
  setTimeout(() => {
    if (srRecoverySeqRef.current !== seq) return;
    if (!shouldKeepListeningRef.current) return;
    if (!isRecordingRef.current) return;
    if (srListeningRef.current) return;
    void attempt();
  }, 1850);
};
