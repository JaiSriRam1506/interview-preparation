// frontend/src/pages/sessions/_interviewSession/elevenlabsClient.js

const getDisconnectState = (scribeRef) => {
  if (!scribeRef) return null;
  if (!scribeRef.__parakeetElevenDisconnectState) {
    Object.defineProperty(scribeRef, "__parakeetElevenDisconnectState", {
      value: { promise: null },
      enumerable: false,
      configurable: false,
      writable: false,
    });
  }
  return scribeRef.__parakeetElevenDisconnectState;
};

const isAlreadyClosedAudioContextError = (err) => {
  const name = String(err?.name || "");
  const msg = String(err?.message || "");
  return (
    name === "InvalidStateError" &&
    msg.toLowerCase().includes("cannot close a closed audiocontext")
  );
};

export const stopElevenLabsClientRealtime = ({ scribeRef } = {}) => {
  const state = getDisconnectState(scribeRef);
  if (!state) return Promise.resolve();

  if (state.promise) return state.promise;

  state.promise = (async () => {
    try {
      const maybePromise = scribeRef?.current?.disconnect?.();
      await maybePromise;
    } catch (err) {
      if (!isAlreadyClosedAudioContextError(err)) {
        // ignore all errors to keep stop idempotent
      }
    } finally {
      state.promise = null;
    }
  })();

  return state.promise;
};

export const reconnectElevenLabsClientRealtime = async ({
  api,
  scribeRef,
  elevenLanguageCode,
  onBeforeReconnect,
  onAfterReconnect,
} = {}) => {
  if (!api || !scribeRef) {
    throw new Error("Missing dependencies for ElevenLabs reconnect");
  }

  if (typeof onBeforeReconnect === "function") {
    try {
      onBeforeReconnect();
    } catch {
      // ignore
    }
  }

  try {
    await stopElevenLabsClientRealtime({ scribeRef });

    const tokenResp = await api.get("/stt/elevenlabs/token");
    const token = String(tokenResp?.data?.token || "").trim();
    if (!token) {
      throw new Error("Could not fetch ElevenLabs token.");
    }

    await scribeRef.current?.connect?.({
      token,
      languageCode: elevenLanguageCode || "en",
      microphone: {
        echoCancellation: true,
        noiseSuppression: true,
      },
    });
  } finally {
    if (typeof onAfterReconnect === "function") {
      try {
        onAfterReconnect();
      } catch {
        // ignore
      }
    }
  }
};
