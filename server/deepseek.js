"use strict";

const DEFAULT_BASE_URL = "https://api.deepseek.com";
const DEFAULT_MODEL = "deepseek-flash";
const DEFAULT_TIMEOUT_MS = 20000;

class DeepSeekError extends Error {
  constructor(code, message, status) {
    super(message);
    this.name = "DeepSeekError";
    this.code = code;
    this.status = status || 502;
  }
}

function loadConfig() {
  return {
    apiKey: process.env.DEEPSEEK_API_KEY || "",
    baseUrl: (process.env.DEEPSEEK_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, ""),
    model: process.env.DEEPSEEK_MODEL || DEFAULT_MODEL,
  };
}

function isConfigured() {
  return Boolean((process.env.DEEPSEEK_API_KEY || "").trim());
}

function getPublicConfig() {
  return { configured: isConfigured(), model: loadConfig().model };
}

function mapStatusToCode(status) {
  if (status === 401 || status === 403) return "auth";
  if (status === 402) return "balance";
  if (status === 429) return "rate_limit";
  if (status >= 500) return "upstream";
  return "bad_request";
}

async function chatCompletion({ messages, temperature = 1, maxTokens, jsonMode = false, timeoutMs = DEFAULT_TIMEOUT_MS, thinking, reasoningEffort }) {
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new DeepSeekError("bad_request", "Messages are required", 400);
  }
  if (!isConfigured()) {
    throw new DeepSeekError("not_configured", "AI service is not configured", 503);
  }
  const { apiKey, baseUrl, model } = loadConfig();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        stream: false,
        temperature,
        ...(maxTokens ? { max_tokens: maxTokens } : {}),
        ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
        ...(thinking && (thinking.type === "enabled" || thinking.type === "disabled") ? { thinking: { type: thinking.type } } : {}),
        ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
      }),
      signal: controller.signal,
    });
  } catch (error) {
    if (error && error.name === "AbortError") {
      throw new DeepSeekError("timeout", "AI request timed out", 504);
    }
    throw new DeepSeekError("unreachable", "AI service unreachable", 502);
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) {
    throw new DeepSeekError(mapStatusToCode(response.status), `AI service error (${response.status})`, response.status);
  }
  let data;
  try {
    data = await response.json();
  } catch {
    throw new DeepSeekError("malformed", "Malformed AI response", 502);
  }
  const choice = data && Array.isArray(data.choices) ? data.choices[0] : null;
  const content = choice && choice.message ? choice.message.content : null;
  if (typeof content !== "string" || !content.trim()) {
    throw new DeepSeekError("empty", "Empty AI response", 502);
  }
  return { content, finishReason: choice.finish_reason || null, usage: data.usage || null };
}

module.exports = { DeepSeekError, loadConfig, isConfigured, getPublicConfig, chatCompletion };
