import React, { useEffect, useMemo, useState } from "react";
import { X, Info } from "lucide-react";
import LanguageSelector from "./LanguageSelector";
import ModelSelector from "./ModelSelector";

const DEFAULT_STT_PROVIDER = "elevenlabs_client";
const DEFAULT_STT_MODEL = "scribe_v2_realtime";
const DEFAULT_AI_MODEL = "openai/gpt-oss-120b";

const readPersistedStt = () => {
  try {
    const p = String(localStorage.getItem("parakeet.sttProvider") || "")
      .trim()
      .toLowerCase();
    const m = String(localStorage.getItem("parakeet.sttModel") || "").trim();
    return {
      sttProvider: p || "",
      sttModel: m || "",
    };
  } catch {
    return { sttProvider: "", sttModel: "" };
  }
};

const writePersistedStt = ({ sttProvider, sttModel } = {}) => {
  try {
    if (sttProvider) localStorage.setItem("parakeet.sttProvider", sttProvider);
    if (typeof sttModel === "string")
      localStorage.setItem("parakeet.sttModel", sttModel);
  } catch {
    // ignore
  }
};

export default function ConnectModal({
  open,
  onClose,
  onBack,
  session,
  onConnect,
  isSubmitting,
}) {
  const initial = useMemo(() => {
    const persisted = readPersistedStt();

    const providerRaw =
      session?.settings?.sttProvider ||
      persisted.sttProvider ||
      DEFAULT_STT_PROVIDER;
    const provider = String(providerRaw || "")
      .trim()
      .toLowerCase();

    const modelFromSession = String(session?.settings?.sttModel || "").trim();
    const modelFromPersisted = String(persisted.sttModel || "").trim();

    const fallbackModel =
      provider === "openai"
        ? "whisper-1"
        : provider === "elevenlabs_client"
          ? DEFAULT_STT_MODEL
          : provider === "elevenlabs"
            ? "scribe_v2"
            : provider === "groq"
              ? "whisper-large-v3-turbo"
              : "";

    return {
      language: session?.settings?.language || "english",
      aiModel: session?.settings?.aiModel || DEFAULT_AI_MODEL,
      sttProvider: provider || DEFAULT_STT_PROVIDER,
      sttModel: modelFromSession || modelFromPersisted || fallbackModel,
      simpleLanguage: true,
    };
  }, [session]);

  const [language, setLanguage] = useState(initial.language);
  const [aiModel, setAiModel] = useState(initial.aiModel);
  const [sttProvider, setSttProvider] = useState(initial.sttProvider);
  const [sttModel, setSttModel] = useState(initial.sttModel);
  const [simpleLanguage, setSimpleLanguage] = useState(initial.simpleLanguage);

  useEffect(() => {
    if (!open) return;
    setLanguage(initial.language);
    setAiModel(initial.aiModel);
    setSttProvider(initial.sttProvider);
    setSttModel(initial.sttModel);
    setSimpleLanguage(initial.simpleLanguage);
  }, [
    open,
    initial.language,
    initial.aiModel,
    initial.sttProvider,
    initial.sttModel,
    initial.simpleLanguage,
  ]);

  if (!open) return null;

  const sttProviderKey = String(sttProvider || "").toLowerCase();
  const sttChoice =
    sttProviderKey === "groq" ||
    sttProviderKey === "openai" ||
    sttProviderKey === "elevenlabs" ||
    sttProviderKey === "elevenlabs_client"
      ? `${sttProviderKey}|${String(sttModel || "")}`
      : `${sttProviderKey}|`;

  const onChangeStt = (value) => {
    const raw = String(value || "");
    const [p, m] = raw.split("|");
    const provider = String(p || "")
      .trim()
      .toLowerCase();
    const model = String(m || "").trim();

    setSttProvider(provider);
    setSttModel(model);

    writePersistedStt({ sttProvider: provider, sttModel: model });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl shadow-xl">
        <div className="p-5 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between">
          <div>
            <div className="text-lg font-bold text-gray-900 dark:text-white">
              Connect
            </div>
            <div className="text-sm text-gray-600 dark:text-gray-300">
              This is an Interview Session for “{session?.job?.title || ""}” at
              “{session?.job?.company || ""}”.
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-5 space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  Language
                </label>
                <span className="inline-flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
                  <Info className="h-3.5 w-3.5" />
                  Interview language
                </span>
              </div>
              <div className="mt-2">
                <LanguageSelector value={language} onChange={setLanguage} />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  Simple
                </label>
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  Simple language
                </span>
              </div>
              <div className="mt-3 flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setSimpleLanguage((v) => !v)}
                  className={`h-7 w-12 rounded-full border transition-colors ${
                    simpleLanguage
                      ? "bg-gray-900 dark:bg-white border-gray-900 dark:border-white"
                      : "bg-gray-100 dark:bg-gray-800 border-gray-300 dark:border-gray-700"
                  }`}
                  aria-label="Toggle simple language"
                >
                  <div
                    className={`h-5 w-5 rounded-full bg-white dark:bg-gray-900 transition-transform ${
                      simpleLanguage ? "translate-x-6" : "translate-x-1"
                    }`}
                  />
                </button>
                <div className="text-sm text-gray-600 dark:text-gray-300">
                  {simpleLanguage ? "On" : "Off"}
                </div>
              </div>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                Speech to text
              </label>
              <span className="text-xs text-gray-500 dark:text-gray-400">
                Transcript provider
              </span>
            </div>
            <div className="mt-2">
              <select
                value={sttChoice}
                onChange={(e) => onChangeStt(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
              >
                <option value="assemblyai|">AssemblyAI</option>
                <option value="elevenlabs_client|scribe_v2_realtime">
                  ElevenLabs — Scribe v2 Realtime (client)
                </option>
                <option value="elevenlabs|scribe_v2">
                  ElevenLabs — Scribe v2
                </option>
                <option value="elevenlabs|scribe_v1">
                  ElevenLabs — Scribe v1
                </option>
                <option value="openai|whisper-1">OpenAI — whisper-1</option>
                <option value="groq|whisper-large-v3">
                  Groq — whisper-large-v3
                </option>
                <option value="groq|whisper-large-v3-turbo">
                  Groq — whisper-large-v3-turbo
                </option>
                <option value="webspeech|">Web Speech API (browser)</option>
                <option value="deepspeech|">Mozilla DeepSpeech (local)</option>
                <option value="fasterwhisper|">faster-whisper (local)</option>
              </select>
            </div>
          </div>

          <div>
            <ModelSelector
              value={aiModel}
              onChange={setAiModel}
              userPlan={session?.userPlan}
            />
          </div>

          <div className="rounded-xl border border-gray-200 dark:border-gray-800 p-4 text-sm text-gray-700 dark:text-gray-200">
            <div className="font-semibold mb-1">Tip</div>
            Make sure to select the “Also share tab audio” option when sharing
            your screen.
          </div>
        </div>

        <div className="p-5 border-t border-gray-200 dark:border-gray-800 flex items-center justify-between gap-3">
          <button
            onClick={typeof onBack === "function" ? onBack : onClose}
            disabled={!!isSubmitting}
            className="px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-700 text-gray-800 dark:text-gray-200 font-semibold"
          >
            Back
          </button>
          <button
            onClick={() =>
              onConnect?.(
                (() => {
                  writePersistedStt({ sttProvider, sttModel });
                  return {
                    language,
                    aiModel,
                    simpleLanguage,
                    sttProvider,
                    sttModel,
                  };
                })()
              )
            }
            disabled={!!isSubmitting}
            className="flex-1 px-4 py-2 rounded-lg bg-gray-900 text-white dark:bg-white dark:text-gray-900 font-semibold disabled:opacity-60"
          >
            {isSubmitting ? "Activating..." : "Activate and Connect"}
          </button>
        </div>
      </div>
    </div>
  );
}
