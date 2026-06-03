// ─────────────────────────────────────────────────────────────────────────────
// handler.js — provider-agnostic extraction handler shared by the local server
// (server.js) and the serverless function (api/extract.js).
//
// Input  (POST body): { provider, model, fileName, mimeType, documentText, tables }
// Output: { raw, meta }  where `raw` is the model's JSON (pre-normalize) and
//         `meta` carries model id + token usage + timing. The browser normalizes
//         `raw` through the shared schema, so output is identical everywhere.
// ─────────────────────────────────────────────────────────────────────────────

import { PROVIDERS } from "./providers.js";
import { SYSTEM_PROMPT, buildUserPrompt, PROMPT_VERSION } from "./prompt.js";

export async function handleExtract(body) {
  const providerName = (body.provider || "anthropic").toLowerCase();
  const provider = PROVIDERS[providerName];
  if (!provider) return err(400, `unknown provider "${providerName}"`);

  const apiKey = process.env[provider.envKey];
  if (!apiKey) return err(500, `${provider.envKey} is not set on the proxy`);

  if (!body.documentText && !(body.tables && body.tables.length))
    return err(400, "no document content provided");

  const model = body.model || provider.defaultModel;
  const user = buildUserPrompt(body);
  const t0 = Date.now();

  let out;
  try {
    out = await provider.call({ model, system: SYSTEM_PROMPT, user, apiKey });
  } catch (e) {
    return err(502, e.message);
  }

  const raw = parseJsonLoose(out.text);
  if (!raw) return err(502, "model did not return valid JSON");

  return {
    status: 200,
    json: {
      raw,
      meta: {
        provider: providerName,
        model: out.model || model,
        promptVersion: PROMPT_VERSION,
        durationMs: Date.now() - t0,
        usage: out.usage || null,
      },
    },
  };
}

// Models occasionally wrap JSON in prose or ```fences``` despite instructions;
// recover the first balanced {...} object.
function parseJsonLoose(text) {
  if (!text) return null;
  try { return JSON.parse(text); } catch { /* fall through */ }
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) { try { return JSON.parse(fenced[1]); } catch { /* fall through */ } }
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try { return JSON.parse(text.slice(start, end + 1)); } catch { /* fall through */ }
  }
  return null;
}

function err(status, message) { return { status, json: { error: message } }; }
