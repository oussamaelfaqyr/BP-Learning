"use strict";

const app = require("../server/app");
const db = require("../server/db");

if (app.config.isProduction && !process.env.SESSION_SECRET) {
  throw new Error("SESSION_SECRET is required in production.");
}

let connectionPromise = null;

function ensureDatabase() {
  if (db.isAvailable()) return Promise.resolve(true);
  if (!connectionPromise) {
    connectionPromise = db
      .connect()
      .then((connected) => {
        if (!connected && app.config.mongodbUri) connectionPromise = null;
        return connected;
      })
      .catch((error) => {
        console.error(`[api] database connection failed: ${error.message}`);
        connectionPromise = null;
        return false;
      });
  }
  return connectionPromise;
}

function restoreMatchedPath(req) {
  const matched = req.headers["x-matched-path"];
  if (typeof matched !== "string" || !matched.startsWith("/api/")) return;
  const separator = matched.indexOf("?");
  const pathname = separator === -1 ? matched : matched.slice(0, separator);
  const search = separator === -1 ? "" : matched.slice(separator);
  let originalSearch = "";
  try {
    originalSearch = new URL(req.url, "http://localhost").search;
  } catch {
    originalSearch = "";
  }
  req.url = pathname + (search || originalSearch);
}

module.exports = async function handler(req, res) {
  restoreMatchedPath(req);
  try {
    await ensureDatabase();
  } catch (error) {
    console.error(`[api] database initialization failed: ${error.message}`);
  }
  return app.handleRequest(req, res);
};
