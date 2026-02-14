import React, { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { format } from "date-fns";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FileText, Pencil, Trash2, X, Download, Loader2 } from "lucide-react";
import toast from "react-hot-toast";
import { api } from "../../services/api";

export default function SessionCard({ session }) {
  const queryClient = useQueryClient();

  const isEnded = useMemo(
    () => ["completed", "expired", "cancelled"].includes(session?.status),
    [session?.status]
  );

  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [transcriptLoading, setTranscriptLoading] = useState(false);
  const [transcriptText, setTranscriptText] = useState("");
  const [transcriptBlob, setTranscriptBlob] = useState(null);

  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const initialEdit = useMemo(() => {
    const duration = Number(session?.settings?.duration || 60);
    const preset = [15, 30, 45, 60, 90, 120].includes(duration)
      ? String(duration)
      : "custom";
    return {
      company: String(session?.job?.company || ""),
      jobTitle: String(session?.job?.title || ""),
      jobDescription: String(session?.job?.description || ""),
      extraContext: String(session?.settings?.extraContext || ""),
      instructions: String(session?.settings?.instructions || ""),
      difficulty: String(session?.settings?.difficulty || "intermediate"),
      durationSelect: preset,
      duration: Number.isFinite(duration) ? duration : 60,
    };
  }, [session]);

  const [edit, setEdit] = useState(initialEdit);

  const patchMutation = useMutation({
    mutationFn: async (payload) => {
      const res = await api.patch(`/sessions/${session._id}`, payload);
      return res.data;
    },
    onSuccess: () => {
      toast.success("Session updated");
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
      queryClient.invalidateQueries({ queryKey: ["session", session._id] });
      setEditOpen(false);
    },
    onError: (err) => {
      toast.error(err?.response?.data?.message || "Failed to update session");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const res = await api.delete(`/sessions/${session._id}`);
      return res.data;
    },
    onSuccess: () => {
      toast.success("Session deleted");
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
      setDeleteOpen(false);
    },
    onError: (err) => {
      toast.error(err?.response?.data?.message || "Failed to delete session");
    },
  });

  const openTranscript = async () => {
    setTranscriptOpen(true);
    if (transcriptText || transcriptLoading) return;
    setTranscriptLoading(true);
    try {
      const response = await api.get(`/sessions/${session._id}/transcript`, {
        responseType: "blob",
      });

      const blob = new Blob([response.data], {
        type: response.headers?.["content-type"] || "text/plain",
      });
      const text = await blob.text();
      setTranscriptBlob(blob);
      setTranscriptText(text);
    } catch {
      toast.error("Failed to load transcript");
    } finally {
      setTranscriptLoading(false);
    }
  };

  const downloadTranscript = async () => {
    try {
      let blob = transcriptBlob;
      if (!blob) {
        const response = await api.get(`/sessions/${session._id}/transcript`, {
          responseType: "blob",
        });
        blob = new Blob([response.data], {
          type: response.headers?.["content-type"] || "text/plain",
        });
      }
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute(
        "download",
        `interview-transcript-${String(session._id || "")}.txt`
      );
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch {
      toast.error("Failed to download transcript");
    }
  };

  const openEdit = () => {
    setEdit(initialEdit);
    setEditOpen(true);
  };

  const saveEdit = () => {
    const durationNum = Number(edit.duration);
    const duration = Number.isFinite(durationNum)
      ? Math.max(15, Math.min(720, Math.floor(durationNum)))
      : 60;

    patchMutation.mutate({
      company: edit.company,
      jobTitle: edit.jobTitle,
      jobDescription: edit.jobDescription,
      extraContext: edit.extraContext,
      instructions: edit.instructions,
      difficulty: edit.difficulty,
      duration,
    });
  };

  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-4 hover:shadow transition-shadow">
      <Link to={`/sessions/${session._id}`} className="block">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-semibold text-gray-900 dark:text-white">
              {session.job?.company || "Company"} (
              {session.settings?.duration || 60} min)
            </div>
            <div className="text-sm text-gray-600 dark:text-gray-300">
              {session.job?.title || "Interview Session"}
            </div>
          </div>
          <div className="text-sm text-gray-500 dark:text-gray-400">
            {session.createdAt
              ? format(new Date(session.createdAt), "d MMM yyyy")
              : ""}
          </div>
        </div>
      </Link>

      <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-2">
        <button
          type="button"
          onClick={openTranscript}
          className="flex items-center justify-center gap-2 px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-sm font-semibold text-gray-900 dark:text-white"
        >
          <FileText className="h-4 w-4" />
          Transcript
        </button>
        <button
          type="button"
          onClick={openEdit}
          className="flex items-center justify-center gap-2 px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-sm font-semibold text-gray-900 dark:text-white"
        >
          <Pencil className="h-4 w-4" />
          Edit
        </button>
        <button
          type="button"
          onClick={() => setDeleteOpen(true)}
          className="flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-red-600 text-white hover:bg-red-700 transition-colors text-sm font-semibold"
        >
          <Trash2 className="h-4 w-4" />
          Delete
        </button>
      </div>

      {transcriptOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setTranscriptOpen(false)}
          />
          <div className="relative w-full max-w-3xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl shadow-xl overflow-hidden">
            <div className="p-4 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between">
              <div className="text-lg font-bold text-gray-900 dark:text-white">
                Transcript
              </div>
              <button
                type="button"
                onClick={() => setTranscriptOpen(false)}
                className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-4">
              <div className="flex items-center justify-end gap-2 mb-3">
                <button
                  type="button"
                  onClick={downloadTranscript}
                  className="flex items-center gap-2 px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-sm font-semibold text-gray-900 dark:text-white"
                >
                  <Download className="h-4 w-4" />
                  Download
                </button>
              </div>

              <div className="h-[60vh] overflow-y-auto rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/30 p-3">
                {transcriptLoading ? (
                  <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading...
                  </div>
                ) : transcriptText ? (
                  <pre className="whitespace-pre-wrap text-sm text-gray-900 dark:text-white">
                    {transcriptText}
                  </pre>
                ) : (
                  <div className="text-sm text-gray-600 dark:text-gray-300">
                    No transcript yet.
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {editOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() =>
              patchMutation.isPending ? null : setEditOpen(false)
            }
          />
          <div className="relative w-full max-w-3xl max-h-[90vh] bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl shadow-xl overflow-hidden flex flex-col">
            <div className="p-3 sm:p-4 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between">
              <div className="text-lg font-bold text-gray-900 dark:text-white">
                Edit Session
              </div>
              <button
                type="button"
                onClick={() => setEditOpen(false)}
                className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800"
                aria-label="Close"
                disabled={patchMutation.isPending}
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Company
                  </label>
                  <input
                    value={edit.company}
                    onChange={(e) =>
                      setEdit((p) => ({ ...p, company: e.target.value }))
                    }
                    className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Job Title
                  </label>
                  <input
                    value={edit.jobTitle}
                    onChange={(e) =>
                      setEdit((p) => ({ ...p, jobTitle: e.target.value }))
                    }
                    className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Job Description
                </label>
                <textarea
                  rows={6}
                  value={edit.jobDescription}
                  onChange={(e) =>
                    setEdit((p) => ({ ...p, jobDescription: e.target.value }))
                  }
                  className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white resize-none"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Difficulty
                  </label>
                  <select
                    value={edit.difficulty}
                    onChange={(e) =>
                      setEdit((p) => ({ ...p, difficulty: e.target.value }))
                    }
                    className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  >
                    <option value="beginner">Beginner</option>
                    <option value="intermediate">Intermediate</option>
                    <option value="advanced">Advanced</option>
                    <option value="expert">Expert</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Duration
                  </label>
                  <select
                    value={edit.durationSelect}
                    onChange={(e) => {
                      const v = e.target.value;
                      setEdit((p) => ({
                        ...p,
                        durationSelect: v,
                        duration: v === "custom" ? p.duration : Number(v || 60),
                      }));
                    }}
                    className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  >
                    <option value="15">15 min</option>
                    <option value="30">30 min</option>
                    <option value="45">45 min</option>
                    <option value="60">60 min</option>
                    <option value="90">90 min</option>
                    <option value="120">120 min</option>
                    <option value="custom">Custom</option>
                  </select>

                  {edit.durationSelect === "custom" && (
                    <input
                      type="number"
                      min={15}
                      max={720}
                      step={1}
                      value={Number(edit.duration || 0)}
                      onChange={(e) =>
                        setEdit((p) => ({
                          ...p,
                          duration: Number(e.target.value || 0),
                        }))
                      }
                      className="mt-2 w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                      placeholder="Enter minutes (e.g., 75)"
                    />
                  )}

                  {isEnded && (
                    <div className="mt-2 text-xs text-gray-600 dark:text-gray-400">
                      Note: For ended sessions, changing Duration won’t affect
                      expiry.
                    </div>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Extra Context
                  </label>
                  <textarea
                    rows={5}
                    value={edit.extraContext}
                    onChange={(e) =>
                      setEdit((p) => ({ ...p, extraContext: e.target.value }))
                    }
                    className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white resize-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Instructions
                  </label>
                  <textarea
                    rows={5}
                    value={edit.instructions}
                    onChange={(e) =>
                      setEdit((p) => ({ ...p, instructions: e.target.value }))
                    }
                    className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white resize-none"
                  />
                </div>
              </div>
            </div>

            <div className="p-3 sm:p-4 border-t border-gray-200 dark:border-gray-800 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditOpen(false)}
                disabled={patchMutation.isPending}
                className="px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-800 text-gray-900 dark:text-white font-semibold"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={saveEdit}
                disabled={patchMutation.isPending}
                className="px-4 py-2 rounded-lg bg-primary-600 text-white font-semibold hover:bg-primary-700 disabled:opacity-50"
              >
                {patchMutation.isPending ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() =>
              deleteMutation.isPending ? null : setDeleteOpen(false)
            }
          />
          <div className="relative w-full max-w-md bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl shadow-xl overflow-hidden">
            <div className="p-4 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between">
              <div className="text-lg font-bold text-gray-900 dark:text-white">
                Delete session?
              </div>
              <button
                type="button"
                onClick={() => setDeleteOpen(false)}
                className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800"
                aria-label="Close"
                disabled={deleteMutation.isPending}
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="p-4 text-sm text-gray-600 dark:text-gray-300">
              This will permanently delete the session.
            </div>
            <div className="p-4 border-t border-gray-200 dark:border-gray-800 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteOpen(false)}
                disabled={deleteMutation.isPending}
                className="px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-800 text-gray-900 dark:text-white font-semibold"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => deleteMutation.mutate()}
                disabled={deleteMutation.isPending}
                className="px-4 py-2 rounded-lg bg-red-600 text-white font-semibold hover:bg-red-700 disabled:opacity-50"
              >
                {deleteMutation.isPending ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
