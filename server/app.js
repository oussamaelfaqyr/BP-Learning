"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const { config, loadEnvFile } = require("./config");
const db = require("./db");
const { handleApi } = require("./api-router");
const { sendJson, sendText, safeRoute, requireSameOrigin } = require("./http");
const deepseek = require("./deepseek");

const ROOT = path.join(__dirname, "..", "public");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".woff2": "font/woff2",
};

const BLOCKED_SEGMENTS = new Set(["server", "node_modules", "test", "scripts", ".env", ".tts-cache"]);

function resolveStaticPath(urlPath) {
  let pathname;
  try {
    pathname = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  if (pathname.includes("\0")) return null;
  if (pathname === "/") pathname = "/index.html";
  const segments = pathname.split("/").filter(Boolean);
  if (segments.some((segment) => segment.startsWith(".") || BLOCKED_SEGMENTS.has(segment))) return null;
  const resolved = path.resolve(ROOT, `.${pathname}`);
  if (resolved !== ROOT && !resolved.startsWith(ROOT + path.sep)) return null;
  if (!MIME[path.extname(resolved).toLowerCase()]) return null;
  return resolved;
}

function serveStatic(req, res, url) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    sendText(res, 405, "Method Not Allowed");
    return;
  }
  const filePath = resolveStaticPath(url.pathname);
  if (!filePath) {
    sendText(res, 404, "Not Found");
    return;
  }
  fs.stat(filePath, (error, stats) => {
    if (error || !stats.isFile()) {
      sendText(res, 404, "Not Found");
      return;
    }
    res.writeHead(200, {
      "Content-Type": MIME[path.extname(filePath).toLowerCase()],
      "Content-Length": stats.size,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "same-origin",
    });
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    const stream = fs.createReadStream(filePath);
    stream.on("error", () => res.destroy());
    stream.pipe(res);
  });
}

function handleRequest(req, res) {
  let url;
  try {
    url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  } catch {
    sendText(res, 400, "Bad Request");
    return;
  }
  res.on("finish", () => {
    if (process.env.LOG_HTTP !== "quiet") {
      console.log(`${req.method} ${url.pathname} ${res.statusCode}`);
    }
  });
  try {
    if (url.pathname.startsWith("/api/")) {
      safeRoute(req, res, async () => {
        await requireSameOrigin(req, res, async () => {
          await handleApi(req, res, url);
        });
      });
    } else {
      serveStatic(req, res, url);
    }
  } catch {
    if (!res.headersSent) sendJson(res, 500, { error: "internal_error" });
    else res.destroy();
  }
}

function createServer() {
  return http.createServer(handleRequest);
}

async function start() {
  if (config.isProduction && !process.env.SESSION_SECRET) {
    throw new Error("SESSION_SECRET is required in production.");
  }
  if (!config.sessionSecret || config.sessionSecret === "dev-session-secret-change-me") {
    if (!config.isProduction) {
      console.warn(
        "[auth] Using the default development SESSION_SECRET. Set SESSION_SECRET for stable sessions."
      );
    }
  }
  await db.connect();
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.port, () => {
      server.removeListener("error", reject);
      resolve();
    });
  });
  console.log(`BP Learning server running on http://127.0.0.1:${config.port}`);
  console.log(`AI service configured: ${deepseek.isConfigured() ? "yes" : "no"}`);
  console.log(`MongoDB: ${db.isAvailable() ? "connected" : "unavailable (auth disabled)"}`);
  return server;
}

async function stop(server) {
  if (server) {
    if (typeof server.closeIdleConnections === "function") server.closeIdleConnections();
    await new Promise((resolve) => {
      server.close(() => resolve());
      setTimeout(resolve, 2000).unref();
    });
  }
  await db.close();
}

module.exports = { createServer, handleRequest, start, stop, config, db };
