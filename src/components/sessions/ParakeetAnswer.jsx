import React from "react";
import toast from "react-hot-toast";

// Minimal rich-text renderer (no markdown libs):
// - **bold** => bold
// - `keyword` => colored + bold
const renderInlineRich = (value) => {
  const src = String(value || "");
  if (!src) return null;

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
        <span
          key={`c-${key++}`}
          className="font-semibold text-primary-700 dark:text-primary-300"
        >
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

const renderMultilineRich = (value) => {
  const text = String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
  if (!text.trim()) return null;
  const lines = text.split("\n");
  return (
    <div>
      {lines.map((line, idx) => {
        if (!String(line).trim())
          return <div key={`br-${idx}`} className="h-2" />;
        return (
          <div
            key={`ln-${idx}`}
            className="leading-relaxed whitespace-pre-wrap"
          >
            {renderInlineRich(line)}
          </div>
        );
      })}
    </div>
  );
};

const compactListText = (value) => {
  const src = String(value || "");
  if (!src.trim()) return "";

  const lines = src.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const out = [];
  let activeBullet = false;

  const isBulletStart = (line) =>
    /^\s*([•*\-–—]|\d+[.)])\s+/.test(String(line || "").trimStart());

  const isSingleTokenLine = (line) => {
    const t = String(line || "").trim();
    if (!t) return false;
    if (t.length > 80) return false;
    if (/\s/.test(t)) return false;
    return true;
  };

  for (const line of lines) {
    if (!line.trim()) {
      if (activeBullet) continue;
      out.push("");
      continue;
    }

    if (isBulletStart(line)) {
      activeBullet = true;
      out.push(line.trim());
      continue;
    }

    if (activeBullet && out.length) {
      const continuation =
        /^\s{2,}/.test(line) ||
        isSingleTokenLine(line) ||
        /^`[^`]+`$/.test(line.trim());
      if (continuation) {
        out[out.length - 1] = `${out[out.length - 1].trimEnd()} ${line.trim()}`;
        continue;
      }
      activeBullet = false;
    }

    out.push(line.trimEnd());
  }

  return out
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\s+([,.;:!?])/g, "$1")
    .trim();
};

const copyText = async (value, label) => {
  const text = String(value || "").trim();
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${label} copied`);
  } catch {
    toast.error("Copy failed");
  }
};

const KeyList = ({ title, items }) => {
  const arr = Array.isArray(items) ? items.filter(Boolean) : [];
  if (!arr.length) return null;

  const stripLeadingBullet = (value) => {
    let s = String(value || "").trim();
    if (!s) return "";
    // Common bullet/ordered-list markers produced by LLMs.
    s = s.replace(/^\s*([•*\-–—]|\d+[.)])\s+/, "");
    return s.trim();
  };

  return (
    <div className="mt-3">
      <div className="text-sm font-semibold text-gray-900 dark:text-white">
        {title}
      </div>
      <ul className="mt-1 list-disc pl-5 text-sm text-gray-900 dark:text-white">
        {arr.map((it, i) => {
          const text = stripLeadingBullet(it);
          return (
            <li key={`${title}-${i}`} className="my-0.5">
              {renderInlineRich(text)}
            </li>
          );
        })}
      </ul>
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
      pushSpan("text-green-700 dark:text-green-400", src.slice(i, j));
      i = j;
      continue;
    }

    if (ch === "/" && next === "*") {
      let j = i + 2;
      while (j < src.length - 1 && !(src[j] === "*" && src[j + 1] === "/"))
        j += 1;
      j = Math.min(src.length, j + 2);
      pushSpan("text-green-700 dark:text-green-400", src.slice(i, j));
      i = j;
      continue;
    }

    if (ch === "'" || ch === '"' || ch === "`") {
      const quote = ch;
      let j = i + 1;
      while (j < src.length) {
        const cj = src[j];
        if (cj === "\\") {
          j += 2;
          continue;
        }
        if (cj === quote) {
          j += 1;
          break;
        }
        if (quote !== "`" && cj === "\n") break;
        j += 1;
      }
      pushSpan("text-amber-700 dark:text-amber-300", src.slice(i, j));
      i = j;
      continue;
    }

    if (isDigit(ch)) {
      let j = i + 1;
      while (j < src.length && /[0-9._]/.test(src[j])) j += 1;
      pushSpan("text-purple-700 dark:text-purple-300", src.slice(i, j));
      i = j;
      continue;
    }

    if (isIdentStart(ch)) {
      let j = i + 1;
      while (j < src.length && isIdent(src[j])) j += 1;
      const ident = src.slice(i, j);
      const lower = ident.toLowerCase();

      if (ident.startsWith("$")) {
        pushSpan("font-semibold text-primary-700 dark:text-primary-300", ident);
      } else if (jsKeywords.has(lower)) {
        pushSpan("font-semibold text-blue-700 dark:text-blue-300", ident);
      } else if (literals.has(lower)) {
        pushSpan("font-semibold text-purple-700 dark:text-purple-300", ident);
      } else {
        nodes.push(ident);
      }

      i = j;
      continue;
    }

    nodes.push(ch);
    i += 1;
  }

  return nodes;
};

export default function ParakeetAnswer({
  parakeet,
  cleaned,
  onRegenerate,
  regenerateDisabled,
}) {
  if (!parakeet) return null;

  const question = String(cleaned || parakeet?.verbatim_asr || "").trim();
  const shortDefinition = String(parakeet?.short_definition || "").trim();
  const tlDr = String(parakeet?.tl_dr || "").trim();

  const answer = String(
    shortDefinition && tlDr && shortDefinition !== tlDr
      ? `${shortDefinition} ${tlDr}`
      : shortDefinition || tlDr || parakeet?.star_answer || ""
  ).trim();

  const detailed = String(
    parakeet?.explanation || parakeet?.detailed_explanation || ""
  ).trim();
  const detailedCompact = compactListText(detailed);

  const code = String(parakeet?.code_example?.code || "").trim();
  const hasCode = Boolean(code);
  const language = String(parakeet?.code_example?.language || "").trim();

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          {question ? (
            <div className="text-sm text-gray-900 dark:text-white whitespace-pre-wrap">
              <span className="font-semibold">💬 Question</span>: {question}
            </div>
          ) : null}

          <div className="mt-3 text-sm text-gray-500 dark:text-gray-300">
            ---
          </div>

          {answer ? (
            <div className="mt-2 text-sm text-gray-900 dark:text-white whitespace-pre-wrap">
              <span className="font-semibold">⭐️ Answer</span>: {answer}
            </div>
          ) : null}
        </div>

        <div className="flex items-center gap-2">
          {answer ? (
            <button
              type="button"
              onClick={() => copyText(answer, "Answer")}
              disabled={!answer}
              className="px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-xs font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Copy
            </button>
          ) : null}
          {typeof onRegenerate === "function" ? (
            <button
              type="button"
              onClick={onRegenerate}
              disabled={!!regenerateDisabled}
              className="px-3 py-1.5 rounded-lg bg-gray-900 text-white text-xs font-semibold hover:bg-black transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Regenerate
            </button>
          ) : null}
        </div>
      </div>

      <KeyList
        title="Key Points"
        items={parakeet?.bullets || parakeet?.key_steps}
      />

      {hasCode ? (
        <div className="mt-3">
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm font-semibold text-gray-900 dark:text-white">
              💻 Code
            </div>
            <button
              type="button"
              onClick={() => copyText(code, "Code")}
              className="px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-xs font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
            >
              Copy
            </button>
          </div>
          <pre className="mt-1.5 overflow-x-hidden rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 p-2 text-xs">
            <code className="whitespace-pre-wrap break-words">
              {renderHighlightedCode(code) || code}
            </code>
          </pre>
          {language ? (
            <div className="mt-1 text-xs text-gray-500 dark:text-gray-300">
              {language}
            </div>
          ) : null}
        </div>
      ) : null}

      {detailed ? (
        <div className="mt-4">
          <div className="text-sm font-semibold text-gray-900 dark:text-white">
            💡 Explanation
          </div>
          <div className="mt-2 text-sm text-gray-900 dark:text-white">
            {renderMultilineRich(detailedCompact) || detailedCompact}
          </div>
        </div>
      ) : null}
    </div>
  );
}
