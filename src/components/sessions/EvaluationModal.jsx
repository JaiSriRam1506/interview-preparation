import React from "react";

export default function EvaluationModal({ open, onClose }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl shadow p-6">
        <h2 className="text-lg font-bold text-gray-900 dark:text-white">
          Session completed
        </h2>
        <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
          Transcript is ready to download. Detailed scoring can be added next.
        </p>
        <button
          onClick={onClose}
          className="mt-4 px-4 py-2 rounded-lg bg-primary-600 text-white font-semibold hover:bg-primary-700"
        >
          Close
        </button>
      </div>
    </div>
  );
}
