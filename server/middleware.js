"use strict";

const { sendError } = require("./http");
const { extractSessionToken, sessionTokenHash, clearSessionCookie } = require("./auth");
const store = require("./store");
const dbModule = require("./db");

function dbRequired(req, res) {
  if (!dbModule.isAvailable()) {
    sendError(res, "db_unavailable");
    return false;
  }
  return true;
}

async function authenticate(req, res) {
  if (!dbModule.isAvailable()) {
    return { user: null, session: null, error: "db_unavailable" };
  }
  const token = extractSessionToken(req);
  if (!token) return { user: null, session: null, error: null };
  const hash = sessionTokenHash(token);
  const found = await store.findSession(hash);
  if (!found) {
    res.setHeader("Set-Cookie", clearSessionCookie());
    return { user: null, session: null, error: null };
  }
  return { user: found.user, session: found.session, tokenHash: hash, error: null };
}

function requireAuth() {
  return async (req, res) => {
    if (!dbRequired(req, res)) return null;
    const result = await authenticate(req, res);
    if (result.error) {
      sendError(res, "db_unavailable");
      return null;
    }
    if (!result.user) {
      sendError(res, "unauthorized");
      return null;
    }
    if (result.user.status !== "active") {
      res.setHeader("Set-Cookie", clearSessionCookie());
      sendError(res, "account_disabled");
      return null;
    }
    if (!result.user.emailVerified) {
      res.setHeader("Set-Cookie", clearSessionCookie());
      sendError(res, "email_not_verified");
      return null;
    }
    return { user: result.user, session: result.session, tokenHash: result.tokenHash };
  };
}

function requireRole(role) {
  return async (req, res) => {
    const auth = await requireAuth()(req, res);
    if (!auth) return null;
    if (auth.user.role !== role) {
      sendError(res, "forbidden");
      return null;
    }
    return auth;
  };
}

module.exports = { requireAuth, requireRole, authenticate, dbRequired };
