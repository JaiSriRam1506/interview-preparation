import React from "react";

const languages = ["english"];

export default function LanguageSelector({ value, onChange }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange?.(e.target.value)}
      className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-primary-500 focus:border-transparent"
    >
      {languages.map((l) => (
        <option key={l} value={l}>
          {l.charAt(0).toUpperCase() + l.slice(1)}
        </option>
      ))}
    </select>
  );
}
