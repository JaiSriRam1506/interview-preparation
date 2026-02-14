export const transcribeBufferedAudioForQuestionImpl = async ({
  srCanUse,
  srMicAvailable,
  getEffectiveSttProvider,
  listeningTextRef,
  getLastRingBlob,
  getBufferedAudioBlob,
  transcribeAudioBlob,
  getSttPromptText,
  timeoutMs = 10000,
}) => {
  // If ElevenLabs client-side realtime is active, we already have the text.
  const canUseWebSpeech = srCanUse && srMicAvailable !== false;
  const effectiveProvider = getEffectiveSttProvider({ canUseWebSpeech });
  if (effectiveProvider === "elevenlabs_client") {
    const text = String(listeningTextRef?.current || "").trim();
    if (text) return text;
  }

  // Copilot Option C: server STT only on-demand. Use only the last few seconds
  // to reduce payload size and avoid provider rate limits.
  const blob = getLastRingBlob(12) || getBufferedAudioBlob();
  if (!blob || blob.size < 4000) return "";

  // Avoid hanging too long before answering.
  const result = await Promise.race([
    transcribeAudioBlob(blob, {
      prompt: getSttPromptText(),
      correctWithAi: true,
    }),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("STT timeout")), timeoutMs)
    ),
  ]);

  return String(result?.text || "").trim();
};
