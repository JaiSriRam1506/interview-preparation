import React from "react";
import { Link } from "react-router-dom";

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-gray-50 dark:bg-gray-900">
      <div className="max-w-md w-full bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl shadow p-8 text-center">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
          404
        </h1>
        <p className="mt-2 text-gray-600 dark:text-gray-300">Page not found</p>
        <Link
          to="/dashboard"
          className="inline-block mt-6 px-4 py-2 rounded-lg bg-primary-600 text-white font-semibold hover:bg-primary-700"
        >
          Go to dashboard
        </Link>
      </div>
    </div>
  );
}
