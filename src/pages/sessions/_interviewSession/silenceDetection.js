export const startSilenceDetectionLoopImpl = ({
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
}) => {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;

    const audioCtx = new AudioContext();
    audioContextRef.current = audioCtx;

    const source = audioCtx.createMediaStreamSource(stream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 2048;
    analyserRef.current = analyser;
    source.connect(analyser);

    const data = new Uint8Array(analyser.fftSize);
    const loop = (ts) => {
      if (
        !isRecordingRef.current ||
        !analyserRef.current ||
        !mediaRecorderRef.current
      ) {
        return;
      }

      const st = silenceStateRef.current;
      const dt = st.lastTs ? ts - st.lastTs : 0;
      st.lastTs = ts;

      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i += 1) {
        const v = (data[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / data.length);

      const silent = rms < 0.015;
      if (silent) st.silentMs += dt;
      else st.silentMs = 0;

      if (!hideExtras) {
        const thresholdMs = 2500;
        const hasData = audioChunksRef.current.length > 0;
        if (st.silentMs > thresholdMs && hasData) {
          st.silentMs = 0;
          stopSegment({ restart: true });
        }
      } else {
        // Co-pilot: do nothing on silence.
        // Listening updates come from WebSpeech/Realtime only.
      }

      silenceRafRef.current = requestAnimationFrame(loop);
    };

    silenceRafRef.current = requestAnimationFrame(loop);
  } catch {
    // If analyser fails, recording still works.
  }
};
