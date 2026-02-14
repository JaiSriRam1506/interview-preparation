// src/pages/sessions/CreateSession.jsx
import React, { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  Globe,
  Upload,
  FileText,
  Building,
  Briefcase,
  Sparkles,
  Loader2,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useMutation } from "@tanstack/react-query";
import { useAuth } from "../../contexts/AuthContext";
import { api } from "../../services/api";
import toast from "react-hot-toast";
import FileUpload from "../../components/common/FileUpload";
import ModelSelector from "../../components/sessions/ModelSelector";
import LanguageSelector from "../../components/sessions/LanguageSelector";
import LoadingSpinner from "../../components/common/LoadingSpinner";

const MotionDiv = motion.div;

const MAX_EXTRA_CONTEXT_CHARS = 20000;

const DEFAULT_JOB_TITLE = "Software Engineer";

const DEFAULT_JOB_DESCRIPTION = `Description 

Role: Full Stack Software Engineer (MERN + Next.js)

This role requires strong hands-on experience in building production-grade web applications using the MERN stack with a focus on scalability, performance, and clean architecture.

Backend Responsibilities
	•	Design and build RESTful APIs using Node.js and Express.js
	•	Implement authentication & authorization using JWT (access & refresh tokens)
	•	Work with MongoDB, including schema design, indexing, aggregation pipelines, pagination, and transactions
	•	Handle API performance optimization, caching, rate limiting, and security best practices
	•	Write unit and integration tests using Mocha and Chai
	•	Follow clean architecture patterns (controller, service, repository)
	•	Handle async operations, error handling, and middleware correctly

Frontend Responsibilities
	•	Build scalable React applications using functional components and hooks
	•	Implement performance optimizations (memoization, lazy loading, code splitting)
	•	Build SEO-friendly apps using Next.js with SSR, SSG, API routes, and Server Actions
	•	Work with Core Web Vitals (LCP, CLS, INP) and optimize real-world performance
	•	Implement reusable, accessible UI components
	•	Handle state using Context API / Redux when required
	•	Implement protected routes and role-based access

System & Architecture
	•	Strong understanding of system design for web applications
	•	Design scalable APIs, pagination strategies, and data flow
	•	Knowledge of cloud basics (AWS / GCP), CI/CD, and deployment concepts
	•	Understanding of DevOps basics, environment configs, and logging
	•	Experience working in Agile/Scrum teams

Expectations from Candidate
	•	Provide interview-ready answers using simple English
	•	Explain concepts with real-world examples
	•	Prefer optimized solutions over brute force
	•	For DSA: explain approach → optimized solution → time & space complexity
	•	For React/Node machine coding: write clean, production-ready code
	•	For system design: focus on high-level architecture, not low-level theory
`;

const DEFAULT_EXTRA_CONTEXT = `
You are my interview answer assistant for Product-Based Company interviews.

GOAL:
Generate SHORT, HUMAN, INTERVIEW-READY answers.
Do NOT sound like AI, book, blog, or scripted content.

ANSWER STYLE:
- Simple, spoken English (easy to say aloud)
- Short & precise (no long paragraphs)
- Natural engineer tone
- No storytelling
- No fake experience

STRICT RULES:
- NEVER mention past companies, projects, metrics, numbers
- NEVER say “from my experience”, “in my company”, etc.
- NO real-life stories unless I explicitly ask
- Avoid fancy words and over-explaining

FORMAT (MANDATORY):
1) One-line explanation
2) 4–6 crisp bullet points

TECH CONTEXT

For React, JavaScript, MERN, Node.js, Express, MongoDB, REST, GraphQL, AWS:
- Answer from PRODUCTION mindset
- Focus only on performance, scalability, security, clean architecture
- Mention best practices naturally:
  - React: memo, lazy loading, code splitting, keys, hooks
  - JS: closures, async/await, event loop
  - Backend: middleware, JWT, pagination
  - MongoDB: indexes, aggregation, schema design
  - API: caching, rate limiting
- Avoid theory-only answers

DSA RULES
- Start with brute force (1 line)
- Give optimized JS solution
- Mention time & space complexity
- Handle edge cases
- Prefer O(n) / O(log n)
- Keep explanation minimal

MACHINE CODING (React / Node)
- Production-ready code
- Simple & clean logic
- Explain in plain English
- No unnecessary libraries
- Focus on state, API handling, performance

SYSTEM DESIGN
- High-level only
- Requirements → components → data flow → scaling
- Short explanation
- No deep theory

FINAL RULE
Answers must feel SPOKEN, not read.
Interviewer should feel I understand real production systems.

Extra Context / Instructions

You are ME, a candidate answering in a LIVE INTERVIEW for a Product-Based Company.
I am NOT a teacher, tutor, or explainer.
I am answering the interviewer directly.

GOAL
Give SHORT, HUMAN, INTERVIEW-READY answers.
Answers must sound SPOKEN, not written.
No AI tone. No book tone. No lecture tone.

ANSWER STYLE (VERY STRICT)
- FIRST PERSON only (“I do…”, “I use…”, “I handle…”)
- Simple spoken English
- Short & precise
- Confident engineer tone
- No storytelling
- No over-explaining

ABSOLUTE RULES
- NEVER mention past companies, projects, metrics, numbers
- NEVER say “from my experience”
- NEVER explain like documentation
  - Avoid: “Choose based on…”, “You should…”, “One can…”
- NEVER sound like AI, blog, or book

FORMAT (MANDATORY)
1) One-line direct interview answer
2) 4–6 short bullet points

For DSA:
- Say brute force briefly
- Then optimized approach
- Provide JavaScript code
- Mention time & space complexity
- Handle edge cases

SYSTEM DESIGN
- High-level only
- Requirements → components → data flow → scaling
- Speak confidently, not academically

FINAL RULE
Every answer must feel like: “I know this and I’ve actually worked with it.”`;

const createSessionSchema = z.object({
  jobUrl: z.string().url().optional().or(z.literal("")),
  company: z.string().min(1, "Company name is required"),
  jobTitle: z.string().min(1, "Job title is required"),
  jobDescription: z
    .string()
    .min(10, "Please provide a detailed job description"),
  resume: z.instanceof(File).optional(),
  language: z.string().default("english"),
  aiModel: z.string().default("openai/gpt-oss-120b"),
  duration: z.coerce
    .number()
    .int()
    .min(15, "Duration must be at least 15 minutes")
    .max(720, "Duration must be at most 720 minutes")
    .default(60),
  extraContext: z
    .string()
    .max(
      MAX_EXTRA_CONTEXT_CHARS,
      `Extra context can be at most ${MAX_EXTRA_CONTEXT_CHARS} characters`
    )
    .optional(),
  instructions: z
    .string()
    .max(
      MAX_EXTRA_CONTEXT_CHARS,
      `Instructions can be at most ${MAX_EXTRA_CONTEXT_CHARS} characters`
    )
    .optional(),
  useProfileResume: z.boolean().default(false).optional(),
  difficulty: z
    .enum(["beginner", "intermediate", "advanced", "expert"])
    .default("intermediate"),
});

const CreateSession = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [isScraping, setIsScraping] = useState(false);
  const [scrapedData, setScrapedData] = useState(null);
  const [activeTab, setActiveTab] = useState("manual"); // 'url' or 'manual'
  const [durationSelect, setDurationSelect] = useState("60");

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(createSessionSchema),
    defaultValues: {
      language: "english",
      aiModel: "openai/gpt-oss-120b",
      difficulty: "intermediate",
      duration: 60,
      jobTitle: DEFAULT_JOB_TITLE,
      jobDescription: DEFAULT_JOB_DESCRIPTION,
      extraContext: DEFAULT_EXTRA_CONTEXT,
      instructions: "",
      useProfileResume: false,
    },
  });

  const duration = watch("duration");

  const profileAppliedRef = useRef(false);

  useEffect(() => {
    if (profileAppliedRef.current) return;
    if (!user) return;

    const d = user?.profileDefaults || {};
    if (String(d.jobTitle || "").trim()) setValue("jobTitle", d.jobTitle);
    if (String(d.jobDescription || "").trim())
      setValue("jobDescription", d.jobDescription);
    if (String(d.extraContext || "").trim())
      setValue("extraContext", d.extraContext);
    if (String(d.instructions || "").trim())
      setValue("instructions", d.instructions);
    if (d?.resume?.url) setValue("useProfileResume", true);

    // Duration: keep default unless user changes manually. If profile adds it later, sync dropdown.
    try {
      const dur = Number(watch("duration"));
      if ([15, 30, 45, 60, 90, 120].includes(dur)) {
        setDurationSelect(String(dur));
      } else if (Number.isFinite(dur) && dur >= 15) {
        setDurationSelect("custom");
      }
    } catch {
      // ignore
    }

    profileAppliedRef.current = true;
  }, [user, setValue, watch]);

  useEffect(() => {
    const dur = Number(duration);
    if ([15, 30, 45, 60, 90, 120].includes(dur)) {
      setDurationSelect(String(dur));
    } else if (Number.isFinite(dur) && dur >= 15) {
      setDurationSelect("custom");
    }
    // do not force when invalid/empty
  }, [duration]);

  // Scrape job details mutation
  const scrapeMutation = useMutation({
    mutationFn: async (url) => {
      const response = await api.post("/scrape/job", { url });
      return response.data;
    },
    onSuccess: (data) => {
      setScrapedData(data);
      setValue("company", data.company);
      setValue("jobTitle", data.title);
      setValue("jobDescription", data.description);
      setActiveTab("manual");
      toast.success("Job details scraped successfully!");
    },
    onError: (error) => {
      toast.error(
        error.response?.data?.message || "Failed to scrape job details"
      );
    },
  });

  // Create session mutation
  const createSessionMutation = useMutation({
    mutationFn: async (data) => {
      const formData = new FormData();

      // Append all fields
      Object.keys(data).forEach((key) => {
        if (key === "resume" && data[key]) {
          formData.append("resume", data[key]);
        } else if (key === "useProfileResume") {
          if (data[key]) formData.append("useProfileResume", "true");
        } else if (
          data[key] !== undefined &&
          data[key] !== null &&
          data[key] !== ""
        ) {
          formData.append(key, data[key]);
        }
      });

      const response = await api.post("/sessions", formData);
      return response.data;
    },
    onSuccess: (data) => {
      toast.success("Interview session created successfully!");
      navigate(`/sessions/${data.session._id}/interview`);
    },
    onError: (error) => {
      toast.error(error.response?.data?.message || "Failed to create session");
    },
  });

  const onSubmit = async (data) => {
    createSessionMutation.mutate(data);
  };

  const handleScrape = async (url) => {
    if (!url) {
      toast.error("Please enter a job URL");
      return;
    }

    setIsScraping(true);
    try {
      await scrapeMutation.mutateAsync(url);
    } finally {
      setIsScraping(false);
    }
  };

  const handleFileUpload = (file) => {
    setValue("resume", file);
    setValue("useProfileResume", false);
  };

  // Watch form values
  const aiModel = watch("aiModel");
  const language = watch("language");
  const difficulty = watch("difficulty");
  const useProfileResume = watch("useProfileResume");
  const savedProfileResume = user?.profileDefaults?.resume || null;

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800 p-4 md:p-6">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <MotionDiv
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-8 text-center"
        >
          <h1 className="text-3xl md:text-4xl font-bold text-gray-900 dark:text-white mb-4">
            Create Interview Session
          </h1>
          <p className="text-gray-600 dark:text-gray-300">
            Set up your practice interview with AI. Customize settings for the
            best experience.
          </p>
        </MotionDiv>

        {/* Progress Steps */}
        <MotionDiv
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.1 }}
          className="mb-8"
        >
          <div className="flex items-center justify-between relative">
            <div className="absolute top-1/2 left-0 right-0 h-0.5 bg-gray-200 dark:bg-gray-700 -translate-y-1/2 z-0" />
            {["Job Details", "AI Settings", "Review"].map((step, index) => (
              <div
                key={step}
                className="flex flex-col items-center relative z-10"
              >
                <div
                  className={`h-10 w-10 rounded-full flex items-center justify-center font-semibold mb-2 ${
                    index === 0
                      ? "bg-primary-500 text-white shadow-lg"
                      : "bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-400 border-2 border-gray-300 dark:border-gray-600"
                  }`}
                >
                  {index + 1}
                </div>
                <span
                  className={`text-sm font-medium ${
                    index === 0
                      ? "text-primary-600 dark:text-primary-400"
                      : "text-gray-500 dark:text-gray-400"
                  }`}
                >
                  {step}
                </span>
              </div>
            ))}
          </div>
        </MotionDiv>

        <form onSubmit={handleSubmit(onSubmit)}>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Left Column - Job Details */}
            <div className="lg:col-span-2">
              <MotionDiv
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.2 }}
                className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-6 mb-6"
              >
                <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-6 flex items-center">
                  <Briefcase className="h-5 w-5 mr-2" />
                  Job Details
                </h2>

                {/* Tab Navigation */}
                <div className="flex border-b border-gray-200 dark:border-gray-700 mb-6">
                  <button
                    type="button"
                    onClick={() => setActiveTab("url")}
                    className={`px-4 py-2 font-medium text-sm border-b-2 transition-colors ${
                      activeTab === "url"
                        ? "border-primary-500 text-primary-600 dark:text-primary-400"
                        : "border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
                    }`}
                  >
                    <Globe className="h-4 w-4 inline mr-2" />
                    Scrape from URL
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab("manual")}
                    className={`px-4 py-2 font-medium text-sm border-b-2 transition-colors ${
                      activeTab === "manual"
                        ? "border-primary-500 text-primary-600 dark:text-primary-400"
                        : "border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
                    }`}
                  >
                    <FileText className="h-4 w-4 inline mr-2" />
                    Enter Manually
                  </button>
                </div>

                {/* URL Scraping Tab */}
                {activeTab === "url" && (
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                        Job Post URL
                      </label>
                      <div className="flex gap-2">
                        <input
                          type="url"
                          {...register("jobUrl")}
                          placeholder="https://company.com/jobs/software-engineer"
                          className="flex-1 px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                        />
                        <button
                          type="button"
                          onClick={() => handleScrape(watch("jobUrl"))}
                          disabled={isScraping}
                          className="px-6 py-3 bg-primary-600 text-white font-semibold rounded-lg hover:bg-primary-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center"
                        >
                          {isScraping ? (
                            <Loader2 className="h-5 w-5 animate-spin" />
                          ) : (
                            <>
                              <Sparkles className="h-5 w-5 mr-2" />
                              Scrape
                            </>
                          )}
                        </button>
                      </div>
                      <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
                        Supports LinkedIn, Indeed, Glassdoor, and most job
                        boards
                      </p>
                    </div>

                    {scrapedData && (
                      <div className="mt-6 p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
                        <div className="flex items-center text-green-800 dark:text-green-300 mb-2">
                          <Sparkles className="h-5 w-5 mr-2" />
                          <span className="font-semibold">
                            Successfully scraped!
                          </span>
                        </div>
                        <p className="text-green-700 dark:text-green-400 text-sm">
                          Job details have been auto-filled below. You can edit
                          them if needed.
                        </p>
                      </div>
                    )}
                  </div>
                )}

                {/* Manual Input Fields */}
                <div className="space-y-6">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      <Building className="h-4 w-4 inline mr-1" />
                      Company Name *
                    </label>
                    <input
                      type="text"
                      {...register("company")}
                      className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                      placeholder="e.g., Google, Microsoft"
                    />
                    {errors.company && (
                      <p className="mt-1 text-sm text-red-600 dark:text-red-400">
                        {errors.company.message}
                      </p>
                    )}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      Job Title *
                    </label>
                    <input
                      type="text"
                      {...register("jobTitle")}
                      className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                      placeholder="e.g., Senior Software Engineer"
                    />
                    {errors.jobTitle && (
                      <p className="mt-1 text-sm text-red-600 dark:text-red-400">
                        {errors.jobTitle.message}
                      </p>
                    )}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      Job Description *
                    </label>
                    <textarea
                      {...register("jobDescription")}
                      rows={8}
                      className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-primary-500 focus:border-transparent resize-none"
                      placeholder="Paste the complete job description here..."
                    />
                    {errors.jobDescription && (
                      <p className="mt-1 text-sm text-red-600 dark:text-red-400">
                        {errors.jobDescription.message}
                      </p>
                    )}
                  </div>
                </div>
              </MotionDiv>

              {/* Resume Upload */}
              <MotionDiv
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.3 }}
                className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-6"
              >
                <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-6 flex items-center">
                  <Upload className="h-5 w-5 mr-2" />
                  Upload Resume (Optional)
                </h2>

                {savedProfileResume?.url ? (
                  <div className="mb-4 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-gray-900 dark:text-white truncate">
                          Saved resume:{" "}
                          {String(savedProfileResume.filename || "resume")}
                        </div>
                        <a
                          href={savedProfileResume.url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs text-primary-600 dark:text-primary-400 hover:underline"
                        >
                          Download
                        </a>
                      </div>

                      <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
                        <input
                          type="checkbox"
                          checked={!!useProfileResume}
                          onChange={(e) =>
                            setValue("useProfileResume", e.target.checked)
                          }
                        />
                        Use saved
                      </label>
                    </div>
                    <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                      Uploading a new file will use that for the session.
                    </div>
                  </div>
                ) : null}
                <FileUpload
                  onFileSelect={handleFileUpload}
                  accept=".pdf,.doc,.docx,.txt"
                  maxSize={5 * 1024 * 1024} // 5MB
                />
                <p className="mt-4 text-sm text-gray-500 dark:text-gray-400">
                  Upload your resume to help AI ask more personalized questions.
                  Supports PDF, DOC, DOCX, and TXT files (max 5MB).
                </p>
              </MotionDiv>
            </div>

            {/* Right Column - AI Settings */}
            <div className="lg:col-span-1">
              <MotionDiv
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.4 }}
                className="sticky top-6 space-y-6"
              >
                {/* AI Model Selection */}
                <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-6">
                  <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-6">
                    AI Settings
                  </h2>

                  <ModelSelector
                    value={aiModel}
                    onChange={(model) => setValue("aiModel", model)}
                    userPlan={user?.subscription?.plan}
                  />

                  <div className="mt-6">
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      Language
                    </label>
                    <LanguageSelector
                      value={language}
                      onChange={(lang) => setValue("language", lang)}
                    />
                  </div>

                  <div className="mt-6">
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      Difficulty Level
                    </label>
                    <select
                      {...register("difficulty")}
                      className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                    >
                      <option value="beginner">Beginner</option>
                      <option value="intermediate">Intermediate</option>
                      <option value="advanced">Advanced</option>
                      <option value="expert">Expert</option>
                    </select>
                  </div>

                  <div className="mt-6">
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      Duration
                    </label>
                    <select
                      value={durationSelect}
                      onChange={(e) => {
                        const v = e.target.value;
                        setDurationSelect(v);
                        if (v !== "custom") {
                          const n = Number(v);
                          if (Number.isFinite(n)) setValue("duration", n);
                        }
                      }}
                      className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                    >
                      <option value="15">15 min</option>
                      <option value="30">30 min</option>
                      <option value="45">45 min</option>
                      <option value="60">60 min</option>
                      <option value="90">90 min</option>
                      <option value="120">120 min</option>
                      <option value="custom">Custom</option>
                    </select>

                    {durationSelect === "custom" && (
                      <div className="mt-2">
                        <input
                          type="number"
                          min={15}
                          max={720}
                          step={1}
                          {...register("duration", { valueAsNumber: true })}
                          className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                          placeholder="Enter minutes (e.g., 75)"
                        />
                        {errors.duration && (
                          <p className="mt-1 text-sm text-red-600 dark:text-red-400">
                            {errors.duration.message}
                          </p>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="mt-6">
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      Extra Context
                    </label>
                    <textarea
                      {...register("extraContext")}
                      rows={4}
                      maxLength={MAX_EXTRA_CONTEXT_CHARS}
                      className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-primary-500 focus:border-transparent resize-none"
                      placeholder="e.g., You are ME, a candidate answering in a LIVE INTERVIEW..."
                    />
                    {errors.extraContext && (
                      <p className="mt-1 text-sm text-red-600 dark:text-red-400">
                        {errors.extraContext.message}
                      </p>
                    )}
                  </div>

                  <div className="mt-6">
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      Instructions
                    </label>
                    <textarea
                      {...register("instructions")}
                      rows={4}
                      maxLength={MAX_EXTRA_CONTEXT_CHARS}
                      className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-primary-500 focus:border-transparent resize-none"
                      placeholder="e.g., FORMAT: 1) one-line answer 2) 4–6 bullets. Prefer JavaScript."
                    />
                    {errors.instructions && (
                      <p className="mt-1 text-sm text-red-600 dark:text-red-400">
                        {errors.instructions.message}
                      </p>
                    )}
                  </div>
                </div>

                {/* Session Summary & Actions */}
                <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-6">
                  <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4">
                    Session Summary
                  </h3>

                  <div className="space-y-3 mb-6">
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600 dark:text-gray-400">
                        AI Model:
                      </span>
                      <span className="font-medium text-gray-900 dark:text-white">
                        {aiModel.replace(/-/g, " ").toUpperCase()}
                      </span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600 dark:text-gray-400">
                        Language:
                      </span>
                      <span className="font-medium text-gray-900 dark:text-white capitalize">
                        {language}
                      </span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600 dark:text-gray-400">
                        Difficulty:
                      </span>
                      <span className="font-medium text-gray-900 dark:text-white capitalize">
                        {difficulty}
                      </span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600 dark:text-gray-400">
                        Duration:
                      </span>
                      <span className="font-medium text-gray-900 dark:text-white">
                        {Number(duration || 60)} minutes
                      </span>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <button
                      type="submit"
                      disabled={createSessionMutation.isLoading}
                      className="w-full bg-gradient-to-r from-primary-600 to-primary-700 text-white font-semibold py-3 rounded-lg hover:from-primary-700 hover:to-primary-800 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
                    >
                      {createSessionMutation.isLoading ? (
                        <>
                          <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                          Creating Session...
                        </>
                      ) : (
                        <>
                          <Sparkles className="h-5 w-5 mr-2" />
                          Start Interview Session
                        </>
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={() => navigate("/sessions")}
                      className="w-full text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white font-medium py-3 rounded-lg border border-gray-300 dark:border-gray-600 hover:border-gray-400 dark:hover:border-gray-500 transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </MotionDiv>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};

export default CreateSession;
