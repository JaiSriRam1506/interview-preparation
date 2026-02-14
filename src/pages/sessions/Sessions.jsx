import React from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../services/api";
import LoadingSpinner from "../../components/common/LoadingSpinner";
import SessionCard from "../../components/sessions/SessionCard";
import { useAuth } from "../../contexts/AuthContext";

export default function Sessions() {
  const { user } = useAuth();
  const userKey = user?._id || user?.id || user?.email || "anon";
  const { data, isLoading } = useQuery({
    queryKey: ["sessions", userKey],
    queryFn: async () => (await api.get("/sessions")).data,
    enabled: !!userKey,
  });

  if (isLoading) return <LoadingSpinner />;

  const sessions = data?.sessions || data?.data || [];

  return (
    <div className="p-4 md:p-6">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            Sessions
          </h1>
          <Link
            to="/sessions/create"
            className="px-4 py-2 rounded-lg bg-primary-600 text-white font-semibold hover:bg-primary-700"
          >
            Start
          </Link>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-4">
          {sessions.map((s) => (
            <SessionCard key={s._id} session={s} />
          ))}

          {sessions.length === 0 && (
            <div className="text-gray-600 dark:text-gray-300 bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700">
              No sessions yet. Create your first interview session.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
