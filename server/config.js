"use strict";

const fs = require("fs");
const path = require("path");

function loadEnvFile(rootDir) {
  const envPath = path.join(rootDir, ".env");
  if (!fs.existsSync(envPath)) return;
  let content;
  try {
    content = fs.readFileSync(envPath, "utf8");
  } catch {
    return;
  }
  content.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const separator = trimmed.indexOf("=");
    if (separator === -1) return;
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key && process.env[key] === undefined) process.env[key] = value;
  });
}

function boolEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  return !/^(0|false|no|off)$/i.test(raw.trim());
}

function numberEnv(name, fallback, min, max) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

function listEnv(name) {
  return (process.env[name] || "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

if (!/^test$/.test(process.env.NODE_ENV || "")) {
  loadEnvFile(path.join(__dirname, ".."));
}

const config = {
  env: (process.env.NODE_ENV || "development").toLowerCase(),
  isProduction: (process.env.NODE_ENV || "").toLowerCase() === "production",
  port: numberEnv("PORT", 8089, 1, 65535),
  mongodbUri: process.env.MONGODB_URI || "",
  mongoDbName: process.env.MONGODB_DB_NAME || "",
  sessionSecret:
    process.env.SESSION_SECRET ||
    (process.env.NODE_ENV === "production" ? "" : "dev-session-secret-change-me"),
  sessionTtlMs: numberEnv("SESSION_TTL_DAYS", 7, 1, 30) * 24 * 60 * 60 * 1000,
  sessionCookieName: "bp_session",
  allowPublicRegistration: boolEnv("ALLOW_PUBLIC_REGISTRATION", true),
  adminEmails: listEnv("ADMIN_EMAILS"),
  resetTokenTtlMs: numberEnv("RESET_TOKEN_TTL_MINUTES", 60, 5, 1440) * 60 * 1000,
  emailVerificationTtlMs:
    numberEnv("EMAIL_VERIFICATION_TTL_HOURS", 24, 1, 168) * 60 * 60 * 1000,
  appBaseUrl: (process.env.APP_BASE_URL || "http://127.0.0.1:8089").replace(/\/+$/, ""),
  emailFrom: process.env.EMAIL_FROM || "no-reply@bp-learning.local",
  ttsServiceUrl: process.env.TTS_SERVICE_URL || "http://127.0.0.1:8765",
  loginRate: {
    windowMs: numberEnv("LOGIN_RATE_WINDOW_MS", 15 * 60 * 1000, 1000, 86400000),
    maxPerIp: numberEnv("LOGIN_RATE_MAX_PER_IP", 12, 1, 1000),
    maxPerEmail: numberEnv("LOGIN_RATE_MAX_PER_EMAIL", 8, 1, 1000),
  },
  authRate: {
    windowMs: numberEnv("AUTH_RATE_WINDOW_MS", 60 * 60 * 1000, 1000, 86400000),
    maxPerIp: numberEnv("AUTH_RATE_MAX_PER_IP", 8, 1, 1000),
  },
};

module.exports = { config, loadEnvFile, boolEnv, numberEnv, listEnv };
