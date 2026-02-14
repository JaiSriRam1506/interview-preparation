export const handleMediaRecorderDataAvailableImpl = ({
  evt,
  hideExtras,
  audioRingIgnoreUntilRef,
  audioHeaderChunkRef,
  audioRingRef,
  audioChunksRef,
  maxParts = 16,
}) => {
  if (!evt?.data || evt.data.size <= 0) return;

  if (hideExtras) {
    const ignoreUntil = Number(audioRingIgnoreUntilRef?.current || 0);
    if (ignoreUntil && Date.now() < ignoreUntil) return;

    // Co-pilot Option C: DO NOT call server STT in the background.
    // Only maintain a capped ring buffer for on-demand STT when user taps “AI Answer”.
    if (!audioHeaderChunkRef.current) {
      audioHeaderChunkRef.current = evt.data;
      audioRingRef.current = [evt.data];
      return;
    }

    audioRingRef.current.push(evt.data);

    const header = audioHeaderChunkRef.current;
    if (header) {
      // Ensure header stays at index 0 and is never dropped.
      if (!audioRingRef.current.length || audioRingRef.current[0] !== header) {
        audioRingRef.current = [header, ...audioRingRef.current];
      }
      if (audioRingRef.current.length > maxParts) {
        const tail = audioRingRef.current.slice(1).slice(-(maxParts - 1));
        audioRingRef.current = [header, ...tail];
      }
    } else if (audioRingRef.current.length > maxParts) {
      audioRingRef.current.splice(0, audioRingRef.current.length - maxParts);
    }

    return;
  }

  audioChunksRef.current.push(evt.data);
};
