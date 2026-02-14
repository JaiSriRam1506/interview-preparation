import React, { useEffect, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { api } from "../../services/api";
import { useAuth } from "../../contexts/AuthContext";

export default function Profile() {
  const { user, refresh } = useAuth();

  const initial = useMemo(() => {
    const d = user?.profileDefaults || {};
    const a = d?.aiAnswer || {};
    return {
      name: user?.name || "",
      email: user?.email || "",
      role: user?.role || "",
      plan: user?.subscription?.plan || "",
      jobTitle: d?.jobTitle || "",
      jobDescription: d?.jobDescription || "",
      extraContext: d?.extraContext || "",
      instructions: d?.instructions || "",
      resume: d?.resume || null,
      aiAnswerDetailLevel: a?.detailLevel || "medium",
      aiAnswerIncludeCode:
        typeof a?.includeCode === "boolean" ? a.includeCode : true,
      aiAnswerIncludeExtras:
        typeof a?.includeExtras === "boolean" ? a.includeExtras : true,
      aiAnswerMaxTokens: Number(a?.maxTokens || 0) || 0,
      aiAnswerTemperature:
        typeof a?.temperature === "number"
          ? a.temperature
          : Number(a?.temperature || 0) || 0,
    };
  }, [user]);

  const [name, setName] = useState(initial.name);
  const [jobTitle, setJobTitle] = useState(initial.jobTitle);
  const [jobDescription, setJobDescription] = useState(initial.jobDescription);
  const [extraContext, setExtraContext] = useState(initial.extraContext);
  const [instructions, setInstructions] = useState(initial.instructions);
  const [resumeFile, setResumeFile] = useState(null);

  const [aiAnswerDetailLevel, setAiAnswerDetailLevel] = useState(
    initial.aiAnswerDetailLevel
  );
  const [aiAnswerIncludeCode, setAiAnswerIncludeCode] = useState(
    initial.aiAnswerIncludeCode
  );
  const [aiAnswerIncludeExtras, setAiAnswerIncludeExtras] = useState(
    initial.aiAnswerIncludeExtras
  );
  const [aiAnswerMaxTokens, setAiAnswerMaxTokens] = useState(
    String(initial.aiAnswerMaxTokens || 0)
  );
  const [aiAnswerTemperature, setAiAnswerTemperature] = useState(
    String(initial.aiAnswerTemperature || 0)
  );

  useEffect(() => {
    setName(initial.name);
    setJobTitle(initial.jobTitle);
    setJobDescription(initial.jobDescription);
    setExtraContext(initial.extraContext);
    setInstructions(initial.instructions);
    setResumeFile(null);
    setAiAnswerDetailLevel(initial.aiAnswerDetailLevel);
    setAiAnswerIncludeCode(initial.aiAnswerIncludeCode);
    setAiAnswerIncludeExtras(initial.aiAnswerIncludeExtras);
    setAiAnswerMaxTokens(String(initial.aiAnswerMaxTokens || 0));
    setAiAnswerTemperature(String(initial.aiAnswerTemperature || 0));
  }, [initial]);

  const updateMutation = useMutation({
    mutationFn: async () => {
      const formData = new FormData();
      if (name) formData.append("name", name);
      formData.append("jobTitle", jobTitle || "");
      formData.append("jobDescription", jobDescription || "");
      formData.append("extraContext", extraContext || "");
      formData.append("instructions", instructions || "");

      formData.append("aiAnswerDetailLevel", aiAnswerDetailLevel || "medium");
      formData.append(
        "aiAnswerIncludeCode",
        aiAnswerIncludeCode ? "true" : "false"
      );
      formData.append(
        "aiAnswerIncludeExtras",
        aiAnswerIncludeExtras ? "true" : "false"
      );
      formData.append("aiAnswerMaxTokens", String(aiAnswerMaxTokens || "0"));
      formData.append(
        "aiAnswerTemperature",
        String(aiAnswerTemperature || "0")
      );

      if (resumeFile) formData.append("resume", resumeFile);

      const resp = await api.patch("/users/me", formData);
      return resp.data;
    },
    onSuccess: async () => {
      toast.success("Profile saved");
      try {
        await refresh?.();
      } catch {
        // ignore
      }
      setResumeFile(null);
    },
    onError: (error) => {
      toast.error(error?.response?.data?.message || "Failed to save profile");
    },
  });

  const savedResume = initial.resume;
  const savedResumeName = String(savedResume?.filename || "");
  const savedResumeUrl = String(savedResume?.url || "");

  return (
    <div className="p-4 md:p-6">
      <div className="max-w-4xl mx-auto bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl shadow p-6">
        <h1 className="text-xl font-bold text-gray-900 dark:text-white">
          Profile
        </h1>

        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field
            label="Name"
            value={name}
            onChange={setName}
            placeholder="Your name"
          />
          <Field label="Email" value={initial.email} disabled />
          <Field label="Role" value={initial.role} disabled />
          <Field label="Plan" value={initial.plan} disabled />
        </div>

        <div className="mt-6 border-t border-gray-200 dark:border-gray-800 pt-6">
          <div className="text-base font-bold text-gray-900 dark:text-white">
            Session Defaults
          </div>
          <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">
            These values will auto-fill when you create a new session.
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4">
            <Field
              label="Job Title"
              value={jobTitle}
              onChange={setJobTitle}
              placeholder="e.g. Frontend Engineer"
            />

            <TextArea
              label="Job Description"
              value={jobDescription}
              onChange={setJobDescription}
              placeholder="Paste the job description..."
              rows={7}
            />

            <TextArea
              label="Extra Context"
              value={extraContext}
              onChange={setExtraContext}
              placeholder="Any extra context you want the AI to use..."
              rows={5}
            />

            <TextArea
              label="Instructions"
              value={instructions}
              onChange={setInstructions}
              placeholder="Formatting rules, interview style, what to focus on, etc..."
              rows={5}
            />

            <div className="rounded-xl border border-gray-200 dark:border-gray-800 p-4">
              <div className="text-sm font-semibold text-gray-900 dark:text-white">
                AI Answer Preferences
              </div>
              <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                Saved here and automatically applied to new sessions.
              </div>

              <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                <Select
                  label="Answer depth"
                  hint="Controls how detailed the AI response should be."
                  value={aiAnswerDetailLevel}
                  onChange={setAiAnswerDetailLevel}
                  options={[
                    { value: "short", label: "Short (quick + crisp)" },
                    { value: "medium", label: "Medium (balanced)" },
                    { value: "deep", label: "Deep (more detail)" },
                  ]}
                />

                <Field
                  label="Answer length (max tokens)"
                  hint="Pick a preset or type a custom number. Use 0 for auto."
                  value={aiAnswerMaxTokens}
                  onChange={setAiAnswerMaxTokens}
                  placeholder="e.g. 800"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  step={1}
                  listId="aiAnswerMaxTokensPresets"
                  datalistOptions={[
                    0, 256, 512, 800, 1000, 1500, 2000, 3000, 4000,
                  ]}
                />

                <Field
                  label="Creativity (temperature)"
                  hint="Pick a preset or type a custom value. 0 = more strict, 1 = balanced."
                  value={aiAnswerTemperature}
                  onChange={setAiAnswerTemperature}
                  placeholder="e.g. 0.2"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  max={2}
                  step={0.1}
                  listId="aiAnswerTemperaturePresets"
                  datalistOptions={[0, 0.1, 0.2, 0.4, 0.7, 1, 1.2, 1.5, 2]}
                />

                <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-4">
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    What to include
                  </div>
                  <div className="mt-3 space-y-3">
                    <Toggle
                      label="Add a code snippet (when helpful)"
                      checked={aiAnswerIncludeCode}
                      onChange={setAiAnswerIncludeCode}
                    />
                    <Toggle
                      label="Add extras (talking points, pitfalls, follow-ups)"
                      checked={aiAnswerIncludeExtras}
                      onChange={setAiAnswerIncludeExtras}
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-gray-200 dark:border-gray-800 p-4">
              <div className="text-sm font-semibold text-gray-900 dark:text-white">
                Resume
              </div>

              <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                Upload a resume to be reused as default.
              </div>

              {savedResumeUrl ? (
                <div className="mt-3 text-sm text-gray-700 dark:text-gray-200">
                  <div className="font-medium">Saved: {savedResumeName}</div>
                  <a
                    href={savedResumeUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-block mt-1 text-primary-600 dark:text-primary-400 hover:underline"
                  >
                    Download
                  </a>
                </div>
              ) : (
                <div className="mt-3 text-sm text-gray-600 dark:text-gray-300">
                  No resume saved yet.
                </div>
              )}

              <div className="mt-4">
                <input
                  type="file"
                  accept=".pdf,.docx,.txt"
                  onChange={(e) => setResumeFile(e.target.files?.[0] || null)}
                  className="block w-full text-sm text-gray-700 dark:text-gray-200"
                />
                {resumeFile ? (
                  <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                    Selected: {resumeFile.name}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </div>

        <div className="mt-6 flex items-center justify-end">
          <button
            onClick={() => updateMutation.mutate()}
            disabled={updateMutation.isPending}
            className="px-4 py-2 rounded-lg bg-gray-900 text-white dark:bg-white dark:text-gray-900 font-semibold disabled:opacity-60"
          >
            {updateMutation.isPending ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  value,
  onChange,
  placeholder,
  disabled,
  type,
  inputMode,
  min,
  max,
  step,
  listId,
  datalistOptions,
}) {
  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-800 p-4">
      <div className="text-xs text-gray-500 dark:text-gray-400">{label}</div>
      {hint ? (
        <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
          {hint}
        </div>
      ) : null}
      <input
        type={type}
        value={String(value ?? "")}
        onChange={(e) => onChange?.(e.target.value)}
        placeholder={placeholder}
        disabled={!!disabled}
        inputMode={inputMode}
        min={min}
        max={max}
        step={step}
        list={listId}
        className={`mt-2 w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white text-sm ${
          disabled ? "opacity-60" : ""
        }`}
      />
      {Array.isArray(datalistOptions) && datalistOptions.length && listId ? (
        <datalist id={listId}>
          {datalistOptions.map((v) => (
            <option key={String(v)} value={String(v)} />
          ))}
        </datalist>
      ) : null}
    </div>
  );
}

function TextArea({ label, value, onChange, placeholder, rows = 4 }) {
  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-800 p-4">
      <div className="text-xs text-gray-500 dark:text-gray-400">{label}</div>
      <textarea
        value={String(value ?? "")}
        onChange={(e) => onChange?.(e.target.value)}
        placeholder={placeholder}
        rows={rows}
        className="mt-2 w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white text-sm"
      />
    </div>
  );
}

function Select({ label, hint, value, onChange, options = [] }) {
  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-800 p-4">
      <div className="text-xs text-gray-500 dark:text-gray-400">{label}</div>
      {hint ? (
        <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
          {hint}
        </div>
      ) : null}
      <select
        value={String(value ?? "")}
        onChange={(e) => onChange?.(e.target.value)}
        className="mt-2 w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white text-sm"
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function Toggle({ label, checked, onChange }) {
  return (
    <label className="flex items-center justify-between gap-3 text-sm text-gray-900 dark:text-white">
      <span>{label}</span>
      <input
        type="checkbox"
        checked={!!checked}
        onChange={(e) => onChange?.(e.target.checked)}
        className="h-4 w-4"
      />
    </label>
  );
}
