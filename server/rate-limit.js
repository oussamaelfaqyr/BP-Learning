"use strict";

const { config } = require("./config");
const dbModule = require("./db");

const buckets = new Map();
const SHARED_COLLECTION = "rateLimits";

function nowMs() {
  return Date.now();
}

function sweep() {
  const cutoff = nowMs();
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= cutoff) buckets.delete(key);
  }
}

function consumeMemory(key, windowMs, max) {
  if (buckets.size > 10000) sweep();
  const cutoff = nowMs();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= cutoff) {
    buckets.set(key, { count: 1, resetAt: cutoff + windowMs });
    return { allowed: true, remaining: max - 1, retryAfterMs: 0 };
  }
  bucket.count += 1;
  if (bucket.count > max) {
    return { allowed: false, remaining: 0, retryAfterMs: Math.max(0, bucket.resetAt - cutoff) };
  }
  return { allowed: true, remaining: max - bucket.count, retryAfterMs: 0 };
}

function sharedStoreEnabled() {
  const requested = (process.env.RATE_LIMIT_STORE || "").toLowerCase();
  if (requested === "memory" || requested === "in-memory") return false;
  if (requested === "mongodb" || requested === "mongo") return dbModule.isAvailable();
  return Boolean(process.env.VERCEL) && dbModule.isAvailable();
}

function windowPipeline(now, nextReset) {
  const resetAt = { $ifNull: ["$resetAt", new Date(0)] };
  return [
    {
      $set: {
        count: {
          $cond: [{ $lte: [resetAt, now] }, 1, { $add: [{ $ifNull: ["$count", 0] }, 1] }],
        },
        resetAt: {
          $cond: [{ $lte: [resetAt, now] }, nextReset, { $ifNull: ["$resetAt", nextReset] }],
        },
      },
    },
  ];
}

async function updateWindow(collection, key, now, nextReset, upsert) {
  const options = { returnDocument: "after" };
  if (upsert) options.upsert = true;
  const result = await collection.findOneAndUpdate(
    { _id: key },
    windowPipeline(now, nextReset),
    options
  );
  if (!result) return null;
  return result.value !== undefined ? result.value : result;
}

async function consumeShared(key, windowMs, max) {
  const db = dbModule.getDb();
  if (!db) return consumeMemory(key, windowMs, max);
  const collection = db.collection(SHARED_COLLECTION);
  const now = new Date();
  const nextReset = new Date(now.getTime() + windowMs);
  let record;
  try {
    record = await updateWindow(collection, key, now, nextReset, true);
  } catch (error) {
    if (error && error.code === 11000) {
      record = await updateWindow(collection, key, now, nextReset, false);
    } else {
      throw error;
    }
  }
  if (!record) return { allowed: true, remaining: max - 1, retryAfterMs: 0 };
  const count = Number(record.count) || 1;
  const resetAtMs =
    record.resetAt instanceof Date ? record.resetAt.getTime() : now.getTime() + windowMs;
  if (count > max) {
    return { allowed: false, remaining: 0, retryAfterMs: Math.max(0, resetAtMs - now.getTime()) };
  }
  return { allowed: true, remaining: Math.max(0, max - count), retryAfterMs: 0 };
}

async function consume(key, windowMs, max) {
  if (sharedStoreEnabled()) {
    try {
      return await consumeShared(key, windowMs, max);
    } catch (error) {
      console.error(`[rate-limit] shared store failed, using memory: ${error.message}`);
    }
  }
  return consumeMemory(key, windowMs, max);
}

function clientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0].trim().slice(0, 64);
  }
  return (req.socket && req.socket.remoteAddress) || "unknown";
}

async function loginLimiter(req, emailKey) {
  const ip = clientIp(req);
  const [ipResult, emailResult] = await Promise.all([
    consume(`login-ip:${ip}`, config.loginRate.windowMs, config.loginRate.maxPerIp),
    emailKey
      ? consume(`login-email:${emailKey}`, config.loginRate.windowMs, config.loginRate.maxPerEmail)
      : Promise.resolve({ allowed: true, remaining: 0, retryAfterMs: 0 }),
  ]);
  if (!ipResult.allowed || !emailResult.allowed) {
    return { allowed: false, retryAfterMs: Math.max(ipResult.retryAfterMs, emailResult.retryAfterMs) };
  }
  return { allowed: true, retryAfterMs: 0 };
}

function authLimiter(req) {
  const ip = clientIp(req);
  return consume(`auth-ip:${ip}`, config.authRate.windowMs, config.authRate.maxPerIp);
}

function reset() {
  buckets.clear();
}

module.exports = { loginLimiter, authLimiter, reset };
