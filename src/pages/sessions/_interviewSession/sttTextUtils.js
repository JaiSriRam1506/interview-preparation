// Small text utilities for realtime transcription composition.

export const normalizeSpeechText = (value) => {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trimStart();
};

// Remove the common overlap where partial/final chunks repeat a suffix of the base.
export const stripOverlapPrefix = (baseText, nextChunk) => {
  const base = normalizeSpeechText(baseText);
  const chunk = normalizeSpeechText(nextChunk);
  if (!chunk) return "";
  if (!base) return chunk;

  const baseLower = base.toLowerCase();
  const chunkLower = chunk.toLowerCase();

  const max = Math.min(80, baseLower.length, chunkLower.length);
  // Prefer longer overlaps; ignore tiny overlaps to avoid stripping real new speech.
  for (let len = max; len >= 12; len -= 1) {
    const suffix = baseLower.slice(-len);
    if (chunkLower.startsWith(suffix)) {
      return chunk.slice(len).trimStart();
    }
  }
  return chunk;
};
