// Small text utilities for realtime transcription composition.

export const normalizeSpeechText = (value) => {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trimStart();
};

// Remove the common overlap where partial/final chunks repeat a suffix of the base.
// Optional tuning is useful during post-clear sanitization where old prefixes can be longer.
export const stripOverlapPrefix = (
  baseText,
  nextChunk,
  { maxOverlap = 80, minOverlap = 12 } = {}
) => {
  const base = normalizeSpeechText(baseText);
  const chunk = normalizeSpeechText(nextChunk);
  if (!chunk) return "";
  if (!base) return chunk;

  const baseLower = base.toLowerCase();
  const chunkLower = chunk.toLowerCase();

  const max = Math.min(
    Number(maxOverlap) || 80,
    baseLower.length,
    chunkLower.length
  );
  const min = Math.max(1, Number(minOverlap) || 12);
  // Prefer longer overlaps; ignore tiny overlaps to avoid stripping real new speech.
  for (let len = max; len >= min; len -= 1) {
    const suffix = baseLower.slice(-len);
    if (chunkLower.startsWith(suffix)) {
      return chunk.slice(len).trimStart();
    }
  }
  return chunk;
};
