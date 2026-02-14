import React from "react";

const ALL_MODELS = [
  { id: "gpt-4.1-smart", label: "GPT-4.1 Smart", tag: "Smart" },
  { id: "gpt-4.1-mini", label: "GPT-4.1 Mini", tag: "Fast" },
  { id: "gpt-5.1", label: "GPT-5.1", tag: "Smart" },
  { id: "gpt-5.1-mini", label: "GPT-5.1 Mini", tag: "Fast" },
  { id: "claude-4.5-sonnet", label: "Claude 4.5 Sonnet", tag: "Slow" },
  { id: "claude-4.5-haiku", label: "Claude 4.5 Haiku", tag: "Slow" },
  { id: "llama-3.1-8b", label: "Llama 3.1 8B (Groq)", tag: "Fast" },
  { id: "llama-3.3-70b", label: "Llama 3.3 70B (Groq)", tag: "Smart" },
  {
    id: "llama-3.1-8b-instant",
    label: "Llama 3.1 8B Instant (Groq)",
    tag: "Fast",
  },
  {
    id: "llama-3.3-70b-versatile",
    label: "Llama 3.3 70B Versatile (Groq)",
    tag: "Smart",
  },
  { id: "openai/gpt-oss-120b", label: "GPT-OSS 120B (Groq)", tag: "Smart" },
  { id: "openai/gpt-oss-20b", label: "GPT-OSS 20B (Groq)", tag: "Fast" },
  { id: "groq/compound", label: "Groq Compound", tag: "Smart" },
  { id: "groq/compound-mini", label: "Groq Compound Mini", tag: "Smart" },
];

export default function ModelSelector({ value, onChange }) {
  const allowed = ALL_MODELS;

  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
        AI Model
      </label>
      <select
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-primary-500 focus:border-transparent"
      >
        {allowed.map((m) => (
          <option key={m.id} value={m.id}>
            {m.label} ({m.tag})
          </option>
        ))}
      </select>
    </div>
  );
}
