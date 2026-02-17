import React from "react";

const ALL_MODELS = [
  { id: "openai/gpt-oss-120b", label: "GPT-OSS 120B (Groq)", tag: "Smart" },
  {
    id: "llama-3.1-8b-instant",
    label: "Llama 3.1 8B Instant (Groq)",
    tag: "Fast",
  },
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
