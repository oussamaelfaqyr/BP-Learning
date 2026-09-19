"use strict";

const crypto = require("crypto");
const { config } = require("./config");

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

function scryptAsync(password, salt, n, r, p, keyLength) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, keyLength, { N: n, r, p, maxmem: 64 * 1024 * 1024 }, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(SALT_LENGTH);
  const key = await scryptAsync(password, salt, SCRYPT_N, SCRYPT_R, SCRYPT_P, KEY_LENGTH);
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString("hex")}$${key.toString("hex")}`;
}

async function verifyPassword(password, storedHash) {
  if (typeof storedHash !== "string" || !storedHash.startsWith("scrypt$")) return false;
  const parts = storedHash.split("$");
  if (parts.length !== 6) return false;
  const n = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  const saltHex = parts[4];
  const hashHex = parts[5];
  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p) || n <= 0 || r <= 0 || p <= 0) return false;
  if (!/^[a-f0-9]+$/i.test(saltHex) || !/^[a-f0-9]+$/i.test(hashHex)) return false;
  const expected = Buffer.from(hashHex, "hex");
  if (!expected.length) return false;
  let key;
  try {
    key = await scryptAsync(password, Buffer.from(saltHex, "hex"), n, r, p, expected.length);
  } catch {
    return false;
  }
  return key.length === expected.length && crypto.timingSafeEqual(key, expected);
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString("hex");
}

function sessionTokenHash(token) {
  return sha256(`session|${token}`);
}

function resetTokenHash(token) {
  return sha256(`reset|${token}`);
}

function verificationTokenHash(token) {
  return sha256(`verify|${token}`);
}

function secureCookieOptions() {
  return {
    httpOnly: true,
    secure: config.isProduction || process.env.COOKIE_SECURE === "true",
    sameSite: "lax",
    path: "/",
    maxAge: config.sessionTtlMs,
  };
}

function sessionTtl() {
  return config.sessionTtlMs;
}

function buildSessionRecord(userId, token, req) {
  const now = new Date();
  return {
    _id: sessionTokenHash(token),
    userId,
    createdAt: now,
    lastSeenAt: now,
    expiresAt: new Date(now.getTime() + config.sessionTtlMs),
    ip: req.socket.remoteAddress || "",
    userAgent: typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"].slice(0, 200) : "",
  };
}

function serializeCookie(name, value, options) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  if (options.maxAge) parts.push(`Max-Age=${Math.floor(options.maxAge / 1000)}`);
  parts.push(`Path=${options.path || "/"}`);
  if (options.httpOnly) parts.push("HttpOnly");
  if (options.secure) parts.push("Secure");
  if (options.sameSite) parts.push(`SameSite=${options.sameSite.charAt(0).toUpperCase()}${options.sameSite.slice(1)}`);
  return parts.join("; ");
}

function parseCookies(header) {
  const cookies = {};
  if (typeof header !== "string") return cookies;
  header.split(";").forEach((part) => {
    const separator = part.indexOf("=");
    if (separator === -1) return;
    const key = part.slice(0, separator).trim();
    let value = part.slice(separator + 1).trim();
    try {
      value = decodeURIComponent(value);
    } catch {
      return;
    }
    if (key) cookies[key] = value;
  });
  return cookies;
}

function extractSessionToken(req) {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies[config.sessionCookieName];
  if (typeof token !== "string" || !/^[a-f0-9]{64}$/i.test(token)) return null;
  return token;
}

function clearSessionCookie() {
  return serializeCookie(config.sessionCookieName, "", {
    httpOnly: true,
    secure: config.isProduction || process.env.COOKIE_SECURE === "true",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

module.exports = {
  hashPassword,
  verifyPassword,
  sha256,
  randomToken,
  sessionTokenHash,
  resetTokenHash,
  verificationTokenHash,
  secureCookieOptions,
  sessionTtl,
  buildSessionRecord,
  serializeCookie,
  parseCookies,
  extractSessionToken,
  clearSessionCookie,
  SCRYPT_N,
};
