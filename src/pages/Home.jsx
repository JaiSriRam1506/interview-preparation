import React from "react";
import { Link } from "react-router-dom";

export default function Home() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-950 flex items-center justify-center p-6">
      <div className="max-w-xl w-full bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl shadow p-8">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
          ParakeetAI (Demo)
        </h1>
        <p className="mt-2 text-gray-600 dark:text-gray-300">
          Practice interviews with AI. Create a session, connect, and download
          transcripts.
        </p>

        <div className="mt-6 flex gap-3">
          <Link
            to="/login"
            className="px-5 py-3 rounded-lg bg-primary-600 text-white font-semibold hover:bg-primary-700"
          >
            Login
          </Link>
          <Link
            to="/register"
            className="px-5 py-3 rounded-lg border border-gray-300 dark:border-gray-700 text-gray-800 dark:text-gray-200 font-semibold"
          >
            Create account
          </Link>
        </div>
      </div>
    </div>
  );
}
