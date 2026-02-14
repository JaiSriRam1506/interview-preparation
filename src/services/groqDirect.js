const GROQ_OPENAI_BASE_URL = "https://api.groq.com/openai/v1";

const normalizeNewlines = (value) =>
  String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");

const escapeRegExp = (value) =>
  String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const stripSection = (text, heading) => {
  // Removes a section like:
  // **Heading** ... (until next blank-line + next heading OR end)
  // Also handles "Heading:" plain.
  const src = normalizeNewlines(text);
  const h = String(heading || "").trim();
  if (!h) return src;

  const re = new RegExp(
    "(^|\\n)\\s*(?:\\*\\*)?" +
      escapeRegExp(h) +
      "(?:\\*\\*)?\\s*:?.*?(?=(\\n\\s*(?:\\*\\*)?[A-Za-z][^\\n]{0,40}(?:\\*\\*)?\\s*:?)\\s*$|\\n\\s*```|$)",
    "gim"
  );
  return src.replace(re, "\n");
};

const extractFirstCodeBlock = (text) => {
  const src = normalizeNewlines(text);
  const m = src.match(/```\s*([A-Za-z0-9_-]+)?\s*\n([\s\S]*?)\n```/);
  if (!m) return { language: "", code: "", without: src };
  const language = String(m[1] || "").trim();
  const code = String(m[2] || "").trimEnd();
  const without = (src.slice(0, m.index) + src.slice(m.index + m[0].length))
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { language, code, without };
};

const parseInterviewFormatToParakeet = (raw) => {
  let text = normalizeNewlines(raw).trim();
  if (!text) {
    return {
      short_definition: "",
      explanation: "",
      detailed_explanation: "",
      bullets: [],
      code_example: { language: "js", code: "" },
    };
  }

  // Model sometimes violates prompt and repeats sections; remove known noisy sections.
  text = stripSection(text, "The code shows");

  const {
    language: codeLangRaw,
    code,
    without: withoutCode,
  } = extractFirstCodeBlock(text);

  const lines = normalizeNewlines(withoutCode).split("\n");

  const isHeading = (line) => {
    const t = String(line || "").trim();
    if (!t) return false;
    return (
      /^(?:\*\*)?short\s+explanation(?:\*\*)?\s*:?.*$/i.test(t) ||
      /^(?:\*\*)?short\s+definition(?:\*\*)?\s*:?.*$/i.test(t) ||
      /^(?:\*\*)?detailed\s+explanation(?:\*\*)?\s*:?.*$/i.test(t) ||
      /^(?:\*\*)?bullet\s+points(?:\*\*)?\s*:?.*$/i.test(t) ||
      /^(?:\*\*)?key\s+interview\s+points(?:\*\*)?\s*:?.*$/i.test(t) ||
      /^(?:\*\*)?key\s+points(?:\*\*)?\s*:?.*$/i.test(t) ||
      /^(?:\*\*)?important\s+points(?:\*\*)?\s*:?.*$/i.test(t) ||
      /^(?:\*\*)?interview[-\s]*important\s+bullets(?:\*\*)?\s*:?.*$/i.test(
        t
      ) ||
      /^(?:\*\*)?production[-\s]*grade\s+example(?:\*\*)?\s*:?.*$/i.test(t) ||
      /^(?:\*\*)?code\s+example(?:\*\*)?\s*:?.*$/i.test(t)
    );
  };

  const headingType = (line) => {
    const t = String(line || "").trim();
    if (
      /^(?:\*\*)?short\s+explanation(?:\*\*)?\s*:?.*$/i.test(t) ||
      /^(?:\*\*)?short\s+definition(?:\*\*)?\s*:?.*$/i.test(t)
    )
      return "short";
    if (/^(?:\*\*)?detailed\s+explanation(?:\*\*)?\s*:?.*$/i.test(t))
      return "detailed";
    if (
      /^(?:\*\*)?bullet\s+points(?:\*\*)?\s*:?.*$/i.test(t) ||
      /^(?:\*\*)?key\s+interview\s+points(?:\*\*)?\s*:?.*$/i.test(t) ||
      /^(?:\*\*)?key\s+points(?:\*\*)?\s*:?.*$/i.test(t) ||
      /^(?:\*\*)?important\s+points(?:\*\*)?\s*:?.*$/i.test(t) ||
      /^(?:\*\*)?interview[-\s]*important\s+bullets(?:\*\*)?\s*:?.*$/i.test(t)
    )
      return "bullets";
    return "other";
  };

  const stripHeadingPrefix = (line) => {
    // E.g. "**Short explanation**  blah" or "Short explanation: blah".
    return String(line || "")
      .trim()
      .replace(/^\*\*?\s*/g, "")
      .replace(/\s*\*\*?\s*/g, "")
      .replace(
        /^(short\s+explanation|short\s+definition|detailed\s+explanation|bullet\s+points|key\s+interview\s+points|key\s+points|important\s+points|interview[-\s]*important\s+bullets)\s*:?/i,
        ""
      )
      .trim();
  };

  let mode = "";
  const shortLines = [];
  const detailedLines = [];
  const bulletItems = [];

  const pushBullet = (value) => {
    let s = String(value || "").trim();
    if (!s) return;
    s = s.replace(/^\s*([•*\-–—]|\d+[.)])\s+/, "");
    if (!s) return;
    bulletItems.push(s);
  };

  for (let idx = 0; idx < lines.length; idx += 1) {
    const line = String(lines[idx] || "");
    const trimmed = line.trim();
    if (!trimmed) {
      if (mode === "short") shortLines.push("");
      else if (mode === "detailed") detailedLines.push("");
      continue;
    }

    if (isHeading(trimmed)) {
      const t = headingType(trimmed);
      mode = t === "other" ? "" : t;
      const inline = stripHeadingPrefix(trimmed);
      if (inline) {
        if (mode === "short") shortLines.push(inline);
        else if (mode === "detailed") detailedLines.push(inline);
        else if (mode === "bullets") pushBullet(inline);
      }
      continue;
    }

    if (mode === "bullets") {
      if (/^\s*([•*\-–—]|\d+[.)])\s+/.test(trimmed)) {
        pushBullet(trimmed);
      } else if (bulletItems.length) {
        // continuation line
        bulletItems[bulletItems.length - 1] = `${
          bulletItems[bulletItems.length - 1]
        } ${trimmed}`.trim();
      } else {
        pushBullet(trimmed);
      }
      continue;
    }

    if (mode === "short") {
      shortLines.push(trimmed);
      continue;
    }

    if (mode === "detailed") {
      detailedLines.push(line.trimEnd());
      continue;
    }
  }

  const short_definition = shortLines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const explanation = detailedLines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const language = String(codeLangRaw || "js").trim() || "js";

  return {
    short_definition,
    explanation,
    detailed_explanation: explanation,
    bullets: bulletItems,
    code_example: {
      language,
      code: String(code || "").trim(),
    },
    // Keep original for debugging if needed
    _raw: raw,
  };
};

export const streamGroqChatCompletion = async ({
  apiKey,
  model,
  messages,
  temperature = 1,
  max_completion_tokens = 8192,
  top_p = 1,
  reasoning_effort = "medium",
  signal,
  onToken,
} = {}) => {
  const key = String(apiKey || "").trim();
  if (!key) throw new Error("Missing Groq API key (VITE_GROQ_API_KEY)");
  const m = String(model || "").trim();
  if (!m) throw new Error("model is required");
  const msgArr = Array.isArray(messages) ? messages : [];

  const res = await fetch(`${GROQ_OPENAI_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: m,
      messages: msgArr,
      temperature,
      max_completion_tokens,
      top_p,
      stream: true,
      reasoning_effort,
    }),
    signal,
  });

  if (!res.ok || !res.body) {
    const errText = await res.text().catch(() => "");
    let msg = errText || `Groq request failed (HTTP ${res.status})`;
    try {
      const parsed = JSON.parse(errText);
      msg =
        parsed?.error?.message ||
        parsed?.message ||
        parsed?.error ||
        msg ||
        `Groq request failed (HTTP ${res.status})`;
    } catch {
      // ignore
    }
    const e = new Error(msg);
    e.status = res.status;
    throw e;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let out = "";

  const handleLine = (line) => {
    const t = String(line || "").trim();
    if (!t.startsWith("data:")) return;
    const payload = t.slice(5).trimStart();
    if (!payload) return;
    if (payload === "[DONE]") return "done";

    let obj;
    try {
      obj = JSON.parse(payload);
    } catch {
      return;
    }

    const delta = obj?.choices?.[0]?.delta;
    const token = String(delta?.content || "");
    if (token) {
      out += token;
      try {
        onToken?.(token, out);
      } catch {
        // ignore
      }
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // SSE event frames are newline-delimited; we only care about data lines.
    let idx;
    while ((idx = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 1);
      const r = handleLine(line);
      if (r === "done") {
        try {
          await reader.cancel();
        } catch {
          // ignore
        }
        buffer = "";
        break;
      }
    }
  }

  return out;
};

export const requestGroqDirectParakeet = async ({
  question,
  model,
  apiKey,
  onToken,
  signal,
} = {}) => {
  const systemPrompt =
    "You are the candidate in a LIVE interview for a product company.\n\n" +
    "MISSION:\n" +
    "Sound like a real engineer speaking.\n" +
    "Not a teacher. Not a book. Not AI.\n\n" +
    "PRIORITY:\n" +
    "If any rule breaks → silently fix before answering.\n" +
    "Keep English simple and natural.\n\n" +
    "STYLE:\n" +
    "- First person only.\n" +
    "- Spoken English.\n" +
    "- Short, sharp, confident.\n" +
    "- No lectures. No guidance tone.\n\n" +
    "NEVER SAY:\n" +
    '"you should", "one can", "choose based on",\n' +
    '"from my experience", "in my company",\n' +
    "or mention companies, projects, metrics.\n\n" +
    "FORMATTING RULES (VERY IMPORTANT):\n" +
    "- Do NOT use any background color, box, panel, callout, or visual container.\n" +
    "- Keep output as plain text + normal Markdown only.\n" +
    "- Highlight terms ONLY using:\n" +
    "  • **bold** for concepts\n" +
    "  • `inline code` for keywords, APIs, syntax\n" +
    "- Do NOT apply any styling that looks like UI highlighting.\n\n" +
    "FORMAT (MANDATORY):\n" +
    "1) Short explanation / definition (plain text)\n" +
    "2) Detailed explanation (types, key terms, related concepts)\n" +
    "   - Keep it readable\n" +
    "   - No background styling\n" +
    "3) Bullet points (only interview-important points)\n" +
    "4) Code example (medium production-level, well commented)\n" +
    "5) Do NOT use Key interview points AND The code shows\n\n" +
    "BULLETS:\n" +
    "- Each bullet must add new information.\n" +
    "- Focus on production thinking.\n" +
    "- Emphasize performance, scalability, security, clean design.\n\n" +
    "CODE:\n" +
    "- Only when it adds value.\n" +
    "- One code block only.\n" +
    "- Use ```js```.\n" +
    "- Medium-level production example.\n" +
    "- Explain with inline comments.\n" +
    "- No decorative formatting.\n\n" +
    "FINAL FEEL:\n" +
    "Answer must feel natural and spoken.\n" +
    "Interviewer should NOT feel this is memorized or AI-assisted.";

  const q = String(question || "").trim();
  if (!q) throw new Error("question is required");

  const content = await streamGroqChatCompletion({
    apiKey,
    model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: q },
    ],
    stream: true,
    onToken,
    signal,
  });

  const parakeet = parseInterviewFormatToParakeet(content);
  return {
    cleaned: q,
    parakeet,
    text: content,
  };
};
