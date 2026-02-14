import React from "react";
import { Link } from "react-router-dom";

export default function QuickActions() {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl shadow p-6">
      <h2 className="text-lg font-bold text-gray-900 dark:text-white">
        Quick actions
      </h2>
      <div className="mt-4 grid grid-cols-1 gap-3">
        <Link
          to="/sessions/create"
          className="px-4 py-3 rounded-xl bg-primary-600 text-white font-semibold hover:bg-primary-700"
        >
          Create session
        </Link>
      </div>
    </div>
  );
}
