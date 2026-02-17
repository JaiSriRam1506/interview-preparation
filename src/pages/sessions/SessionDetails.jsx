import React, { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../services/api";
import Skeleton from "../../components/common/Skeleton";
import ConnectModal from "../../components/sessions/ConnectModal";
import toast from "react-hot-toast";

export default function SessionDetails() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();

  const isSessionEndedOrExpired = (session) => {
    const status = String(session?.status || "")
      .trim()
      .toLowerCase();
    const endedByStatus = ["completed", "expired", "cancelled"].includes(
      status
    );

    // Backend exposes `isExpired` as a virtual, but be defensive.
    const expiredByVirtual = Boolean(session?.isExpired);
    let expiredByTime = false;
    try {
      if (session?.expiresAt) {
        expiredByTime = new Date(session.expiresAt).getTime() <= Date.now();
      }
    } catch {
      // ignore
    }

    return endedByStatus || expiredByVirtual || expiredByTime;
  };

  const connectMutation = useMutation({
    mutationFn: async ({ sessionStatus, settings }) => {
      const status = String(sessionStatus || "").toLowerCase();

      if (["completed", "expired", "cancelled"].includes(status)) {
        throw new Error("This session has already expired.");
      }

      if (status === "created" || status === "paused") {
        const res = await api.post(`/sessions/${id}/start`, settings);
        return res.data;
      }
      const res = await api.patch(`/sessions/${id}/settings`, settings);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["session", id] });
    },
    onError: (err) => {
      toast.error(
        err?.response?.data?.message ||
          err?.message ||
          "Failed to connect session"
      );
    },
  });

  const { data, isLoading } = useQuery({
    queryKey: ["session", id],
    queryFn: async () => (await api.get(`/sessions/${id}`)).data,
    enabled: !!id,
  });

  if (isLoading) {
    return (
      <div className="p-4 md:p-6">
        <div className="max-w-4xl mx-auto bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl shadow p-6">
          <div className="flex items-center justify-between">
            <div className="flex-1">
              <Skeleton className="h-6 w-72" rounded="rounded-lg" />
              <Skeleton className="mt-3 h-4 w-44" rounded="rounded-lg" />
            </div>
            <Skeleton className="h-10 w-28" rounded="rounded-lg" />
          </div>

          <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="rounded-xl border border-gray-200 dark:border-gray-800 p-4"
              >
                <Skeleton className="h-3 w-20" rounded="rounded-lg" />
                <Skeleton className="mt-2 h-5 w-32" rounded="rounded-lg" />
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }
  const session = data;
  if (!session) return null;

  const endedOrExpired = isSessionEndedOrExpired(session);

  return (
    <div className="p-4 md:p-6">
      <div className="max-w-4xl mx-auto bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl shadow p-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900 dark:text-white">
              {session.job?.title} at {session.job?.company}
            </h1>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
              Status: <span className="font-medium">{session.status}</span>
            </p>
          </div>
          <button
            onClick={() => {
              if (endedOrExpired) {
                toast.error("This session has already expired.", {
                  id: `session-expired-${String(id || "")}`,
                });
                return;
              }
              setOpen(true);
            }}
            className="px-4 py-2 rounded-lg bg-gray-900 text-white dark:bg-white dark:text-gray-900 font-semibold disabled:opacity-60"
            disabled={endedOrExpired}
          >
            Connect
          </button>
        </div>

        {endedOrExpired && (
          <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900/40 dark:bg-amber-900/20 dark:text-amber-200">
            This session has already expired.
          </div>
        )}

        <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
          <Info label="Language" value={session.settings?.language} />
          <Info label="AI Model" value={session.settings?.aiModel} />
          <Info label="Difficulty" value={session.settings?.difficulty} />
          <Info
            label="Duration"
            value={`${session.settings?.duration || 60} min`}
          />
        </div>
      </div>

      <ConnectModal
        open={open}
        onClose={() => setOpen(false)}
        session={session}
        isSubmitting={connectMutation.isPending}
        onConnect={async (settings) => {
          try {
            if (endedOrExpired) {
              toast.error("This session has already expired.");
              return;
            }
            await connectMutation.mutateAsync({
              sessionStatus: session?.status,
              settings,
            });
            setOpen(false);
            navigate(`/sessions/${id}/interview`);
          } catch {
            // toast handled in onError
          }
        }}
      />
    </div>
  );
}

function Info({ label, value }) {
  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-800 p-4">
      <div className="text-xs text-gray-500 dark:text-gray-400">{label}</div>
      <div className="mt-1 font-semibold text-gray-900 dark:text-white break-words">
        {String(value || "-")}
      </div>
    </div>
  );
}
