/*
  HFA AI assistant — a side panel that sends the tool's current analysis to an LLM and can apply its proposals.

  One panel for every HFA tool: provider adapters (Anthropic Claude, Google Gemini, Hugging Face Inference Providers,
  local Ollama / LM Studio / LocalAI), the model picker, streaming, Markdown rendering, foldable answers, Markdown export,
  the icon toggle (design principle 4.7) and the state without a provider.

  THIS FILE IS A COPY. The source is hfa-ds/scripts/ai-panel/ai-assist.js. Change it there and run
  `npm run sync:ai-panel` in hfa-ds to copy it into hfa-hta, hfa-bowtie and hfa-stpa (see arkitektur.md, "AI-panelen").
  What differs between the tools is configured when the tool mounts the panel, as below, never by editing a copy.

  The host tool mounts it with an adapter:

    HFAAssist.mount({
      id: "hta",                       // localStorage prefix for the per-tool settings (system prompt, panel width)
      title: "HTA analysis",
      subject: "the analysis",         // "Ask about …" in the question field
      toolbar: element,                // the "AI" toggle button is appended here
      buttonClass: "action-btn",
      systemPrompt: "…",               // editable default system prompt
      schemaPrompt: "…" | () => "…",   // appended after the (editable) system prompt: data model + patch format;
                                       // a function is called for every question (e.g. built from the analysis)
      contextLabel: "Current HTA (JSON)",
      getContext: () => object,        // the analysis sent with every question
      getScope: () => null | { label, items },   // the selection; items is sent as JSON with the question
      quickActions: [[label, prompt], …],
      inspect: (obj) => null | { title, applyLabel },   // is a ```json block in an answer something we can apply?
      apply: (obj) => string,          // apply it; returns a status message, throws on error
      snapshot: () => any, restore: (snap) => void,     // "Revert" after an applied proposal
      welcome: "Markdown",
      exportName: "hta-analysis",
    });

  Provider settings (keys, models, endpoint) are shared by the HFA tools under "hfa-ai:providers", because the tools are
  served from one origin. On first use the keys saved by the STPA workbench ("hfa-stpa:settings") are picked up.
*/
(function () {
  "use strict";

  /* ── Storage (guarded: private windows can throw) ─────────────────────── */
  const store = {
    get(k, fallback = null) { try { const v = localStorage.getItem(k); return v === null ? fallback : JSON.parse(v); } catch { return fallback; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
  };
  const PROVIDER_KEY = "hfa-ai:providers";
  const clamp = (v, lo, hi, d) => (v === null || v === undefined || v === "" || !Number.isFinite(+v)) ? d : Math.min(hi, Math.max(lo, +v));
  const el = (tag, props = {}, ...kids) => { const n = Object.assign(document.createElement(tag), props); n.append(...kids); return n; };

  function download(filename, text, type) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = Object.assign(document.createElement("a"), { href: url, download: filename });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /* ═══════════════════════════════════════════════════════════════════════
     Provider adapters (same as the STPA workbench)
     callLLM() takes a provider-neutral conversation and returns { text, raw, usage }.
     ═══════════════════════════════════════════════════════════════════════ */
  const DEFAULTS = {
    claude_model: "claude-opus-5-5",
    gemini_model: "gemini-2.5-pro",
    local_endpoint: "http://localhost:11434/v1/chat/completions",
    local_model: "llama3.1",
    claude_max_tokens: 64000,
    hf_model: "google/gemma-4-31B-it",
  };
  /* Hugging Face Inference Providers: one OpenAI-compatible router in front of the providers that serve open models.
     A model id may end in ":<provider>", ":cheapest" or ":fastest" to choose who serves it. */
  const HF_ROUTER = "https://router.huggingface.co/v1";
  const HF_MODELS = ["google/gemma-4-31B-it", "google/gemma-3-27b-it", "Qwen/Qwen3-32B", "meta-llama/Llama-3.3-70B-Instruct"];

  /* maxOut caps max_tokens; effort lists the accepted levels (null: don't send output_config); fallback marks the
     models that take server-side refusal fallback (fallbacks: "default"). */
  const EFFORT_ALL = ["low", "medium", "high", "xhigh", "max"], EFFORT_46 = ["low", "medium", "high", "max"];
  const CLAUDE_MODELS = [
    { id: "claude-fable-5-1", family: "Fable", label: "Fable 5.1", maxOut: 128000, effort: EFFORT_ALL, fallback: true },
    { id: "claude-fable-5", family: "Fable", label: "Fable 5", maxOut: 128000, effort: EFFORT_ALL },
    { id: "claude-opus-5-5", family: "Opus", label: "Opus 5.5", maxOut: 128000, effort: EFFORT_ALL, fallback: true },
    { id: "claude-opus-5", family: "Opus", label: "Opus 5", maxOut: 128000, effort: EFFORT_ALL, fallback: true },
    { id: "claude-opus-4-8", family: "Opus", label: "Opus 4.8", maxOut: 128000, effort: EFFORT_ALL },
    { id: "claude-opus-4-7", family: "Opus", label: "Opus 4.7", maxOut: 128000, effort: EFFORT_ALL },
    { id: "claude-opus-4-6", family: "Opus", label: "Opus 4.6", maxOut: 128000, effort: EFFORT_46 },
    { id: "claude-sonnet-5-5", family: "Sonnet", label: "Sonnet 5.5", maxOut: 128000, effort: EFFORT_ALL, fallback: true },
    { id: "claude-sonnet-5", family: "Sonnet", label: "Sonnet 5", maxOut: 128000, effort: EFFORT_ALL },
    { id: "claude-sonnet-4-6", family: "Sonnet", label: "Sonnet 4.6", maxOut: 128000, effort: EFFORT_46 },
    { id: "claude-haiku-5-5", family: "Haiku", label: "Haiku 5.5", maxOut: 128000, effort: EFFORT_ALL },
    { id: "claude-haiku-4-5", family: "Haiku", label: "Haiku 4.5", maxOut: 64000, effort: null },
  ];
  const GEMINI_MODELS = ["gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.5-flash-lite"];
  const CLAUDE_HEADERS = (key) => ({ "x-api-key": key, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" });

  let settings = {};

  /** Read an Anthropic SSE stream into { content, stop_reason, stop_details, usage }. onText(chars) reports progress. */
  async function readClaudeStream(res, onText) {
    if (!res.ok) return readJson(res); // throws with the API's error message
    const reader = res.body.getReader(), dec = new TextDecoder();
    const blocks = [], at = new Map(), usage = {};
    let buf = "", chars = 0, stop_reason = null, stop_details = null;
    const handle = (ev) => {
      if (ev.type === "message_start") Object.assign(usage, ev.message?.usage);
      else if (ev.type === "content_block_start") at.set(ev.index, blocks.push({ ...ev.content_block, text: ev.content_block?.text || "" }) - 1);
      else if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta") {
        const b = blocks[at.get(ev.index)]; if (b) b.text += ev.delta.text;
        chars += ev.delta.text.length; onText?.(chars);
      } else if (ev.type === "message_delta") {
        stop_reason = ev.delta?.stop_reason ?? stop_reason;
        stop_details = ev.delta?.stop_details ?? stop_details;
        Object.assign(usage, ev.usage);
      } else if (ev.type === "error") throw new Error(ev.error?.message || "stream error");
    };
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true }).replace(/\r\n/g, "\n");
      let i;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const data = buf.slice(0, i).split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trimStart()).join("\n");
        buf = buf.slice(i + 2);
        if (!data) continue;
        let ev; try { ev = JSON.parse(data); } catch { continue; }
        handle(ev);
      }
    }
    return { content: blocks, stop_reason, stop_details, usage };
  }

  async function readJson(res) {
    const raw = await res.text();
    let data; try { data = JSON.parse(raw); } catch { data = null; }
    if (!res.ok) {
      const msg = data?.error?.message || data?.error || raw.slice(0, 500) || res.statusText;
      throw new Error(`HTTP ${res.status}: ${typeof msg === "string" ? msg : JSON.stringify(msg)}`);
    }
    if (data === null) throw new Error("Response was not JSON: " + raw.slice(0, 300));
    return data;
  }

  /** A bare OpenAI-compatible base URL (…/v1) gets /chat/completions appended; full chat endpoints and Ollama's
      native /api/chat and /api/generate are used as given. */
  function localChatUrl(endpoint) {
    const u = new URL(endpoint);
    if (!/\/(chat\/completions|completions|api\/chat|api\/generate)\/?$/.test(u.pathname))
      u.pathname = u.pathname.replace(/\/$/, "") + "/chat/completions";
    return u.href;
  }

  /** …/chat/completions → …/models (OpenAI-compatible), …/api/chat or …/api/generate → …/api/tags (Ollama native). */
  function localModelsUrl(endpoint) {
    const u = new URL(endpoint);
    if (/\/api\/(chat|generate)\/?$/.test(u.pathname)) u.pathname = u.pathname.replace(/\/api\/(chat|generate)\/?$/, "/api/tags");
    else u.pathname = u.pathname.replace(/\/chat\/completions\/?$|\/completions\/?$/, "").replace(/\/$/, "") + "/models";
    return u.href;
  }

  /** Ask the provider which models it serves. Returns [{ id, label }]. */
  async function listModels(provider) {
    const cfg = settings;
    if (provider === "claude") {
      if (!cfg.claude_key) throw new Error("no API key");
      const out = [];
      for (let after = null; ;) {
        const q = new URLSearchParams({ limit: "1000" }); if (after) q.set("after_id", after);
        const data = await readJson(await fetch("https://api.anthropic.com/v1/models?" + q, { headers: CLAUDE_HEADERS(cfg.claude_key) }));
        (data.data || []).forEach((m) => out.push({ id: m.id, label: m.display_name || m.id }));
        if (!data.has_more || !data.last_id) return out;
        after = data.last_id;
      }
    }
    if (provider === "gemini") {
      if (!cfg.gemini_key) throw new Error("no API key");
      const out = [];
      for (let page = ""; ;) {
        const q = new URLSearchParams({ pageSize: "1000" }); if (page) q.set("pageToken", page);
        const data = await readJson(await fetch("https://generativelanguage.googleapis.com/v1beta/models?" + q, { headers: { "x-goog-api-key": cfg.gemini_key } }));
        (data.models || []).filter((m) => (m.supportedGenerationMethods || []).includes("generateContent"))
          .forEach((m) => { const id = m.name.replace(/^models\//, ""); out.push({ id, label: m.displayName || id }); });
        if (!data.nextPageToken) return out;
        page = data.nextPageToken;
      }
    }
    if (provider === "hf") {
      if (!cfg.hf_key) throw new Error("no access token");
      const data = await readJson(await fetch(HF_ROUTER + "/models", { headers: { authorization: "Bearer " + cfg.hf_key } }));
      return (data.data || []).map((m) => ({ id: m.id, label: m.id })).sort((a, b) => a.id.localeCompare(b.id));
    }
    if (provider === "local") {
      const headers = {}; if (cfg.local_key) headers.authorization = "Bearer " + cfg.local_key;
      const data = await readJson(await fetch(localModelsUrl(cfg.local_endpoint || DEFAULTS.local_endpoint), { headers }));
      const list = data.data || data.models || [];
      return list.map((m) => { const id = m.id || m.name || m.model; return { id, label: id }; }).filter((m) => m.id)
        .sort((a, b) => a.id.localeCompare(b.id));
    }
    throw new Error("Unknown provider: " + provider);
  }

  async function callLLM({ provider, systemPrompt, messages, signal, onProgress }) {
    const cfg = settings;

    if (provider === "claude") {
      if (!cfg.claude_key) throw new Error("Add an Anthropic API key in Settings.");
      const headers = { "content-type": "application/json", ...CLAUDE_HEADERS(cfg.claude_key) };
      const model = cfg.claude_model || DEFAULTS.claude_model;
      const info = CLAUDE_MODELS.find((x) => x.id === model); // unknown (custom) ids get the request as configured
      const want = clamp(cfg.claude_max_tokens, 1024, 128000, DEFAULTS.claude_max_tokens);
      const body = {
        model,
        max_tokens: Math.min(want, info?.maxOut ?? want),
        stream: true, // long answers (a whole revised analysis) outlast a non-streaming request
        cache_control: { type: "ephemeral" }, // the system prompt + analysis repeat on every question
        system: systemPrompt,
        messages,
      };
      if (!info || info.effort) {
        const effort = cfg.claude_effort || "medium";
        body.output_config = { effort: !info || info.effort.includes(effort) ? effort : "high" };
      }
      if (cfg.claude_fallbacks && (!info || info.fallback)) { // re-run declined requests on a fallback model, server-side
        headers["anthropic-beta"] = "server-side-fallback-2026-07-01";
        body.fallbacks = "default";
      }
      const data = await readClaudeStream(await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers, body: JSON.stringify(body), signal }), onProgress);
      // Thinking blocks may precede the answer, so join every text block instead of reading content[0].
      const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n\n");
      if (data.stop_reason === "refusal") {
        const why = data.stop_details?.explanation || data.stop_details?.category || "no details";
        return { text: (text ? text + "\n\n" : "") + `_The model declined this request (${why})._`, raw: data };
      }
      if (data.stop_reason === "max_tokens")
        return { text: text + `\n\n_…output truncated at ${body.max_tokens} tokens. Narrow the scope (select the elements to focus on), ask for a patch, or raise Max output tokens in Settings._`, raw: data, usage: data.usage };
      return { text: text || JSON.stringify(data), raw: data, usage: data.usage };
    }

    if (provider === "gemini") {
      if (!cfg.gemini_key) throw new Error("Add a Gemini API key in Settings.");
      const model = encodeURIComponent(cfg.gemini_model || DEFAULTS.gemini_model);
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
      const body = {
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: messages.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })),
      };
      const data = await readJson(await fetch(url, {
        method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": cfg.gemini_key }, body: JSON.stringify(body), signal,
      }));
      const cand = data.candidates?.[0];
      const text = (cand?.content?.parts || []).map((p) => p.text || "").join("");
      if (!text && (data.promptFeedback?.blockReason || cand?.finishReason)) return { text: `_No answer (${data.promptFeedback?.blockReason || cand.finishReason})._`, raw: data };
      return { text: text || JSON.stringify(data), raw: data };
    }

    if (provider === "hf") {
      if (!cfg.hf_key) throw new Error("Add a Hugging Face access token in Settings.");
      const res = await fetch(HF_ROUTER + "/chat/completions", {
        method: "POST", signal,
        headers: { "content-type": "application/json", authorization: "Bearer " + cfg.hf_key },
        body: JSON.stringify({ model: cfg.hf_model || DEFAULTS.hf_model, messages: [{ role: "system", content: systemPrompt }, ...messages] }),
      });
      if (res.status === 402) throw new Error("HTTP 402: the monthly Inference Providers credits of this Hugging Face account are used up (huggingface.co/settings/billing).");
      const data = await readJson(res);
      const choice = data.choices?.[0];
      const text = choice?.message?.content ?? JSON.stringify(data);
      if (choice?.finish_reason === "length") return { text: text + "\n\n_…output truncated by the provider. Narrow the scope or ask for a patch._", raw: data, usage: hfUsage(data) };
      return { text, raw: data, usage: hfUsage(data) };
    }

    if (provider === "local") {
      const endpoint = localChatUrl(cfg.local_endpoint || DEFAULTS.local_endpoint);
      const model = cfg.local_model || DEFAULTS.local_model;
      const headers = { "content-type": "application/json" };
      if (cfg.local_key) headers.authorization = "Bearer " + cfg.local_key;
      const post = (body) => fetch(endpoint, { method: "POST", headers, body: JSON.stringify(body), signal }).then(readJson);

      if (/\/api\/generate\/?$/.test(endpoint)) { // Ollama native, single prompt
        const prompt = messages.map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`).join("\n\n") + "\n\nAssistant:";
        const data = await post({ model, system: systemPrompt, prompt, stream: false });
        return { text: data.response ?? JSON.stringify(data), raw: data };
      }
      const chat = [{ role: "system", content: systemPrompt }, ...messages];
      if (/\/api\/chat\/?$/.test(endpoint)) { // Ollama native chat
        const data = await post({ model, messages: chat, stream: false });
        return { text: data.message?.content ?? JSON.stringify(data), raw: data };
      }
      const data = await post({ model, messages: chat }); // OpenAI-compatible
      return { text: data.choices?.[0]?.message?.content ?? JSON.stringify(data), raw: data };
    }

    throw new Error("Unknown provider: " + provider);
  }

  /** OpenAI-style usage → the { input_tokens, output_tokens } shape the log shows. */
  const hfUsage = (data) => data.usage ? { input_tokens: data.usage.prompt_tokens, output_tokens: data.usage.completion_tokens } : undefined;

  /* ── Safe Markdown → DOM (all text is escaped first; no raw HTML from the model) ── */
  const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  function inline(s) {
    return esc(s)
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>")
      .replace(/(^|\W)_([^_\s][^_]*)_(?=\W|$)/g, "$1<em>$2</em>");
  }
  function renderMarkdown(md) {
    const out = []; const lines = md.replace(/\r\n/g, "\n").split("\n");
    let i = 0, list = null;
    const closeList = () => { if (list) { out.push(`</${list}>`); list = null; } };
    while (i < lines.length) {
      const line = lines[i];
      const fence = /^```(\w*)\s*$/.exec(line);
      if (fence) {
        closeList();
        const buf = []; i++;
        while (i < lines.length && !/^```\s*$/.test(lines[i])) buf.push(lines[i++]);
        i++;
        out.push(`<pre data-lang="${esc(fence[1])}"><code>${esc(buf.join("\n"))}</code></pre>`);
        continue;
      }
      if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
        closeList();
        const cells = (l) => l.trim().replace(/^\||\|$/g, "").split("|").map((c) => inline(c.trim()));
        let html = "<table><thead><tr>" + cells(line).map((c) => `<th>${c}</th>`).join("") + "</tr></thead><tbody>";
        i += 2;
        while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) html += "<tr>" + cells(lines[i++]).map((c) => `<td>${c}</td>`).join("") + "</tr>";
        out.push(html + "</tbody></table>");
        continue;
      }
      const h = /^(#{1,6})\s+(.*)$/.exec(line);
      if (h) { closeList(); const lv = Math.min(5, h[1].length + 2); out.push(`<h${lv}>${inline(h[2])}</h${lv}>`); i++; continue; }
      const li = /^\s*([-*]|\d+[.)])\s+(.*)$/.exec(line);
      if (li) {
        const kind = /\d/.test(li[1]) ? "ol" : "ul";
        if (list !== kind) { closeList(); out.push(`<${kind}>`); list = kind; }
        out.push(`<li>${inline(li[2])}</li>`); i++; continue;
      }
      if (!line.trim()) { closeList(); i++; continue; }
      closeList();
      const para = [line]; i++;
      while (i < lines.length && lines[i].trim() && !/^(```|#{1,6}\s|\s*([-*]|\d+[.)])\s|\s*\|)/.test(lines[i])) para.push(lines[i++]);
      out.push(`<p>${inline(para.join(" "))}</p>`);
    }
    closeList();
    return out.join("");
  }

  /* ── Styles (use the host's --color-* tokens from HFA DS; body[data-theme] switches them) ── */
  const CSS = `
  body.ai-open { margin-right: var(--ai-w, 440px); }
  .ai-panel { position: fixed; top: 0; right: 0; bottom: 0; width: var(--ai-w, 440px); z-index: 50; display: flex; flex-direction: column;
    background: var(--color-background-elevated); color: var(--color-foreground); border-left: 1px solid var(--color-foreground-subtle);
    font: 14px/1.45 var(--font-sans, system-ui, sans-serif); box-shadow: -6px 0 18px rgba(0,0,0,.12); }
  .ai-panel[hidden] { display: none; }
  .ai-panel *, .ai-settings * { box-sizing: border-box; }
  .ai-panel button, .ai-settings button { font: inherit; font-size: 13px; padding: 4px 10px; color: var(--color-foreground);
    background: var(--color-background-base); border: 1px solid var(--color-foreground-subtle); border-radius: 6px; cursor: pointer; }
  .ai-panel button:hover:not(:disabled), .ai-settings button:hover { border-color: var(--color-foreground); }
  .ai-panel button:disabled { opacity: .45; cursor: not-allowed; }
  .ai-panel button.primary { background: var(--color-brand-primary, #d70000); border-color: var(--color-brand-primary, #d70000); color: #fff; }
  .ai-panel select, .ai-panel textarea, .ai-settings input, .ai-settings select, .ai-settings textarea { font: inherit; font-size: 13px;
    color: var(--color-foreground); background: var(--color-background-base); border: 1px solid var(--color-foreground-subtle); border-radius: 6px; padding: 4px 6px; }
  .ai-resize { position: absolute; left: -4px; top: 0; bottom: 0; width: 8px; cursor: col-resize; }
  .ai-resize:hover, .ai-resize:focus-visible { background: color-mix(in srgb, var(--color-foreground) 15%, transparent); outline: none; }
  .ai-head { display: flex; gap: 6px; align-items: center; padding: 8px 10px; border-bottom: 1px solid var(--color-foreground-subtle); }
  .ai-head strong { font-size: 15px; margin-right: auto; }
  .ai-pill { font-size: 11px; padding: 1px 7px; border-radius: 999px; border: 1px solid var(--color-foreground-subtle); color: var(--color-foreground-muted); }
  .ai-quick { display: flex; gap: 6px; flex-wrap: wrap; padding: 8px 10px; border-bottom: 1px solid var(--color-foreground-subtle); }
  .ai-quick button { font-size: 12px; padding: 3px 8px; }
  .ai-scope { font-size: 12px; color: var(--color-foreground-muted); padding: 6px 10px; border-bottom: 1px solid var(--color-foreground-subtle);
    display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
  .ai-scope strong { color: var(--color-foreground); font-weight: 600; }
  .ai-scope label { display: inline-flex; gap: 4px; align-items: center; }
  .ai-scope .folds { display: inline-flex; gap: 6px; margin-left: auto; }
  .ai-scope .folds button { padding: 2px 8px; font-size: 12px; }
  .ai-logwrap { position: relative; flex: 1; min-height: 120px; display: flex; flex-direction: column; }
  .ai-log { flex: 1; min-height: 0; overflow: auto; padding: 10px; display: flex; flex-direction: column; gap: 10px; }
  .ai-log > * { flex: none; }
  .ai-tobottom { position: absolute; left: 50%; bottom: 12px; transform: translateX(-50%); width: 32px; height: 32px; padding: 0 !important;
    border-radius: 50% !important; box-shadow: 0 2px 8px rgba(0,0,0,.2); font-size: 16px; line-height: 1; }
  .ai-tobottom[hidden] { display: none; }
  .ai-msg { border: 1px solid var(--color-foreground-subtle); border-radius: 6px; padding: 8px 12px; max-width: 100%; overflow-x: auto; }
  .ai-msg.user { background: color-mix(in srgb, var(--color-brand-primary, #d70000) 10%, var(--color-background-elevated)); align-self: flex-end; max-width: 90%; white-space: pre-wrap; }
  .ai-msg.assistant { background: var(--color-background-elevated); }
  .ai-msg.error { background: color-mix(in srgb, #c70039 14%, var(--color-background-elevated)); white-space: pre-wrap; }
  .ai-msg .meta { font-size: 11px; color: var(--color-foreground-subtle); margin-bottom: 4px; }
  .ai-msg .meta .fold { border: 0; background: none; padding: 0 4px; margin-left: 2px; font-size: 11px; color: var(--color-foreground-muted); }
  .ai-msg .gist { display: none; color: var(--color-foreground-muted); cursor: pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .ai-msg.folded .gist { display: block; }
  .ai-msg.folded > .body { display: none; }
  .ai-msg pre, .ai-card pre { background: var(--color-background-sunken); padding: 8px; border-radius: 4px; overflow: auto;
    font: 12px/1.45 var(--font-mono, ui-monospace, monospace); margin: 6px 0; }
  .ai-msg code { font-family: var(--font-mono, ui-monospace, monospace); font-size: 12px; }
  .ai-msg table { border-collapse: collapse; margin: 6px 0; font-size: 13px; }
  .ai-msg th, .ai-msg td { border: 1px solid var(--color-foreground-subtle); padding: 3px 6px; text-align: left; vertical-align: top; }
  .ai-msg th { background: var(--color-background-sunken); }
  .ai-msg h3, .ai-msg h4, .ai-msg h5 { margin: 10px 0 4px; }
  .ai-msg p { margin: 6px 0; }
  .ai-msg ul, .ai-msg ol { margin: 4px 0; padding-left: 22px; }
  .ai-card { border: 1px solid var(--color-foreground-subtle); border-radius: 6px; background: var(--color-background-base); padding: 8px 12px; margin: 6px 0; }
  .ai-card .head { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
  .ai-card .head strong { margin-right: auto; font-size: 13px; }
  .ai-card .head button { padding: 3px 10px; font-size: 12px; }
  .ai-card summary { cursor: pointer; font-size: 12px; color: var(--color-foreground-muted); margin-top: 6px; }
  .ai-status { font-size: 12px; color: var(--color-foreground-muted); padding: 0 10px 4px; min-height: 18px; }
  .ai-chat { display: flex; flex-direction: column; gap: 6px; padding: 8px 10px; border-top: 1px solid var(--color-foreground-subtle); }
  .ai-chat textarea { resize: vertical; min-height: 54px; max-height: 220px; width: 100%; }
  .ai-chat .row { display: flex; gap: 6px; align-items: center; }
  .ai-chat select { flex: 1; min-width: 0; }
  .ai-settings { width: min(520px, calc(100vw - 32px)); max-height: calc(100vh - 32px); padding: 16px 18px; color: var(--color-foreground);
    background: var(--color-background-elevated); border: 1px solid var(--color-foreground-subtle); border-radius: 8px; font: 14px/1.45 var(--font-sans, system-ui, sans-serif); }
  .ai-settings::backdrop { background: rgba(0,0,0,.4); }
  .ai-settings h2 { font-size: 16px; margin: 0 0 10px; display: flex; justify-content: space-between; align-items: center; }
  .ai-settings fieldset { border: 1px solid var(--color-foreground-subtle); border-radius: 6px; margin: 0 0 12px; padding: 8px 10px 10px; }
  .ai-settings fieldset[data-provider]:not(.active) { opacity: .6; }
  .ai-settings fieldset.active { border-color: var(--color-brand-primary, #d70000); }
  .ai-settings legend { font-weight: 600; padding: 0 4px; }
  .ai-settings label { display: grid; gap: 2px; font-size: 13px; margin-bottom: 8px; }
  .ai-settings label.inline { display: flex; gap: 6px; align-items: center; }
  .ai-settings textarea { min-height: 180px; width: 100%; font-family: var(--font-mono, ui-monospace, monospace); font-size: 12px; }
  .ai-settings .hint { font-size: 12px; color: var(--color-foreground-muted); margin: 4px 0; }
  .ai-settings .row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-bottom: 8px; }
  /* The panel toggle is an icon button with only hover and pressed (pressed lasts while the mouse button is down); it has no status. */
  .ai-toggle { display: inline-flex; align-items: center; justify-content: center; margin-left: auto; line-height: 0; }
  .ai-toggle svg { width: 24px; height: 18px; display: block; }
  .ai-toggle:active { background: var(--color-foreground); border-color: var(--color-foreground); color: var(--color-background-elevated); }
  .ai-head .ai-toggle { margin-left: 0; }
  /* Without a provider: a warning pill and a box in the log. Status is shown with the fill only. */
  .ai-panel { --ai-warn-bg: #fad153; }
  body[data-theme="dark"] .ai-panel { --ai-warn-bg: #544a06; }
  .ai-pill.warning { background: var(--color-background-warning, var(--ai-warn-bg)); color: var(--color-foreground); border-color: var(--color-foreground); }
  .ai-noprovider { background: var(--color-background-warning, var(--ai-warn-bg)); color: var(--color-foreground); border: 1px solid var(--color-foreground);
    border-radius: 6px; padding: 8px 12px; margin: 0 0 10px; }
  .ai-panel.no-provider .ai-msg.welcome { display: none; }
  @media (max-width: 760px) { body.ai-open { margin-right: 0; } .ai-panel { width: 100vw; } .ai-resize { display: none; } }
  @media print { .ai-panel, .ai-toggle { display: none !important; } body.ai-open { margin-right: 0; } }
  `;

  /* ═══════════════════════════════════════════════════════════════════════
     Panel
     ═══════════════════════════════════════════════════════════════════════ */
  function mount(cfg) {
    const prefix = `hfa-${cfg.id}:`;
    const MAX_W = () => Math.max(320, Math.floor(window.innerWidth * 0.7));

    document.head.appendChild(el("style", { textContent: CSS }));

    /* ── Markup ── */
    const $ = {};
    const btn = (label, props = {}) => el("button", { type: "button", textContent: label, ...props });
    // An icon button: a window with a panel on the right. It sits at the right end of the toolbar while the panel is hidden
    // and in the panel's header while it is open, so it is in the same place on the screen (design principle 4.7).
    $.toggle = btn("", { className: `${cfg.buttonClass || ""} ai-toggle` });
    $.toggle.innerHTML = '<svg viewBox="0 0 24 18" aria-hidden="true" focusable="false"><rect x=".75" y=".75" width="22.5" height="16.5" rx="3" fill="none" stroke="currentColor" stroke-width="1.5"/><line x1="15.75" y1="1.5" x2="15.75" y2="16.5" stroke="currentColor" stroke-width="1.5"/></svg>';
    $.toggle.setAttribute("aria-expanded", "true");
    $.toggle.setAttribute("aria-controls", "ai-panel");
    cfg.toolbar?.appendChild($.toggle);

    $.panel = el("aside", { className: "ai-panel", id: "ai-panel", hidden: true, ariaLabel: cfg.title });
    $.resize = el("div", { className: "ai-resize", tabIndex: 0, title: "Drag to resize (arrow keys work too)" });
    $.resize.setAttribute("role", "separator");
    $.resize.setAttribute("aria-orientation", "vertical");
    $.pill = el("span", { className: "ai-pill" });
    $.settingsBtn = btn("Settings…", { title: "Provider, API key, model and system prompt" });
    const head = el("div", { className: "ai-head" }, el("strong", { textContent: cfg.title }), $.pill, $.settingsBtn);
    $.quick = el("div", { className: "ai-quick" });
    $.scopeText = el("span");
    $.keep = el("input", { type: "checkbox" });
    $.foldAll = btn("Compress", { title: "Fold every answer to one line" });
    $.unfoldAll = btn("Expand", { title: "Open every answer" });
    $.clear = btn("Clear", { title: "Clear the conversation" });
    $.saveLog = btn("Export .md", { title: "Download the conversation as Markdown" });
    const scope = el("div", { className: "ai-scope" }, $.scopeText,
      el("label", { title: "Send the earlier questions and answers with the next question (for follow-ups)" }, $.keep, "Send earlier turns"),
      el("span", { className: "folds" }, $.foldAll, $.unfoldAll, $.clear, $.saveLog));
    $.log = el("div", { className: "ai-log", ariaLive: "polite" });
    $.toBottom = btn("↓", { className: "ai-tobottom", title: "Go to the latest entry", hidden: true });
    const logWrap = el("div", { className: "ai-logwrap" }, $.log, $.toBottom);
    $.status = el("div", { className: "ai-status" });
    $.prompt = el("textarea", { placeholder: `Ask about ${cfg.subject || "the analysis"}… (Enter sends, Shift+Enter for a new line)`, ariaLabel: "Question" });
    $.modelPick = el("select", { title: "Model for the next question", ariaLabel: "Model for the next question" });
    $.send = btn("Send", { type: "submit", className: "primary" });
    $.chat = el("form", { className: "ai-chat" }, $.prompt, el("div", { className: "row" }, $.modelPick, $.send));
    $.panel.append($.resize, head, $.quick, scope, logWrap, $.status, $.chat);
    document.body.appendChild($.panel);

    /* Settings dialog */
    const field = (label, input) => el("label", {}, label, input);
    const f = {
      provider: el("select", {}, new Option("Anthropic Claude", "claude"), new Option("Google Gemini", "gemini"), new Option("Hugging Face (Inference Providers)", "hf"), new Option("Local (Ollama / LM Studio / LocalAI)", "local")),
      claude_key: el("input", { type: "password", autocomplete: "off", placeholder: "sk-ant-…" }),
      claude_model: el("input", { type: "text" }),
      claude_max_tokens: el("input", { type: "number", min: 1024, max: 128000, step: 1024 }),
      claude_effort: el("select", {}, ...EFFORT_ALL.map((x) => new Option(x, x))),
      claude_fallbacks: el("input", { type: "checkbox" }),
      gemini_key: el("input", { type: "password", autocomplete: "off" }),
      gemini_model: el("input", { type: "text", placeholder: DEFAULTS.gemini_model }),
      local_endpoint: el("input", { type: "url", placeholder: DEFAULTS.local_endpoint }),
      local_model: el("input", { type: "text", placeholder: DEFAULTS.local_model }),
      local_key: el("input", { type: "password", autocomplete: "off", placeholder: "optional" }),
      hf_key: el("input", { type: "password", autocomplete: "off", placeholder: "hf_…" }),
      hf_model: el("input", { type: "text", placeholder: DEFAULTS.hf_model }),
      remember_keys: el("input", { type: "checkbox" }),
      system_prompt: el("textarea", { spellcheck: false }),
    };
    const dl = (id, input) => { const list = el("datalist", { id: `${prefix}${id}` }); input.setAttribute("list", list.id); return list; };
    const claudeList = dl("claudeModels", f.claude_model), geminiList = dl("geminiModels", f.gemini_model), localList = dl("localModels", f.local_model), hfList = dl("hfModels", f.hf_model);
    CLAUDE_MODELS.forEach((x) => claudeList.appendChild(new Option(x.label, x.id)));
    GEMINI_MODELS.forEach((x) => geminiList.appendChild(new Option(x, x)));
    HF_MODELS.forEach((x) => hfList.appendChild(new Option(x, x)));
    $.modelsState = el("span", { className: "ai-pill" });
    $.refreshModels = btn("Refresh model list");
    $.forgetKeys = btn("Forget stored keys");
    $.resetPrompt = btn("Reset to default");
    $.closeSettings = btn("Close");
    const fs = (provider, legend, ...kids) => { const n = el("fieldset", {}, el("legend", { textContent: legend }), ...kids); n.dataset.provider = provider; return n; };
    $.dialog = el("dialog", { className: "ai-settings", ariaLabel: "AI settings" },
      el("h2", {}, "AI settings", $.closeSettings),
      field("Provider", f.provider),
      el("div", { className: "row" }, $.refreshModels, $.modelsState),
      el("p", { className: "hint", textContent: "Only the active provider is called. Provider settings are shared by the HFA tools (STPA, HTA, Bowtie) in this browser." }),
      fs("claude", "Anthropic Claude", field("API key", f.claude_key), field("Model", f.claude_model), claudeList,
        field("Max output tokens", f.claude_max_tokens), field("Effort", f.claude_effort),
        el("label", { className: "inline" }, f.claude_fallbacks, "Server-side refusal fallback (fallbacks: \"default\")"),
        el("p", { className: "hint", textContent: "Calls api.anthropic.com directly from the browser with anthropic-dangerous-direct-browser-access. Your key is visible to anyone using this browser profile — use a restricted key." })),
      fs("gemini", "Google Gemini", field("API key", f.gemini_key), field("Model", f.gemini_model), geminiList,
        el("p", { className: "hint", textContent: "Sent as the x-goog-api-key header (not in the URL)." })),
      fs("hf", "Hugging Face", field("Access token", f.hf_key), field("Model", f.hf_model), hfList,
        el("p", { className: "hint", textContent: "Calls router.huggingface.co (OpenAI-compatible). Create a fine-grained token with \"Make calls to Inference Providers\" at huggingface.co/settings/tokens. Usage is billed to the token's account; free accounts get a small monthly credit. Add \":cheapest\", \":fastest\" or \":<provider>\" to the model id to choose who serves it." })),
      fs("local", "Local model", field("Endpoint", f.local_endpoint), field("Model", f.local_model), localList, field("API key", f.local_key),
        el("p", { className: "hint", textContent: "OpenAI-compatible …/v1/chat/completions, or Ollama's /api/chat or /api/generate. For Ollama from file://, start it with OLLAMA_ORIGINS=*." })),
      el("fieldset", {}, el("legend", { textContent: "Keys" }),
        el("label", { className: "inline" }, f.remember_keys, "Remember API keys in this browser (localStorage)"), $.forgetKeys),
      el("fieldset", {}, el("legend", { textContent: "System prompt" }), f.system_prompt,
        el("p", { className: "hint", textContent: "The data model, the patch format and the current analysis are always appended." }), $.resetPrompt));
    document.body.appendChild($.dialog);

    // The hosts have single-key shortcuts on document, and clear their selection on clicks elsewhere: keep keys and
    // clicks here from reaching them, so the selection still scopes the question when Send is pressed.
    [$.panel, $.dialog].forEach((n) => {
      n.addEventListener("keydown", (e) => {
        e.stopPropagation();
        if (e.key === "Escape" && n === $.panel && !busy) { e.preventDefault(); setOpen(false); }
      });
      ["click", "mousedown", "pointerdown"].forEach((t) => n.addEventListener(t, (e) => e.stopPropagation()));
    });

    /* ── Settings ── */
    const PROVIDER_FIELDS = ["provider", "claude_key", "claude_model", "claude_max_tokens", "claude_effort", "claude_fallbacks",
      "gemini_key", "gemini_model", "hf_key", "hf_model", "local_endpoint", "local_model", "local_key", "remember_keys"];
    const SECRET_FIELDS = ["claude_key", "gemini_key", "hf_key", "local_key"];

    function loadSettings() {
      let shared = store.get(PROVIDER_KEY);
      if (!shared) { // first use: pick up the STPA workbench's provider settings
        const stpa = store.get("hfa-stpa:settings", {}) || {};
        shared = Object.fromEntries(PROVIDER_FIELDS.filter((k) => stpa[k] !== undefined).map((k) => [k, stpa[k]]));
      }
      settings = { provider: "claude", claude_model: DEFAULTS.claude_model, claude_max_tokens: DEFAULTS.claude_max_tokens, claude_effort: "medium",
        claude_fallbacks: true, gemini_model: DEFAULTS.gemini_model, hf_model: DEFAULTS.hf_model, local_endpoint: DEFAULTS.local_endpoint, local_model: DEFAULTS.local_model,
        remember_keys: true, ...shared,
        system_prompt: store.get(prefix + "ai-prompt") || cfg.systemPrompt,
        keep_history: !!store.get(prefix + "ai-keep-history") };
      Object.entries(f).forEach(([k, input]) => {
        if (input.type === "checkbox") input.checked = !!settings[k]; else input.value = settings[k] ?? "";
      });
      $.keep.checked = settings.keep_history;
      updateBadge();
    }
    function saveSettings() {
      Object.entries(f).forEach(([k, input]) => { settings[k] = input.type === "checkbox" ? input.checked : k === "system_prompt" ? input.value : input.value.trim(); });
      settings.keep_history = $.keep.checked;
      const persisted = Object.fromEntries(PROVIDER_FIELDS.map((k) => [k, settings[k]]));
      if (!settings.remember_keys) SECRET_FIELDS.forEach((k) => delete persisted[k]);
      store.set(PROVIDER_KEY, persisted);
      store.set(prefix + "ai-prompt", settings.system_prompt === cfg.systemPrompt ? null : settings.system_prompt);
      store.set(prefix + "ai-keep-history", settings.keep_history);
      updateBadge();
    }

    const providerName = () => f.provider.selectedOptions[0]?.text.replace(/ \(.*\)$/, "").replace(/^(Anthropic|Google) /, "") || settings.provider;
    const providerLabel = () => ({
      claude: settings.claude_model || DEFAULTS.claude_model,
      gemini: settings.gemini_model || DEFAULTS.gemini_model,
      hf: settings.hf_model || DEFAULTS.hf_model,
      local: settings.local_model || DEFAULTS.local_model,
    })[settings.provider];

    /* Models the active provider reported; null until fetched (or when the fetch failed). */
    const fetchedModels = { claude: null, gemini: null, hf: null, local: null };
    let modelsSeq = 0;
    async function refreshModels() {
      const p = settings.provider, seq = ++modelsSeq;
      $.modelsState.textContent = "loading models…";
      try {
        const list = await listModels(p);
        if (seq !== modelsSeq) return;
        fetchedModels[p] = list;
        $.modelsState.textContent = `${list.length} models from provider`;
      } catch (e) {
        if (seq !== modelsSeq) return;
        fetchedModels[p] = null;
        $.modelsState.textContent = p === "local" ? "model list unavailable" : "built-in model list";
        $.modelsState.title = e.message;
      }
      updateBadge();
    }

    /** Fill the model picker for the current provider: the provider's own list when it could be fetched, else the
        built-in list. A custom id from Settings is kept as an extra entry. */
    function updateBadge() {
      const pick = $.modelPick, p = settings.provider, cur = providerLabel();
      $.dialog.querySelectorAll("fieldset[data-provider]").forEach((n) => n.classList.toggle("active", n.dataset.provider === p));
      applyState();
      pick.replaceChildren();
      const fetched = fetchedModels[p];
      const family = (id) => CLAUDE_MODELS.find((x) => x.id === id)?.family || "Other";
      if (fetched) {
        const groups = p === "claude" ? [...new Set(fetched.map((m) => family(m.id)))] : [null];
        groups.forEach((fam) => {
          const parent = fam && groups.length > 1 ? pick.appendChild(el("optgroup", { label: fam })) : pick;
          fetched.filter((m) => !fam || family(m.id) === fam)
            .forEach((m) => parent.appendChild(new Option(m.label === m.id ? m.id : `${m.label} (${m.id})`, m.id)));
        });
      } else if (p === "claude") {
        [...new Set(CLAUDE_MODELS.map((x) => x.family))].forEach((fam) => {
          const og = el("optgroup", { label: fam });
          CLAUDE_MODELS.filter((x) => x.family === fam).forEach((x) => og.appendChild(new Option(`${x.label} (${x.id})`, x.id)));
          pick.appendChild(og);
        });
      } else if (p === "gemini") GEMINI_MODELS.forEach((id) => pick.appendChild(new Option(id, id)));
      else if (p === "hf") HF_MODELS.forEach((id) => pick.appendChild(new Option(id, id)));
      if (![...pick.options].some((o) => o.value === cur)) pick.appendChild(new Option(p === "local" || p === "hf" ? cur : `${cur} (custom)`, cur));
      pick.value = cur;
      const list = { claude: claudeList, gemini: geminiList, hf: hfList, local: localList }[p];
      if (list && fetched) list.replaceChildren(...fetched.map((m) => new Option(m.label, m.id)));
    }

    $.modelPick.addEventListener("change", (e) => { f[settings.provider + "_model"].value = e.target.value; saveSettings(); });
    // Browsers only suggest datalist entries matching the field's text; empty the field while it has focus.
    ["claude_model", "gemini_model", "hf_model", "local_model"].forEach((k) => {
      const input = f[k];
      input.addEventListener("focus", () => { input.dataset.prev = input.value; input.dataset.ph = input.placeholder; input.placeholder = input.value || input.placeholder; input.value = ""; });
      input.addEventListener("blur", () => { if (!input.value.trim() && input.dataset.prev) { input.value = input.dataset.prev; saveSettings(); } input.placeholder = input.dataset.ph || ""; });
    });
    Object.values(f).forEach((input) => input.addEventListener("change", saveSettings));
    $.keep.addEventListener("change", saveSettings);
    ["provider", "claude_key", "gemini_key", "hf_key", "local_endpoint", "local_key"].forEach((k) => f[k].addEventListener("change", () => {
      if (k === "provider" || k.startsWith(settings.provider + "_")) refreshModels();
    }));
    $.refreshModels.addEventListener("click", refreshModels);
    $.forgetKeys.addEventListener("click", () => { SECRET_FIELDS.forEach((k) => { f[k].value = ""; }); saveSettings(); setStatus("Stored API keys removed."); });
    $.resetPrompt.addEventListener("click", () => { f.system_prompt.value = cfg.systemPrompt; saveSettings(); });
    $.settingsBtn.addEventListener("click", () => { $.dialog.showModal(); f.provider.focus(); });
    $.closeSettings.addEventListener("click", () => $.dialog.close());

    /* ── Open / close / resize ── */
    const setWidth = (w) => {
      const px = Math.round(Math.min(MAX_W(), Math.max(320, w)));
      document.body.style.setProperty("--ai-w", px + "px");
      $.resize.setAttribute("aria-valuenow", String(px));
      return px;
    };
    let width = setWidth(store.get(prefix + "ai-width") || 440);
    const relayout = () => window.dispatchEvent(new Event("resize")); // hosts redraw connectors on resize
    function setOpen(open, { focus = true, remember = true } = {}) {
      const hadFocus = document.activeElement === $.toggle;
      $.panel.hidden = !open;
      document.body.classList.toggle("ai-open", open);
      // the toggle moves between the toolbar (hidden) and the panel header (open); the keyboard focus goes with it
      (open ? head : cfg.toolbar)?.appendChild($.toggle);
      const label = open ? "Hide AI panel" : "Show AI panel";
      $.toggle.title = `${label} (A)`;
      $.toggle.setAttribute("aria-label", label);
      $.toggle.setAttribute("aria-expanded", String(open));
      if (remember) store.set(prefix + "ai-open", open);
      if (open) { updateScope(); if (focus) $.prompt.focus(); }
      else if (hadFocus) $.toggle.focus();
      relayout();
    }
    $.toggle.addEventListener("click", () => setOpen($.panel.hidden));
    document.addEventListener("keydown", (e) => {
      if (e.key !== "a" && e.key !== "A") return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = document.activeElement;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (document.querySelector("dialog[open]")) return;
      e.preventDefault();
      setOpen($.panel.hidden);
    });
    let drag = null;
    $.resize.addEventListener("pointerdown", (e) => { drag = { x: e.clientX, w: width }; $.resize.setPointerCapture(e.pointerId); e.preventDefault(); });
    $.resize.addEventListener("pointermove", (e) => { if (drag) { width = setWidth(drag.w + drag.x - e.clientX); relayout(); } });
    const endDrag = () => { if (drag) { drag = null; store.set(prefix + "ai-width", width); } };
    $.resize.addEventListener("pointerup", endDrag);
    $.resize.addEventListener("pointercancel", endDrag);
    $.resize.addEventListener("keydown", (e) => {
      const step = { ArrowLeft: 40, ArrowRight: -40 }[e.key];
      if (step === undefined) return;
      e.preventDefault();
      width = setWidth(width + step); store.set(prefix + "ai-width", width); relayout();
    });

    /* ── Scope (the host's selection) ── */
    function currentScope() {
      try { return cfg.getScope?.() || null; } catch { return null; }
    }
    function updateScope() {
      const s = currentScope();
      $.scopeText.replaceChildren("Scope: ", el("strong", { textContent: s ? s.label : "whole analysis" }));
    }
    // Selection changes happen on clicks and keys in the host (which may stop propagation): listen in the capture
    // phase and refresh the scope line once the host has handled the event.
    ["click", "keyup"].forEach((t) => document.addEventListener(t, () => { if (!$.panel.hidden) setTimeout(updateScope, 0); }, true));

    /* ── Chat loop ── */
    let history = [];      // finished turns, sent only when "Send earlier turns" is on
    let busy = null;       // AbortController while a request runs
    const transcript = []; // for Markdown export

    function buildSystemPrompt() {
      const ctx = cfg.getContext();
      const schema = typeof cfg.schemaPrompt === "function" ? cfg.schemaPrompt() : cfg.schemaPrompt || "";
      return `${settings.system_prompt || cfg.systemPrompt}${schema}\n\n${cfg.contextLabel || "Current analysis (JSON)"}:\n${JSON.stringify(ctx, null, 2)}`;
    }
    function scopePreamble(s) {
      if (!s) return "";
      return `Analysis scope: I selected ${s.label}. Focus on the selected elements and their direct relations. Use the rest of the analysis only as context, and keep any change to a patch.\nSelected elements (JSON):\n${JSON.stringify(s.items, null, 2)}\n\nQuestion:\n`;
    }

    async function send(userText) {
      if (busy || !userText.trim()) return;
      const s = currentScope();
      addMessage("user", userText, `Scope: ${s ? s.label : "whole analysis"}`);
      const prior = settings.keep_history ? history : [];
      const turn = [{ role: "user", content: scopePreamble(s) + userText }];
      busy = new AbortController();
      setBusy(true);
      const model = providerLabel();
      try {
        setStatus(`Waiting for ${model}…`);
        const t0 = performance.now();
        const { text, usage } = await callLLM({ provider: settings.provider, systemPrompt: buildSystemPrompt(), messages: [...prior, ...turn], signal: busy.signal,
          onProgress: (n) => setStatus(`Receiving from ${model}… ${n.toLocaleString()} characters`) });
        turn.push({ role: "assistant", content: text });
        const tokens = usage ? ` · ${(usage.input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0)} in / ${usage.output_tokens ?? "?"} out tokens` : "";
        addMessage("assistant", text, `${model} · ${((performance.now() - t0) / 1000).toFixed(1)} s${tokens}`);
        history.push(...turn);
        setStatus("");
      } catch (e) {
        addMessage("error", e.name === "AbortError" ? "Request cancelled." : explainError(e));
        setStatus("");
      } finally {
        busy = null; setBusy(false);
      }
    }

    function explainError(e) {
      let msg = e.message || String(e);
      if (e instanceof TypeError && /fetch|network/i.test(msg)) {
        msg += settings.provider === "local"
          ? "\nCould not reach the local endpoint. Check it is running and allows this origin (Ollama: set OLLAMA_ORIGINS=*; LM Studio: enable CORS)."
          : "\nNetwork error — check your connection, proxy or browser extensions.";
      }
      return msg;
    }

    /** A provider is set up when its key (or, for a local model, its address) is there. The pill shows the chosen provider,
        not whether the connection answers. */
    function isConfigured() {
      const s = settings;
      return { claude: !!s.claude_key, gemini: !!s.gemini_key, hf: !!s.hf_key, local: !!(s.local_endpoint || DEFAULTS.local_endpoint) }[s.provider] || false;
    }
    const PLACEHOLDER = `Ask about ${cfg.subject || "the analysis"}… (Enter sends, Shift+Enter for a new line)`;
    /** One primary button at a time (design principle 4.5): Send, or Settings… when no provider is set up. */
    function applyState(busyNow = !!busy) {
      const ok = isConfigured();
      $.panel.classList.toggle("no-provider", !ok);
      $.pill.textContent = ok ? providerName() : "No provider";
      $.pill.classList.toggle("warning", !ok);
      $.settingsBtn.classList.toggle("primary", !ok);
      $.send.textContent = busyNow ? "Stop" : "Send";
      $.send.classList.toggle("primary", ok && !busyNow);
      $.send.disabled = !ok && !busyNow;
      $.prompt.disabled = !ok;
      $.prompt.placeholder = ok ? PLACEHOLDER : "Set up a provider in Settings… first";
      $.quick.querySelectorAll("button").forEach((b) => (b.disabled = busyNow || !ok));
      const box = $.log.querySelector(".ai-noprovider");
      if (ok && box) box.remove();
      if (!ok && !box) $.log.prepend(el("div", { className: "ai-noprovider", textContent: "The AI assistant is not set up yet. Open Settings…, choose a provider (Claude, Gemini, Hugging Face or a local model) and enter its key or address. Then the question field works." }));
    }
    function setBusy(on) { applyState(on); }
    const setStatus = (t) => ($.status.textContent = t);

    function addMessage(kind, text, meta) {
      const div = el("div", { className: "ai-msg " + kind });
      if (meta) div.appendChild(el("div", { className: "meta", textContent: meta }));
      if (kind === "user" || kind === "error") div.appendChild(document.createTextNode(text));
      else {
        const body = el("div", { className: "body" });
        body.innerHTML = renderMarkdown(text); // safe: renderMarkdown escapes all model text
        div.appendChild(body);
        if (kind === "assistant") attachJsonActions(body);
        if (meta) addFold(div, text);
      }
      $.log.appendChild(div);
      // An answer opens at its first line; questions and errors sit at the bottom.
      div.scrollIntoView?.({ block: kind === "assistant" ? "start" : "end", behavior: "smooth" });
      transcript.push({ kind, text, meta });
      updateToBottom();
    }

    /** The caret after an answer's meta line folds the answer to one line of its text; the line or the caret opens it again. */
    function addFold(div, text) {
      const fold = btn("", { className: "fold" });
      const gist = el("div", { className: "gist" });
      gist.textContent = text.replace(/```[\s\S]*?```/g, " [code] ").replace(/[#*_`|>]+|:?-{3,}:?/g, " ").replace(/\s+/g, " ").trim().slice(0, 200);
      fold.addEventListener("click", () => setFolded(div, !div.classList.contains("folded")));
      gist.addEventListener("click", () => setFolded(div, false));
      div.querySelector(".meta").appendChild(fold);
      div.querySelector(".body").before(gist);
      setFolded(div, false);
    }
    function setFolded(div, folded) {
      const fold = div.querySelector(".meta .fold");
      div.classList.toggle("folded", folded);
      fold.textContent = folded ? "▸" : "▾";
      fold.title = folded ? "Show the answer" : "Hide the answer";
      fold.setAttribute("aria-label", fold.title);
      fold.setAttribute("aria-expanded", String(!folded));
      updateToBottom();
    }
    const foldAll = (folded) => $.log.querySelectorAll(".ai-msg").forEach((div) => { if (div.querySelector(":scope > .meta .fold")) setFolded(div, folded); });
    $.foldAll.addEventListener("click", () => foldAll(true));
    $.unfoldAll.addEventListener("click", () => foldAll(false));

    function updateToBottom() { $.toBottom.hidden = $.log.scrollHeight - $.log.scrollTop - $.log.clientHeight < 40; }
    $.log.addEventListener("scroll", updateToBottom, { passive: true });
    $.toBottom.addEventListener("click", () => $.log.scrollTo({ top: $.log.scrollHeight, behavior: "smooth" }));

    /** A ```json block the host can apply becomes a card: actions on top, the JSON folded below. */
    function attachJsonActions(body) {
      body.querySelectorAll('pre[data-lang="json"]').forEach((pre) => {
        let obj; try { obj = JSON.parse(pre.textContent); } catch { return; }
        if (!obj || typeof obj !== "object") return;
        let info; try { info = cfg.inspect(obj); } catch { info = null; }
        if (!info) return;
        const copy = btn("Copy JSON");
        copy.addEventListener("click", async () => {
          try { await navigator.clipboard.writeText(JSON.stringify(obj, null, 2)); copy.textContent = "Copied"; }
          catch { copy.textContent = "Copy failed"; }
        });
        const apply = btn(info.applyLabel || "Apply", { className: "ai-apply" });
        const revert = btn("Revert", { hidden: true, title: "Restore the analysis as it was before this was applied" });
        let before = null;
        apply.addEventListener("click", () => {
          if (info.confirm && !confirm(info.confirm)) return;
          try {
            before = cfg.snapshot();
            const msg = cfg.apply(obj);
            if (msg === false) { before = null; return; }
            apply.textContent = "Applied"; apply.disabled = true; revert.hidden = false;
            setStatus(msg || "Applied.");
            updateScope();
          } catch (e) {
            before = null;
            setStatus("Could not apply: " + (e.message || e));
          }
        });
        revert.addEventListener("click", () => {
          if (before === null) return;
          cfg.restore(before); before = null;
          revert.hidden = true; apply.disabled = false; apply.textContent = info.applyLabel || "Apply";
          setStatus("Reverted.");
        });
        const card = el("div", { className: "ai-card" }, el("div", { className: "head" }, el("strong", { textContent: info.title }), copy, apply, revert));
        pre.before(card);
        const details = el("details", {}, el("summary", { textContent: "Show JSON" }));
        details.append(pre);
        card.append(details);
      });
    }

    function renderQuick() {
      $.quick.replaceChildren(...(cfg.quickActions || []).map(([label, prompt]) => {
        const b = btn(label, { title: prompt });
        b.addEventListener("click", () => send(prompt));
        return b;
      }));
    }

    $.chat.addEventListener("submit", (e) => {
      e.preventDefault();
      if (busy) { busy.abort(); return; }
      const t = $.prompt.value; $.prompt.value = ""; send(t);
    });
    // Enter sends, Shift+Enter gives a new line (design principle 4.6). Nothing is sent from an empty field,
    // while a reply is running (only Stop ends it) or while an input method (IME) is composing.
    $.prompt.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey || e.isComposing || e.keyCode === 229) return;
      e.preventDefault();
      if (!busy && $.prompt.value.trim()) $.chat.requestSubmit();
    });
    /** Clears the conversation; the tools also call it on New, since earlier turns concern the old analysis. */
    function clearConversation() { if (busy) busy.abort(); history = []; transcript.length = 0; $.log.replaceChildren(); applyState(); setStatus(""); updateToBottom(); }
    $.clear.addEventListener("click", clearConversation);
    $.saveLog.addEventListener("click", () => {
      const md = [`# ${cfg.title}`, "", `_Exported ${new Date().toISOString()} · ${providerLabel()}_`, "",
        "## Analysis", "", "```json", JSON.stringify(cfg.getContext(), null, 2), "```", "",
        ...transcript.map((t) => t.kind === "user" ? `## ▶ ${t.text}\n` : `${t.meta ? `_${t.meta}_\n\n` : ""}${t.text}\n`)].join("\n");
      download(`${cfg.exportName || cfg.id + "-analysis"}.md`, md, "text/markdown");
    });

    /* ── Boot ── */
    loadSettings();
    renderQuick();
    if (cfg.welcome) { addMessage("assistant", cfg.welcome); $.log.lastElementChild?.classList.add("welcome"); }
    applyState();
    // Open by default; a choice made with the toggle is remembered.
    setOpen(store.get(prefix + "ai-open") !== false, { focus: false, remember: false });
    refreshModels();

    return { open: () => setOpen(true), close: () => setOpen(false), send, clear: clearConversation, get settings() { return settings; } };
  }

  window.HFAAssist = { mount, renderMarkdown, CLAUDE_MODELS };
})();
