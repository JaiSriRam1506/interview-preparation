import React from "react";

export default function ErrorFallback({ error, resetErrorBoundary }) {
  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-gray-50 dark:bg-gray-900">
      <div className="max-w-lg w-full bg-white dark:bg-gray-800 rounded-2xl shadow p-6">
        <h1 className="text-xl font-bold text-gray-900 dark:text-white">
          Something went wrong
        </h1>
        <p className="mt-2 text-sm text-gray-600 dark:text-gray-300 break-words">
          {error?.message}
        </p>
        <button
          onClick={resetErrorBoundary}
          className="mt-4 px-4 py-2 rounded-lg bg-primary-600 text-white font-medium hover:bg-primary-700"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
