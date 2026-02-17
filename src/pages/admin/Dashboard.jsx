import React from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../services/api";
import Skeleton from "../../components/common/Skeleton";

export default function AdminDashboard() {
  const { data, isLoading } = useQuery({
    queryKey: ["admin-overview"],
    queryFn: async () => (await api.get("/admin/overview")).data,
  });

  if (isLoading) {
    return (
      <div className="p-4 md:p-6">
        <div className="max-w-4xl mx-auto bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl shadow p-6">
          <Skeleton className="h-6 w-28" rounded="rounded-lg" />
          <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
            {Array.from({ length: 2 }).map((_, i) => (
              <div
                key={i}
                className="rounded-xl border border-gray-200 dark:border-gray-800 p-4"
              >
                <Skeleton className="h-3 w-16" rounded="rounded-lg" />
                <Skeleton className="mt-2 h-7 w-20" rounded="rounded-lg" />
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6">
      <div className="max-w-4xl mx-auto bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl shadow p-6">
        <h1 className="text-xl font-bold text-gray-900 dark:text-white">
          Admin
        </h1>
        <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
          <Metric label="Users" value={data?.data?.users} />
          <Metric label="Sessions" value={data?.data?.sessions} />
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value }) {
  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-800 p-4">
      <div className="text-xs text-gray-500 dark:text-gray-400">{label}</div>
      <div className="mt-1 text-2xl font-bold text-gray-900 dark:text-white">
        {value ?? 0}
      </div>
    </div>
  );
}
