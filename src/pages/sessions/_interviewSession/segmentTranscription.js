export const buildBlobFromChunksImpl = ({
  hideExtras,
  audioHeaderChunkRef,
  audioChunksRef,
  recorder,
}) => {
  const header = audioHeaderChunkRef.current;
  const chunks = audioChunksRef.current;
  const type = recorder?.mimeType || "audio/webm";
  const combined =
    hideExtras && header && chunks.length && chunks[0] === header
      ? chunks
      : hideExtras && header
        ? [header, ...chunks]
        : chunks;
  return new Blob(combined, { type });
};

export const stopSegmentImpl = async ({
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
}) => {
  if (!mediaRecorderRef.current) return;
  if (silenceStateRef.current.segmenting) return;
  silenceStateRef.current.segmenting = true;

  const currentRecorder = mediaRecorderRef.current;
  const blob = await new Promise((resolve) => {
    const onStop = () => {
      try {
        currentRecorder.removeEventListener?.("stop", onStop);
      } catch {
        // noop
      }
      resolve(buildBlobFromChunks());
    };

    try {
      currentRecorder.addEventListener?.("stop", onStop);
    } catch {
      // ignore
    }

    try {
      if (currentRecorder.state !== "inactive") currentRecorder.stop();
      else resolve(buildBlobFromChunks());
    } catch {
      resolve(buildBlobFromChunks());
    }
  });

  // Avoid sending tiny/empty blobs (common cause of 502/invalid media).
  if (!blob || blob.size < 4000) {
    audioChunksRef.current = [];
    audioHeaderChunkRef.current = null;
    silenceStateRef.current.segmenting = false;

    if (restart && isRecordingRef.current) {
      try {
        if (hideExtras) {
          mediaRecorderRef.current?.start?.(1000);
        } else {
          mediaRecorderRef.current?.start?.();
        }
      } catch {
        // noop
      }
    }
    return;
  }

  audioChunksRef.current = [];
  audioHeaderChunkRef.current = null;

  // Send to backend transcription (if configured)
  try {
    if (!serverSttDisabledRef.current) {
      lastServerSttCallAtRef.current = Date.now();
      const result = await transcribeAudioBlob(blob);
      const text = String(result?.text || "").trim();
      if (text) {
        pushTranscript(text, "mic", { broadcast: true });
        const next = `${speechBaseTextRef.current}${text} `.trimStart();
        setMessage(next);
        speechBaseTextRef.current = `${next.trimEnd()} `;
      }
    }
  } catch (err) {
    const serverMsg = err?.response?.data?.message;
    const retryAfterSeconds =
      Number(err?.response?.data?.details?.retryAfterSeconds) ||
      Number(err?.response?.data?.retryAfterSeconds) ||
      0;

    if (err?.response?.status === 501) {
      if (!hideExtras) {
        toast.error(
          serverMsg || "Speech transcription isn’t configured on the server."
        );
      }
    } else if (err?.response?.status === 429) {
      if (hideExtras) {
        const ms = Math.max(
          3000,
          Math.min(30000, (retryAfterSeconds || 3) * 1000)
        );
        serverSttBackoffUntilRef.current = Date.now() + ms;
      } else {
        toast.error(serverMsg || "Transcription rate-limited. Try again.");
      }
    } else {
      if (hideExtras) {
        // Avoid hammering /transcribe when provider/browser chunking is flaky.
        serverSttBackoffUntilRef.current = Date.now() + 5000;
      }
      if (!hideExtras) {
        toast.error(serverMsg || "Transcription failed. Try again.");
      }
    }
  }

  silenceStateRef.current.segmenting = false;

  if (restart && isRecordingRef.current) {
    try {
      if (hideExtras) {
        mediaRecorderRef.current?.start?.(1000);
      } else {
        mediaRecorderRef.current?.start?.();
      }
    } catch {
      // noop
    }
  }
};
