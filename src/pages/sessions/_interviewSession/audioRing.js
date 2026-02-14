export const getBufferedAudioBlobImpl = ({
  audioHeaderChunkRef,
  audioRingRef,
  mediaRecorderRef,
}) => {
  const header = audioHeaderChunkRef?.current;
  const parts = audioRingRef?.current || [];
  if (!header && !parts.length) return null;

  const type = mediaRecorderRef?.current?.mimeType || "audio/webm";
  const combined =
    header && parts.length
      ? parts[0] === header
        ? parts
        : [header, ...parts]
      : header
        ? [header]
        : parts;

  return new Blob(combined, { type });
};

export const getLastRingBlobImpl = ({
  seconds = 6,
  audioHeaderChunkRef,
  audioRingRef,
  mediaRecorderRef,
} = {}) => {
  const header = audioHeaderChunkRef?.current;
  const parts = audioRingRef?.current || [];
  if (!header && !parts.length) return null;

  // MediaRecorder (webm/opus) requires an initialization/header segment.
  // If we send only tail chunks, providers often reject it as invalid media.
  const dataParts =
    header && parts.length && parts[0] === header ? parts.slice(1) : parts;

  const count = Math.max(1, Math.floor(seconds));
  const tail = dataParts.slice(-count);
  if (!tail.length) return null;

  const type = mediaRecorderRef?.current?.mimeType || "audio/webm";
  const combined = header ? [header, ...tail] : tail;
  return new Blob(combined, { type });
};
