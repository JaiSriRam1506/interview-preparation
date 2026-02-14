import { api } from "./api";

export const requestParakeetAiAnswer = async ({
  sessionId,
  question,
  rawASR,
  cleaned,
}) => {
  if (!sessionId) throw new Error("sessionId is required");

  const payload = {
    question,
    rawASR,
    cleaned,
    // Ensure transcripts include Q/A for every session.
    persist: true,
  };

  const res = await api.post(
    `/sessions/${sessionId}/ai-answer/parakeet`,
    payload
  );

  const data = res.data;
  const p = data?.parakeet;
  if (p && typeof p === "object") {
    const detailed = String(p?.detailed_explanation || "").trim();
    const explanation = String(p?.explanation || "").trim();
    if (!detailed && explanation) {
      data.parakeet = { ...p, detailed_explanation: explanation };
    }
  }

  return data;
};
