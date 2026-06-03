// ─────────────────────────────────────────────────────────────────────────────
// providers.js — thin, dependency-free callers for Anthropic and OpenAI.
//
// Both return the model's raw text, from which the handler parses JSON. Add a
// new provider here (e.g. your company LLM) and expose it in PROVIDERS — nothing
// else in the stack changes.
// ─────────────────────────────────────────────────────────────────────────────

// "internal" talks to any OpenAI-compatible API (Ollama, LM Studio, vLLM, etc.)
// Set INTERNAL_LLM_URL (e.g. http://localhost:11434/v1) and optionally
// INTERNAL_LLM_MODEL in the proxy's environment. No API key required by default.
export const PROVIDERS = {
  anthropic: {
    defaultModel: "claude-haiku-4-5-20251001",
    envKey: "ANTHROPIC_API_KEY",
    call: callAnthropic,
  },
  openai: {
    defaultModel: "gpt-4o-mini",
    envKey: "OPENAI_API_KEY",
    call: callOpenAI,
  },
  internal: {
    defaultModel: process.env.INTERNAL_LLM_MODEL || "llama3",
    envKey: null,   // no key required; set INTERNAL_LLM_URL instead
    call: callInternal,
  },
};

async function callAnthropic({ model, system, user, apiKey }) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      temperature: 0,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });
  if (!res.ok) throw await providerError("anthropic", res);
  const data = await res.json();
  const text = (data.content || []).filter(b => b.type === "text").map(b => b.text).join("");
  return { text, usage: data.usage, model: data.model };
}

async function callOpenAI({ model, system, user, apiKey }) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  if (!res.ok) throw await providerError("openai", res);
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content || "";
  return { text, usage: data.usage, model: data.model };
}

// Calls any OpenAI-compatible local endpoint (Ollama, LM Studio, vLLM, etc.)
async function callInternal({ model, system, user }) {
  const base = (process.env.INTERNAL_LLM_URL || "http://localhost:11434/v1").replace(/\/$/, "");
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model,
      temperature: 0,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  if (!res.ok) throw await providerError("internal", res);
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content || "";
  return { text, usage: data.usage, model: data.model || model };
}

async function providerError(name, res) {
  const body = await res.text().catch(() => "");
  return new Error(`${name} API ${res.status}: ${body.slice(0, 400)}`);
}
