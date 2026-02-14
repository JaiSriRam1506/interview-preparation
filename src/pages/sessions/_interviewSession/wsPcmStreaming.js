export const getDefaultWsPcmUrlImpl = () => {
  try {
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${proto}//${window.location.host}/api/v1/stt/stream`;
  } catch {
    return "";
  }
};

export const buildWsPcmUrlWithTokenImpl = ({
  wsPcmSttUrlEnv,
  getAccessToken,
  getDefaultWsPcmUrl = getDefaultWsPcmUrlImpl,
}) => {
  const base = wsPcmSttUrlEnv || getDefaultWsPcmUrl();
  if (!base) return "";
  const token = getAccessToken?.();
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

export const stopWsPcmStreamingImpl = ({
  sendFinalize,
  id,
  wsPcmSpeechTimerRef,
  wsPcmRef,
  setWsPcmStatus,
  wsPcmSeqRef,
  wsPcmPartialBufferRef,
  wsPcmWorkletNodeRef,
  wsPcmSourceRef,
  wsPcmSinkRef,
  wsPcmAudioCtxRef,
}) => {
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

export const wsPcmSendFinalMarkerImpl = ({
  id,
  wsPcmRef,
  wsPcmPartialBufferRef,
  wsPcmSeqRef,
  packFrame,
}) => {
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

export const wsPcmHandleWorkletMessageImpl = (
  { audioBuffer, isSpeech },
  {
    id,
    wsPcmRef,
    wsPcmPartialBufferRef,
    wsPcmSeqRef,
    wsPcmSpeechTimerRef,
    wsPcmSendFinalMarker,
    packFrame,
  }
) => {
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

export const startWsPcmStreamingImpl = async ({
  stream,
  enableWsPcmStt,
  id,
  wsPcmRef,
  sttProviderRef,
  buildWsPcmUrlWithToken,
  wsPcmErrorNotifiedRef,
  toast,
  setWsPcmLastError,
  setWsPcmStatus,
  wsPcmAudioCtxRef,
  wsPcmSourceRef,
  wsPcmWorkletNodeRef,
  wsPcmSinkRef,
  wsPcmSeqRef,
  wsPcmPartialBufferRef,
  wsPcmHandleWorkletMessage,
  makeWS,
  ignoreRealtimeUntilRef,
  lastLocalSpeechUpdateAtRef,
  pushTranscript,
  speechBaseTextRef,
  setMessage,
  stopWsPcmStreaming,
}) => {
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
      toast.error("WS STT unavailable (missing auth token).");
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
