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

const splitToSentences = (text) => {
  const src = normalizeNewlines(text);
  if (!src.trim()) return [];
  // Simple sentence splitter; good enough for fallback bullets.
  return src
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((s) => String(s || "").trim())
    .filter(Boolean);
};

const ensureMandatoryParakeetFields = (parakeet) => {
  const pk = parakeet && typeof parakeet === "object" ? { ...parakeet } : {};

  const shortDef = String(pk.short_definition || "").trim();
  let explanation = String(pk.explanation || pk.detailed_explanation || "").trim();
  if (!explanation) explanation = shortDef;

  // Bullets are mandatory for the UX; if missing, derive from explanation.
  let bullets = Array.isArray(pk.bullets) ? pk.bullets : [];
  bullets = bullets.map((b) => String(b || "").trim()).filter(Boolean);
  if (bullets.length === 0 && explanation) {
    const sentences = splitToSentences(explanation);
    const derived = [];
    for (const s of sentences) {
      const clean = s.replace(/^[-•\s]+/, "").trim();
      if (!clean) continue;
      if (clean.length < 12) continue;
      derived.push(clean);
      if (derived.length >= 4) break;
    }
    if (derived.length) bullets = derived;
  }

  pk.explanation = explanation;
  pk.detailed_explanation = String(pk.detailed_explanation || explanation).trim() || explanation;
  pk.bullets = bullets;

  return pk;
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

  const body = {
    model: m,
    messages: msgArr,
    temperature,
    max_completion_tokens,
    top_p,
    stream: true,
  };

  // Groq exposes some OpenAI-compatible params, but not every model accepts them.
  // `reasoning_effort` is relevant for GPT-OSS; omit it for models like Llama.
  const isGptOss = m.startsWith("openai/") && m.includes("gpt-oss");
  if (isGptOss && reasoning_effort) {
    body.reasoning_effort = reasoning_effort;
  }

  const res = await fetch(`${GROQ_OPENAI_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify(body),
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
  temperature,
  top_p,
  variation,
} = {}) => {
  const attempt = Math.max(0, Number(variation?.attempt || 0) || 0);
  const avoid = Array.isArray(variation?.avoid) ? variation.avoid : [];
  const avoidText = avoid
    .map((v) => String(v || "").trim())
    .filter(Boolean)
    .slice(-3)
    .map((v, idx) => {
      const clipped = v.length > 1400 ? `${v.slice(0, 1400)}…` : v;
      return `Previous answer ${idx + 1}:\n${clipped}`;
    })
    .join("\n\n---\n\n");

  const regenNote = attempt
    ?
      "\n\nREGENERATION MODE:\n" +
      `- Attempt: ${attempt}\n` +
      "- Create a DIFFERENT answer than the previous ones (new angle, new bullets, new code).\n" +
      "- Keep the SAME required section structure (Short/Detailed/Bullets/Code).\n" +
      "- Do NOT repeat the same bullets/code/phrases.\n"
    : "";

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
    "CRITICAL: Never output ONLY code. Even if code is requested, you MUST include all sections above.\n" +
    "CRITICAL: Do NOT start the answer with a code block. Code goes last.\n\n" +
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
    "Interviewer should NOT feel this is memorized or AI-assisted." +
    regenNote;

  const q = String(question || "").trim();
  if (!q) throw new Error("question is required");

  const userPrompt = attempt
    ?
      `${q}\n\nMake a different answer than the previous ones.\n` +
      (avoidText
        ? `\nDO NOT REPEAT these (use a different angle):\n\n${avoidText}`
        : "")
    : q;

  // Lower temperature improves format adherence on smaller models.
  const computedTemp =
    typeof temperature === "number"
      ? temperature
      : attempt
        ? Math.min(1.2, 0.9 + attempt * 0.1)
        : 0.9;
  const computedTopP = typeof top_p === "number" ? top_p : attempt ? 0.92 : 0.9;

  const runOnce = async ({ forceLowTemp } = {}) => {
    return await streamGroqChatCompletion({
      apiKey,
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: forceLowTemp ? 0.4 : computedTemp,
      top_p: forceLowTemp ? 0.85 : computedTopP,
      onToken,
      signal,
    });
  };

  const runRepair = async ({ priorText } = {}) => {
    const prior = String(priorText || "").trim();
    const repairSystem =
      systemPrompt +
      "\n\nREPAIR MODE:\n" +
      "- Your last output missed required sections. Fix it now.\n" +
      "- You MUST include Detailed explanation and Bullet points.\n" +
      "- Keep it concise and interview-ready.\n";

    const repairUser =
      `${q}\n\n` +
      "Return the full required format with ALL sections.\n" +
      (prior
        ? `\nYour previous output (do not repeat verbatim; improve structure):\n\n${prior.slice(0, 2000)}\n`
        : "");

    return await streamGroqChatCompletion({
      apiKey,
      model,
      messages: [
        { role: "system", content: repairSystem },
        { role: "user", content: repairUser },
      ],
      temperature: 0.35,
      top_p: 0.85,
      onToken,
      signal,
    });
  };

  let content = await runOnce();

  // If the model violates format and returns mostly code, retry once with stricter sampling.
  const firstParsedRaw = parseInterviewFormatToParakeet(content);
  const firstParsed = ensureMandatoryParakeetFields(firstParsedRaw);
  const looksCodeOnly =
    !String(firstParsedRaw?.short_definition || "").trim() &&
    !String(firstParsedRaw?.explanation || "").trim() &&
    (!Array.isArray(firstParsedRaw?.bullets) || firstParsedRaw.bullets.length === 0) &&
    String(firstParsedRaw?.code_example?.code || "").trim();

  if (looksCodeOnly) {
    content = await runOnce({ forceLowTemp: true });
  }

  // Repair pass: if required sections are still missing, ask the model to reformat.
  let parsedRaw = parseInterviewFormatToParakeet(content);
  let parakeet = ensureMandatoryParakeetFields(parsedRaw);

  const missingMandatory =
    !String(parakeet?.explanation || "").trim() ||
    !Array.isArray(parakeet?.bullets) ||
    parakeet.bullets.length === 0;

  if (missingMandatory) {
    const repaired = await runRepair({ priorText: content });
    parsedRaw = parseInterviewFormatToParakeet(repaired);
    const repairedPk = ensureMandatoryParakeetFields(parsedRaw);
    // Preserve code from the original response if repair omitted it.
    if (
      !String(repairedPk?.code_example?.code || "").trim() &&
      String(parakeet?.code_example?.code || "").trim()
    ) {
      repairedPk.code_example = parakeet.code_example;
    }
    parakeet = repairedPk;
    content = repaired;
  }

  // Final hard guarantee (never empty for mandatory fields).
  parakeet = ensureMandatoryParakeetFields(parakeet);
  return {
    cleaned: q,
    parakeet,
    text: content,
  };
};
