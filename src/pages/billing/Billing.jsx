import React from "react";

export default function Billing() {
  return (
    <div className="p-4 md:p-6">
      <div className="max-w-4xl mx-auto">
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl shadow p-6">
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">
            Billing
          </h1>
          <p className="mt-2 text-gray-600 dark:text-gray-300">
            Premium/billing is disabled right now.
          </p>
        </div>
      </div>
    </div>
  );
}
