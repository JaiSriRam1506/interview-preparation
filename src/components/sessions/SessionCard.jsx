import React, { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { format } from "date-fns";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  FileText,
  Pencil,
  Trash2,
  X,
  Download,
  Loader2,
  User,
  Bot,
} from "lucide-react";
import toast from "react-hot-toast";
import { api } from "../../services/api";

const parseTranscriptText = (rawText) => {
  const text = String(rawText || "").replace(/\r\n/g, "\n");
  if (!text.trim()) return { headerLines: [], items: [], metaSummaryLine: "" };

  const lines = text.split("\n");
  const headerLines = [];
  const items = [];

  const isSeparator = (l) => /^\s*-{3,}\s*$/.test(String(l || ""));
  let i = 0;
  while (i < lines.length && !isSeparator(lines[i])) {
    const line = String(lines[i] || "").trimEnd();
    if (line) headerLines.push(line);
    i += 1;
  }
  // Skip separator line(s)
  while (i < lines.length && isSeparator(lines[i])) i += 1;

  const qStart = /^\[(?<ts>[^\]]+)\]\s*QUESTION\s*:\s*$/i;
  const aStart = /^\[(?<ts>[^\]]+)\]\s*ANSWER\s*:\s*$/i;
  const metaLine =
    /^\s*STT\s*:\s*(?<stt>[^|]+?)\s*\|\s*LLM\s*:\s*(?<llm>.+?)\s*$/i;

  let current = null;
  let mode = ""; // 'q' | 'a'

  const flush = () => {
    if (!current) return;
    const question = String(current.questionLines.join("\n")).trim();
    const answer = String(current.answerLines.join("\n")).trim();
    if (!question && !answer) {
      current = null;
      mode = "";
      return;
    }
    items.push({
      qTs: current.qTs,
      aTs: current.aTs,
      stt: current.stt,
      llm: current.llm,
      question,
      answer,
    });
    current = null;
    mode = "";
  };

  for (; i < lines.length; i += 1) {
    const lineRaw = String(lines[i] || "");
    const line = lineRaw.trimEnd();

    const q = line.match(qStart);
    const a = line.match(aStart);

    if (q) {
      flush();
      current = {
        qTs: q.groups?.ts || "",
        aTs: "",
        stt: "",
        llm: "",
        questionLines: [],
        answerLines: [],
      };
      mode = "q";
      continue;
    }

    if (a) {
      if (!current) {
        // If ANSWER appears without a QUESTION, start a new item anyway.
        current = {
          qTs: "",
          aTs: a.groups?.ts || "",
          stt: "",
          llm: "",
          questionLines: [],
          answerLines: [],
        };
      } else {
        current.aTs = a.groups?.ts || current.aTs || "";
      }
      mode = "a";
      continue;
    }

    if (!current) continue;

    const m = line.match(metaLine);
    if (m) {
      current.stt = String(m.groups?.stt || "").trim();
      current.llm = String(m.groups?.llm || "").trim();
      continue;
    }

    if (mode === "q") current.questionLines.push(lineRaw);
    else if (mode === "a") current.answerLines.push(lineRaw);
  }

  flush();

  let metaSummaryLine = "";
  for (const it of items) {
    if (it?.stt || it?.llm) {
      metaSummaryLine = `STT: ${String(it?.stt || "").trim()} | LLM: ${String(
        it?.llm || ""
      ).trim()}`.trim();
      break;
    }
  }

  return { headerLines, items, metaSummaryLine };
};

const formatClock = (ts) => {
  const s = String(ts || "").trim();
  if (!s) return "";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "";
  try {
    return format(d, "HH:mm");
  } catch {
    return "";
  }
};

// Minimal rich-text renderer (no markdown libs):
// - **bold** => bold
// - `inline code` => colorful
const renderInlineRich = (value, opts = {}) => {
  const src = String(value || "");
  if (!src) return null;

  const codeClassName =
    opts?.codeClassName ||
    "font-semibold text-primary-700 dark:text-primary-300";

  const nodes = [];
  let i = 0;
  let key = 0;

  const pushText = (t) => {
    if (!t) return;
    nodes.push(<React.Fragment key={`t-${key++}`}>{t}</React.Fragment>);
  };

  while (i < src.length) {
    const nextBacktick = src.indexOf("`", i);
    const nextBold = src.indexOf("**", i);

    let nextIdx = -1;
    let kind = "";
    if (nextBacktick >= 0 && nextBold >= 0) {
      nextIdx = Math.min(nextBacktick, nextBold);
      kind = nextIdx === nextBacktick ? "code" : "bold";
    } else if (nextBacktick >= 0) {
      nextIdx = nextBacktick;
      kind = "code";
    } else if (nextBold >= 0) {
      nextIdx = nextBold;
      kind = "bold";
    } else {
      pushText(src.slice(i));
      break;
    }

    if (nextIdx > i) pushText(src.slice(i, nextIdx));

    if (kind === "code") {
      const end = src.indexOf("`", nextIdx + 1);
      if (end < 0) {
        pushText(src.slice(nextIdx));
        break;
      }
      const inner = src.slice(nextIdx + 1, end);
      nodes.push(
        <span key={`c-${key++}`} className={codeClassName}>
          {inner}
        </span>
      );
      i = end + 1;
      continue;
    }

    const end = src.indexOf("**", nextIdx + 2);
    if (end < 0) {
      pushText(src.slice(nextIdx));
      break;
    }
    const inner = src.slice(nextIdx + 2, end);
    nodes.push(
      <span key={`b-${key++}`} className="font-semibold">
        {inner}
      </span>
    );
    i = end + 2;
  }

  return nodes;
};

const decodeHtmlEntities = (value) => {
  const src = String(value ?? "");
  if (!src) return "";

  // Common entities we see in transcripts.
  return src
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
};

const normalizeInlineLists = (value) => {
  const src = String(value ?? "");
  if (!src) return "";

  // Convert patterns like "are: * Event Loop" into a real bullet line.
  return src
    .replace(/\bare\s*:\s*\*\s+/gi, "are:\n* ")
    .replace(/\bcomponents\s+are\s*:\s*\*\s+/gi, "components are:\n* ");
};

const normalizeKeyPoints = (value) => {
  const src = String(value ?? "");
  if (!src) return "";

  const lines = src.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const out = [];
  let inKeyPoints = false;

  const isSectionStart = (line) =>
    /^\s*(Explanation\s*:|javascript|typescript|python|bash|sh|json|yaml|yml|html|css|jsx|tsx)\s*$/i.test(
      line
    );

  for (let idx = 0; idx < lines.length; idx += 1) {
    const line = lines[idx];
    const trimmed = String(line || "").trim();

    if (/^\s*Key Points\s*:\s*$/i.test(trimmed)) {
      inKeyPoints = true;
      out.push("Key Points:");
      continue;
    }

    if (inKeyPoints) {
      if (!trimmed) {
        out.push(line);
        inKeyPoints = false;
        continue;
      }
      if (isSectionStart(trimmed)) {
        inKeyPoints = false;
        out.push(line);
        continue;
      }

      if (
        !/^\s*([*-]|\d+[.)])\s+/.test(line) &&
        /^[A-Za-z][A-Za-z ]{0,40}:\s+/.test(trimmed)
      ) {
        out.push(`* ${trimmed}`);
        continue;
      }
    }

    out.push(line);
  }

  return out.join("\n");
};

const normalizeTextForRich = (value) => {
  const src = String(value ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
  return normalizeKeyPoints(normalizeInlineLists(decodeHtmlEntities(src)));
};

const renderMultilineRich = (value, opts = {}) => {
  const text = normalizeTextForRich(value);
  if (!text.trim()) return null;
  const lines = text.split("\n");

  const markerClassName =
    opts?.markerClassName || "bg-gray-400 dark:bg-gray-500";
  const numberClassName =
    opts?.numberClassName || "text-xs text-gray-600 dark:text-gray-300";

  const headingPillClassName =
    opts?.headingPillClassName ||
    "inline-flex items-center px-2 py-0.5 rounded-md border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 text-[11px] font-semibold text-gray-700 dark:text-gray-200";

  const isLikelyHeadingLabel = (label) => {
    const t = String(label || "").trim();
    if (t.length < 3 || t.length > 60) return false;
    const lower = t.toLowerCase();
    if (lower === "http" || lower === "https") return false;
    // At least 3 letters total so we don't treat weird tokens as headings.
    const letters = (t.match(/[A-Za-z]/g) || []).length;
    if (letters < 3) return false;
    return true;
  };

  const headingRe = /^(?<h>[A-Za-z][A-Za-z0-9 _\-/&]{0,59})\s*:\s*(?<rest>.*)$/;
  const mdBoldHeadingRe = /^\*\*(?<h>[^*]{2,80})\*\*\s*:\s*(?<rest>.*)$/;

  return (
    <div>
      {lines.map((line, idx) => {
        if (!String(line).trim())
          return <div key={`br-${idx}`} className="h-2" />;

        const trimmed = String(line).trim();
        const mdHeadingMatch = trimmed.match(mdBoldHeadingRe);
        const headingMatch = mdHeadingMatch || trimmed.match(headingRe);
        if (
          headingMatch?.groups?.h &&
          isLikelyHeadingLabel(headingMatch.groups.h)
        ) {
          const label = String(headingMatch.groups.h || "").replace(
            /\s+/g,
            " "
          );
          const rest = String(headingMatch.groups.rest || "").trim();
          return (
            <div
              key={`hd-${idx}`}
              className="leading-relaxed whitespace-pre-wrap"
            >
              <span className={headingPillClassName}>{label}</span>
              {rest ? (
                <span className="ml-2">{renderInlineRich(rest, opts)}</span>
              ) : null}
            </div>
          );
        }

        const bulletMatch = String(line).match(/^\s*([*\-•·])\s+(?<t>.+)$/);
        if (bulletMatch?.groups?.t) {
          return (
            <div
              key={`bl-${idx}`}
              className="leading-relaxed whitespace-pre-wrap flex gap-2"
            >
              <span
                className={`mt-2 h-1.5 w-1.5 rounded-full flex-none ${markerClassName}`}
                aria-hidden="true"
              />
              <div className="flex-1 min-w-0">
                {renderInlineRich(bulletMatch.groups.t, opts)}
              </div>
            </div>
          );
        }

        const numMatch = String(line).match(/^\s*(?<n>\d+)[.)]\s+(?<t>.+)$/);
        if (numMatch?.groups?.n && numMatch?.groups?.t) {
          return (
            <div
              key={`nl-${idx}`}
              className="leading-relaxed whitespace-pre-wrap flex gap-2"
            >
              <span className={`flex-none ${numberClassName}`} aria-hidden>
                {numMatch.groups.n}.
              </span>
              <div className="flex-1 min-w-0">
                {renderInlineRich(numMatch.groups.t, opts)}
              </div>
            </div>
          );
        }

        return (
          <div
            key={`ln-${idx}`}
            className="leading-relaxed whitespace-pre-wrap"
          >
            {renderInlineRich(line, opts)}
          </div>
        );
      })}
    </div>
  );
};

const renderHighlightedCode = (value) => {
  const src = String(value || "");
  if (!src) return null;

  const jsKeywords = new Set([
    "var",
    "let",
    "const",
    "function",
    "return",
    "if",
    "else",
    "for",
    "while",
    "do",
    "switch",
    "case",
    "break",
    "continue",
    "try",
    "catch",
    "finally",
    "throw",
    "new",
    "class",
    "extends",
    "super",
    "import",
    "from",
    "export",
    "default",
    "await",
    "async",
    "typeof",
    "instanceof",
    "in",
  ]);

  const literals = new Set(["true", "false", "null", "undefined"]);
  const isIdentStart = (ch) => /[A-Za-z_$]/.test(ch);
  const isIdent = (ch) => /[A-Za-z0-9_$]/.test(ch);
  const isDigit = (ch) => /[0-9]/.test(ch);

  const nodes = [];
  let i = 0;
  let key = 0;

  const pushSpan = (cls, text) => {
    if (!text) return;
    nodes.push(
      <span key={`tok-${key++}`} className={cls}>
        {text}
      </span>
    );
  };

  while (i < src.length) {
    const ch = src[i];
    const next = src[i + 1];

    if (ch === "/" && next === "/") {
      let j = i + 2;
      while (j < src.length && src[j] !== "\n") j += 1;
      pushSpan("text-gray-500 dark:text-gray-400", src.slice(i, j));
      i = j;
      continue;
    }

    if (ch === "/" && next === "*") {
      let j = i + 2;
      while (j < src.length - 1 && !(src[j] === "*" && src[j + 1] === "/"))
        j += 1;
      j = Math.min(src.length, j + 2);
      pushSpan("text-gray-500 dark:text-gray-400", src.slice(i, j));
      i = j;
      continue;
    }

    if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch;
      let j = i + 1;
      while (j < src.length) {
        if (src[j] === "\\") {
          j += 2;
          continue;
        }
        if (src[j] === quote) {
          j += 1;
          break;
        }
        j += 1;
      }
      pushSpan("text-emerald-700 dark:text-emerald-300", src.slice(i, j));
      i = j;
      continue;
    }

    if (isDigit(ch)) {
      let j = i + 1;
      while (j < src.length && /[0-9._]/.test(src[j])) j += 1;
      pushSpan("text-sky-700 dark:text-sky-300", src.slice(i, j));
      i = j;
      continue;
    }

    if (isIdentStart(ch)) {
      let j = i + 1;
      while (j < src.length && isIdent(src[j])) j += 1;
      const word = src.slice(i, j);
      if (jsKeywords.has(word)) {
        pushSpan("text-violet-700 dark:text-violet-300 font-semibold", word);
      } else if (literals.has(word)) {
        pushSpan("text-sky-700 dark:text-sky-300 font-semibold", word);
      } else {
        pushSpan("text-gray-900 dark:text-gray-100", word);
      }
      i = j;
      continue;
    }

    if (ch === "\n") {
      pushSpan("", "\n");
      i += 1;
      continue;
    }

    pushSpan("text-gray-700 dark:text-gray-300", ch);
    i += 1;
  }

  return nodes;
};

const splitRichBlocks = (value) => {
  const normalized = String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
  const src = normalizeTextForRich(normalized);
  if (!src.trim()) return [];

  const blocks = [];

  const splitTrailingNarrativeFromCode = (codeText) => {
    const code = String(codeText || "");
    if (!code.trim()) return { code: "", tail: "" };

    const narrativeStartRe =
      /(^|\n)\s*(Explanation|Key\s*Points|Key\s*Terms|Interview-Important\s*Points)\s*:/i;
    const atStart = code.match(
      /^\s*(Explanation|Key\s*Points|Key\s*Terms|Interview-Important\s*Points)\s*:/i
    );
    if (atStart) {
      return { code: "", tail: code.trimStart() };
    }

    // Prefer splitting on a new section heading.
    const idx = code.search(
      /\n\s*(Explanation|Key\s*Points|Key\s*Terms|Interview-Important\s*Points)\s*:/i
    );
    if (idx >= 0) {
      const codePart = code.slice(0, idx).trimEnd();
      const tail = code.slice(idx + 1).trimStart();
      return { code: codePart, tail };
    }

    // Fallback: if it contains an Explanation marker anywhere, split there.
    const idx2 = code.search(narrativeStartRe);
    if (idx2 >= 0) {
      const codePart = code.slice(0, idx2).trimEnd();
      const tail = code.slice(idx2).trimStart();
      return { code: codePart, tail };
    }

    return { code: code.trimEnd(), tail: "" };
  };

  const pushCodeBlock = (lang, codeText) => {
    const { code, tail } = splitTrailingNarrativeFromCode(codeText);
    if (code.trim())
      blocks.push({ type: "code", lang: lang || "", value: code });
    if (tail.trim()) blocks.push({ type: "text", value: tail });
  };

  // Prefer fenced code blocks if present.
  const fenceRe = /```(\w+)?\n([\s\S]*?)```/g;
  let last = 0;
  let m;
  while ((m = fenceRe.exec(src))) {
    const before = src.slice(last, m.index);
    if (before) blocks.push({ type: "text", value: before });
    pushCodeBlock(m[1] || "", m[2] || "");
    last = m.index + m[0].length;
  }
  if (last > 0) {
    const rest = src.slice(last);
    if (rest) blocks.push({ type: "text", value: rest });
    return blocks;
  }

  // Heuristic: "Code:" marker with a language line.
  const codeMarker = src.match(/(^|\n)\s*Code\s*:\s*\n/i);
  if (codeMarker) {
    const idx = codeMarker.index ?? -1;
    if (idx >= 0) {
      const before = src.slice(0, idx).trimEnd();
      const after = src.slice(idx + codeMarker[0].length);
      const lines = after.split("\n");
      let lang = "";
      let startAt = 0;
      while (startAt < lines.length && !String(lines[startAt] || "").trim())
        startAt += 1;
      if (startAt < lines.length) {
        lang = String(lines[startAt] || "").trim();
        startAt += 1;
      }
      const code = lines.slice(startAt).join("\n");
      if (before) blocks.push({ type: "text", value: before });
      if (code.trim()) pushCodeBlock(lang, code);
      return blocks;
    }
  }

  // Heuristic: standalone language label line (e.g. "javascript") followed by code.
  // Common transcript format: <text>\njavascript\n<code>\n\nExplanation:\n<text>
  const langLineRe =
    /(^|\n)\s*(?<lang>javascript|typescript|python|bash|sh|json|yaml|yml|html|css|jsx|tsx)\s*(\n|$)/i;
  const langMatch = src.match(langLineRe);
  if (langMatch?.groups?.lang && langMatch.index != null) {
    const lang = String(langMatch.groups.lang || "").trim();
    const langStart =
      langMatch.index + (langMatch[1] ? langMatch[1].length : 0);
    const before = src.slice(0, langStart).trimEnd();

    const nextNewline = src.indexOf("\n", langStart);
    const codeStart = nextNewline >= 0 ? nextNewline + 1 : src.length;
    const code = src.slice(codeStart).trimEnd();
    const looksLikeCode =
      /\b(const|let|var|function|import|export|class|def|require|console\.log)\b/.test(
        code
      ) ||
      /^\s*\/\//m.test(code) ||
      /[{}();<>]/.test(code);

    if (looksLikeCode && code.trim()) {
      if (before) blocks.push({ type: "text", value: before });
      pushCodeBlock(lang, code);
      return blocks;
    }
  }

  // Heuristic: code snippet first, then "Explanation:".
  // Many answers come as: <code>\n\nExplanation:\n<text>
  const explanationSplit = src.match(/\n\n\s*Explanation\s*:\s*(\n|\s)/i);
  if (explanationSplit?.index != null && explanationSplit.index > 0) {
    const idx = explanationSplit.index;
    const before = src.slice(0, idx).trimEnd();
    const after = src
      .slice(idx + explanationSplit[0].length)
      .replace(/^\s+/, "");
    const looksLikeCode =
      /\b(const|let|var|function|import|export|class|def)\b/.test(before) ||
      /[{}();]/.test(before) ||
      /^\s*\/\//m.test(before);
    if (looksLikeCode) {
      pushCodeBlock("", before);
      if (after) blocks.push({ type: "text", value: `Explanation:\n${after}` });
      return blocks;
    }
  }

  return [{ type: "text", value: src }];
};

const renderRichContent = (value) => {
  const blocks = splitRichBlocks(value);
  if (!blocks.length) return null;
  return (
    <div className="space-y-3">
      {blocks.map((b, idx) => {
        if (b.type === "code") {
          const lang = String(b.lang || "").trim();
          const code = String(b.value || "").replace(/\n+$/, "");
          return (
            <div key={`cb-${idx}`}>
              {lang ? (
                <div className="inline-flex items-center px-2 py-0.5 rounded-md border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 text-[11px] font-semibold text-gray-700 dark:text-gray-200 mb-2">
                  {lang}
                </div>
              ) : null}
              <pre className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 p-4 text-sm font-mono">
                <code className="whitespace-pre">
                  {renderHighlightedCode(code) || code}
                </code>
              </pre>
            </div>
          );
        }

        return (
          <div key={`tb-${idx}`} className="text-sm">
            {renderMultilineRich(b.value)}
          </div>
        );
      })}
    </div>
  );
};

export default function SessionCard({ session }) {
  const queryClient = useQueryClient();

  const endedOrExpired = useMemo(() => {
    const status = String(session?.status || "")
      .trim()
      .toLowerCase();
    const endedByStatus = ["completed", "expired", "cancelled"].includes(
      status
    );
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
  }, [session?.status, session?.isExpired, session?.expiresAt]);

  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [transcriptLoading, setTranscriptLoading] = useState(false);
  const [transcriptText, setTranscriptText] = useState("");
  const [transcriptBlob, setTranscriptBlob] = useState(null);
  const [transcriptError, setTranscriptError] = useState("");

  const parsedTranscript = useMemo(() => {
    return parseTranscriptText(transcriptText);
  }, [transcriptText]);

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
    setTranscriptError("");
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
      setTranscriptError("Failed to load transcript.");
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
      <Link
        to={`/sessions/${session._id}`}
        className="block"
        onClick={(e) => {
          if (!endedOrExpired) return;
          e.preventDefault();
          toast.error("This session has already expired.", {
            id: `session-expired-${String(session?._id || "")}`,
          });
        }}
      >
        <div className="flex items-center justify-between">
          <div>
            <div className="font-semibold text-gray-900 dark:text-white">
              {session.job?.company || "Company"} (
              {session.settings?.duration || 60} min)
              {endedOrExpired && (
                <span className="ml-2 inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700 dark:border-amber-900/40 dark:bg-amber-900/20 dark:text-amber-200">
                  Expired
                </span>
              )}
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
                ) : transcriptError ? (
                  <div className="text-sm text-red-600 dark:text-red-400">
                    {transcriptError}
                  </div>
                ) : transcriptText ? (
                  parsedTranscript?.items?.length ? (
                    <div className="space-y-4">
                      {parsedTranscript.headerLines?.length ||
                      parsedTranscript?.metaSummaryLine ? (
                        <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-3">
                          {parsedTranscript.headerLines.map((l, idx) => (
                            <div
                              key={`h-${idx}`}
                              className={
                                idx === 0
                                  ? "text-sm font-semibold text-gray-900 dark:text-white"
                                  : "text-xs text-gray-600 dark:text-gray-300"
                              }
                            >
                              {l}
                            </div>
                          ))}
                          {parsedTranscript?.metaSummaryLine ? (
                            <div className="text-xs text-gray-600 dark:text-gray-300 mt-1">
                              {parsedTranscript.metaSummaryLine}
                            </div>
                          ) : null}
                        </div>
                      ) : null}

                      <div className="space-y-6">
                        {parsedTranscript.items.map((it, idx) => {
                          const qTime = formatClock(it.qTs);
                          const aTime = formatClock(it.aTs);

                          return (
                            <div key={`t-${idx}`} className="space-y-3">
                              {it.question ? (
                                <div className="flex justify-end">
                                  <div className="max-w-3xl rounded-2xl p-4 bg-primary-500 text-white rounded-br-none">
                                    <div className="flex items-center mb-2">
                                      <div className="h-8 w-8 rounded-full flex items-center justify-center mr-3 bg-primary-600">
                                        <User className="h-4 w-4" />
                                      </div>
                                      <span className="font-semibold">
                                        Question
                                      </span>
                                      {qTime ? (
                                        <span className="text-xs opacity-75 ml-3">
                                          {qTime}
                                        </span>
                                      ) : null}
                                    </div>
                                    <div className="text-sm">
                                      {renderMultilineRich(it.question, {
                                        codeClassName:
                                          "font-semibold text-white/90",
                                        markerClassName: "bg-white/70",
                                        numberClassName:
                                          "text-xs text-white/70",
                                      })}
                                    </div>
                                  </div>
                                </div>
                              ) : null}

                              {it.answer ? (
                                <div className="flex justify-start">
                                  <div className="max-w-3xl rounded-2xl p-4 bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-white rounded-bl-none">
                                    <div className="flex items-center mb-2">
                                      <div className="h-8 w-8 rounded-full flex items-center justify-center mr-3 bg-gray-600 dark:bg-gray-600">
                                        <Bot className="h-4 w-4" />
                                      </div>
                                      <span className="font-semibold">
                                        Answer
                                      </span>
                                      {aTime ? (
                                        <span className="text-xs opacity-75 ml-3">
                                          {aTime}
                                        </span>
                                      ) : null}
                                    </div>
                                    {renderRichContent(it.answer)}
                                  </div>
                                </div>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ) : (
                    <pre className="whitespace-pre-wrap text-sm text-gray-900 dark:text-white">
                      {transcriptText}
                    </pre>
                  )
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

                  {endedOrExpired && (
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
