import React from "react";

export const normalizeTechTerms = (inputText) => {
  let text = String(inputText || "");
  if (!text.trim()) return text;

  const rules = [
    [/\bjava\s*script\b/gi, "JavaScript"],
    [/\btype\s*script\b/gi, "TypeScript"],
    [/\breact\s*js\b/gi, "React"],
    [/\bnode\s*js\b/gi, "Node.js"],
    [/\bnext\s*js\b/gi, "Next.js"],
    [/\bvue\s*js\b/gi, "Vue"],
    [/\bexpress\s*js\b/gi, "Express"],
    [/\bmongo\s*db\b/gi, "MongoDB"],
    [/\bpost\s*gres\b/gi, "Postgres"],
    [/\bpostgre\s*sql\b/gi, "PostgreSQL"],
    [/\bweb\s*socket\b/gi, "WebSocket"],
    [/\bgraph\s*ql\b/gi, "GraphQL"],
    [/\brest\s*api\b/gi, "REST API"],
    [/\bci\s*cd\b/gi, "CI/CD"],
    [/\bk\s*8\s*s\b/gi, "Kubernetes"],
    [/\bkubernetes\b/gi, "Kubernetes"],
    [/\bsocket\s*io\b/gi, "Socket.IO"],
  ];

  for (const [re, replacement] of rules) {
    text = text.replace(re, replacement);
  }

  return text;
};

export const formatAiAnswerText = (raw) => {
  const input = String(raw || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .trim();
  if (!input) return "";

  // Drop common noisy prefixes some models add.
  let text = input
    .replace(/^\s*(answer|final answer|response|ai answer)\s*:\s*/i, "")
    .trim();

  // Normalize bullets/numbering into Markdown.
  const lines = text.split("\n");
  const out = [];
  for (const line of lines) {
    const trimmed = line.trimStart();
    const indent = " ".repeat(line.length - trimmed.length);

    // If the model already double-prefixed list markers (e.g. "- - item" or "- • item"), collapse to a single marker.
    const doubleList = trimmed.match(/^([-–—])\s+([•*\-–—])\s+(.*)$/);
    if (doubleList) {
      out.push(`${indent}- ${doubleList[3]}`.trimEnd());
      continue;
    }

    // Convert unicode/alt bullets to "- "
    const bulletMatch = trimmed.match(/^([•*]|[-–—])\s+(.*)$/);
    if (bulletMatch) {
      out.push(`${indent}- ${bulletMatch[2]}`.trimEnd());
      continue;
    }

    // Convert "1)" or "1 -" to "1."
    const numMatch = trimmed.match(/^(\d{1,2})(\)|\s*[-–—])\s+(.*)$/);
    if (numMatch) {
      out.push(`${indent}${numMatch[1]}. ${numMatch[3]}`.trimEnd());
      continue;
    }

    out.push(line.trimEnd());
  }

  // Ensure a blank line before lists.
  const spaced = [];
  for (let i = 0; i < out.length; i += 1) {
    const cur = out[i];
    const prev = spaced.length ? spaced[spaced.length - 1] : "";
    const curIsList =
      cur.trimStart().startsWith("- ") || /^\d+\.\s+/.test(cur.trimStart());
    const prevIsList =
      prev.trimStart().startsWith("- ") || /^\d+\.\s+/.test(prev.trimStart());

    if (curIsList && prev && prev.trim() !== "" && !prevIsList) {
      spaced.push("");
    }
    spaced.push(cur);
  }

  text = spaced.join("\n");
  // Collapse excessive blank lines.
  text = text.replace(/\n{3,}/g, "\n\n").trim();
  return text;
};

export const formatParakeetToMarkdown = (parakeet) => {
  const p = parakeet && typeof parakeet === "object" ? parakeet : null;
  if (!p) return "";

  const stripLeadingListMarker = (value) => {
    let s = String(value || "").trim();
    if (!s) return "";
    // Remove repeated leading list markers that sometimes appear (e.g. "- - foo", "• foo").
    for (let i = 0; i < 3; i += 1) {
      const next = s.replace(/^\s*([•*\-–—]|\d+[.)])\s+/, "").trim();
      if (next === s) break;
      s = next;
    }
    // Also strip a stray leading quote before a list marker.
    s = s.replace(/^\s*["']\s*([•*\-–—]|\d+[.)])\s+/, "").trim();
    return s;
  };

  const wrapMongoTokensOutsideFences = (value) => {
    const src = String(value || "");
    if (!src.trim()) return "";
    const lines = src.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
    let inFence = false;
    const out = [];
    for (const line of lines) {
      const trimmed = line.trimStart();
      if (trimmed.startsWith("```")) {
        inFence = !inFence;
        out.push(line);
        continue;
      }
      if (inFence) {
        out.push(line);
        continue;
      }
      out.push(
        line.replace(/(^|[^`])(\$[a-zA-Z_]+)\b/g, (_m, p1, token) => {
          return `${p1}\`${token}\``;
        })
      );
    }
    return out.join("\n");
  };

  const compactMarkdownListItems = (value) => {
    const src = String(value || "");
    if (!src.trim()) return "";

    const lines = src.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
    let inFence = false;
    let activeListIndent = null;
    const out = [];

    const isSingleTokenLine = (line) => {
      const t = String(line || "").trim();
      if (!t) return false;
      if (t.length > 80) return false;
      if (/\s/.test(t)) return false;
      return true;
    };

    for (const line of lines) {
      const trimmed = line.trimStart();
      if (trimmed.startsWith("```")) {
        inFence = !inFence;
        activeListIndent = null;
        out.push(line.trimEnd());
        continue;
      }

      if (inFence) {
        out.push(line);
        continue;
      }

      const listMatch = line.match(/^(\s*)([-*+]|\d+\.)\s+(.*)$/);
      if (listMatch) {
        activeListIndent = listMatch[1].length;
        out.push(line.trimEnd());
        continue;
      }

      if (activeListIndent !== null) {
        if (!line.trim()) {
          continue;
        }

        const leadingSpaces = (line.match(/^(\s*)/) || [""])[1].length;
        const continuation =
          leadingSpaces > activeListIndent ||
          isSingleTokenLine(line) ||
          (/^`[^`]+`$/.test(line.trim()) && line.trim().length <= 96);

        if (continuation && out.length) {
          out[out.length - 1] =
            `${out[out.length - 1].trimEnd()} ${line.trim()}`;
          continue;
        }

        activeListIndent = null;
      }

      out.push(line.trimEnd());
    }

    return out.join("\n");
  };

  const sanitizeInline = (value) => {
    let text = String(value || "");
    if (!text.trim()) return "";

    // Remove accidental markdown code fences inside bullet strings.
    text = text.replace(/```[a-z0-9_-]*\n?/gi, "");
    text = text.replace(/```/g, "");

    // Force bullets to be single-line.
    text = text.replace(/\r\n/g, "\n");
    text = text.replace(/\r/g, "\n");
    text = text.replace(/\n+/g, " ");

    // Wrap common MongoDB pipeline stages in inline code style.
    text = text.replace(/(^|\s)(\$[a-zA-Z_]+)\b/g, (m, p1, token) => {
      // If already wrapped with backticks nearby, leave it.
      if (m.includes("`")) return m;
      return `${p1}\`${token}\``;
    });

    // Remove spaces before punctuation introduced by newline collapsing.
    text = text.replace(/\s+([,.;:!?])/g, "$1");
    text = text.replace(/\(\s+/g, "(");
    text = text.replace(/\s+\)/g, ")");

    return text.replace(/\s{2,}/g, " ").trim();
  };

  const sanitizeParagraphs = (value) => {
    const raw = String(value || "");
    if (!raw.trim()) return "";

    let text = raw;
    text = formatAiAnswerText(text);
    text = compactMarkdownListItems(text);
    text = wrapMongoTokensOutsideFences(text);

    // Tighten whitespace without destroying paragraphs.
    text = text.replace(/\s+([,.;:!?])/g, "$1");
    text = text.replace(/\(\s+/g, "(");
    text = text.replace(/\s+\)/g, ")");
    text = text.replace(/\n{3,}/g, "\n\n");
    return text.trim();
  };

  const shortDefinition = String(p.short_definition || "").trim();
  const tlDr = String(p.tl_dr || "").trim();
  const explanation = String(
    p.explanation || p.detailed_explanation || ""
  ).trim();
  const bullets = Array.isArray(p.bullets)
    ? p.bullets
        .filter(Boolean)
        .map((v) => String(v).trim())
        .filter(Boolean)
    : Array.isArray(p.key_steps)
      ? p.key_steps
          .filter(Boolean)
          .map((v) => String(v).trim())
          .filter(Boolean)
      : [];

  const code = String(p?.code_example?.code || "").trim();
  const lang = String(p?.code_example?.language || "").trim() || "javascript";

  const parts = [];
  const answerText =
    shortDefinition && tlDr && shortDefinition !== tlDr
      ? `${shortDefinition} ${tlDr}`
      : shortDefinition || tlDr || String(p.star_answer || "").trim();
  const safeAnswer = sanitizeInline(answerText);
  if (safeAnswer) parts.push(safeAnswer);

  if (bullets.length) {
    for (const b of bullets.slice(0, 12)) {
      const safe = sanitizeInline(stripLeadingListMarker(b));
      if (safe) parts.push(`- ${safe}`);
    }
  }

  if (code) {
    parts.push("");
    parts.push("```" + lang);
    parts.push(code);
    parts.push("```");
  }

  if (explanation) {
    parts.push("");
    parts.push(sanitizeParagraphs(explanation));
  }

  return parts.join("\n").trim();
};

// Minimal rich-text renderer (no markdown libs):
// - **bold** => bold
// - `keyword` => colored + bold
export const renderInlineRich = (value) => {
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

    // kind === "bold"
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

export const renderMultilineRich = (value) => {
  const text = String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
  if (!text.trim()) return null;

  const lines = text.split("\n");
  return (
    <div>
      {lines.map((line, idx) => {
        if (!String(line).trim()) {
          return <div key={`br-${idx}`} className="h-2" />;
        }
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

// Minimal JS syntax highlighting (no libs) for code blocks.
export const renderHighlightedCode = (value) => {
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

    // Line comment
    if (ch === "/" && next === "/") {
      let j = i + 2;
      while (j < src.length && src[j] !== "\n") j += 1;
      pushSpan("text-green-700 dark:text-green-400", src.slice(i, j));
      i = j;
      continue;
    }

    // Block comment
    if (ch === "/" && next === "*") {
      let j = i + 2;
      while (j < src.length - 1 && !(src[j] === "*" && src[j + 1] === "/")) {
        j += 1;
      }
      j = Math.min(src.length, j + 2);
      pushSpan("text-green-700 dark:text-green-400", src.slice(i, j));
      i = j;
      continue;
    }

    // Strings: ', ", `
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

    // Numbers
    if (isDigit(ch)) {
      let j = i + 1;
      while (j < src.length && /[0-9._]/.test(src[j])) j += 1;
      pushSpan("text-purple-700 dark:text-purple-300", src.slice(i, j));
      i = j;
      continue;
    }

    // Identifiers
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
        nodes.push(
          <React.Fragment key={`raw-${key++}`}>{ident}</React.Fragment>
        );
      }

      i = j;
      continue;
    }

    nodes.push(<React.Fragment key={`ch-${key++}`}>{ch}</React.Fragment>);
    i += 1;
  }

  return nodes;
};
