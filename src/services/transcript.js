import { api } from "./api";

export const persistTranscriptQa = async ({
  sessionId,
  question,
  answer,
  sttProvider,
  sttModel,
  llmModel,
  provider,
}) => {
  if (!sessionId) throw new Error("sessionId is required");

  const payload = {
    question,
    answer,
    sttProvider,
    sttModel,
    llmModel,
    provider,
  };

  const res = await api.post(`/sessions/${sessionId}/transcript/qa`, payload);
  return res.data;
};

const compact = (value) => String(value || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();

export const formatParakeetForTranscript = (parakeet) => {
  if (!parakeet || typeof parakeet !== "object") return "";

  const shortDefinition = compact(parakeet?.short_definition);
  const tlDr = compact(parakeet?.tl_dr);
  const starAnswer = compact(parakeet?.star_answer);

  const headline = compact(
    shortDefinition && tlDr && shortDefinition !== tlDr
      ? `${shortDefinition} ${tlDr}`
      : shortDefinition || tlDr || starAnswer
  );

  const explanation = compact(parakeet?.detailed_explanation || parakeet?.explanation);

  const bullets = Array.isArray(parakeet?.bullets)
    ? parakeet.bullets
    : Array.isArray(parakeet?.key_steps)
      ? parakeet.key_steps
      : [];

  const code = compact(parakeet?.code_example?.code);
  const language = compact(parakeet?.code_example?.language);

  const lines = [];
  if (headline) lines.push(headline);

  if (bullets.length) {
    lines.push("");
    lines.push("Key Points:");
    for (const b of bullets) {
      const item = compact(b);
      if (item) lines.push(`- ${item}`);
    }
  }

  if (code) {
    lines.push("");
    lines.push("Code:");
    if (language) lines.push(language);
    lines.push(code);
  }

  if (explanation) {
    lines.push("");
    lines.push("Explanation:");
    lines.push(explanation);
  }

  return lines.join("\n").trim();
};
