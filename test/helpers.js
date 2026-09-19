"use strict";

const { MongoMemoryServer } = require("mongodb-memory-server");

process.env.LOG_HTTP = "quiet";
process.env.SESSION_SECRET = "test-session-secret-not-for-production";
process.env.NODE_ENV = "test";
process.env.ALLOW_PUBLIC_REGISTRATION = "true";
process.env.ADMIN_EMAILS = "";

let mongo = null;
let server = null;
let baseUrl = "";

async function startTestServer() {
  mongo = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongo.getUri();
  process.env.PORT = String(8000 + Math.floor(Math.random() * 2000));
  const app = require("../server/app");
  server = await app.start();
  baseUrl = `http://127.0.0.1:${process.env.PORT}`;
  return { baseUrl, app, mongo };
}

async function stopTestServer() {
  const app = require("../server/app");
  await app.stop(server);
  server = null;
  if (mongo) {
    await mongo.stop();
    mongo = null;
  }
  resetRateLimits();
}

function resetRateLimits() {
  try {
    require("../server/rate-limit").reset();
  } catch { /* module not loaded yet */ }
}

function makeClient(base) {
  const cookies = new Map();
  return {
    cookies,
    async request(method, path, { body, headers = {}, origin } = {}) {
      const requestHeaders = { Connection: "close", ...headers };
      if (body !== undefined) {
        requestHeaders["Content-Type"] = "application/json";
      }
      if (origin) requestHeaders.Origin = origin;
      const cookieHeader = [...cookies.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
      if (cookieHeader) requestHeaders.Cookie = cookieHeader;
      const response = await fetch(`${base}${path}`, {
        method,
        headers: requestHeaders,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        redirect: "manual",
      });
      const setCookies = response.headers.getSetCookie ? response.headers.getSetCookie() : [];
      for (const header of setCookies) {
        const [pair] = header.split(";");
        const separator = pair.indexOf("=");
        if (separator === -1) continue;
        const name = pair.slice(0, separator).trim();
        const value = pair.slice(separator + 1).trim();
        if (!value) cookies.delete(name);
        else cookies.set(name, value);
      }
      let json = null;
      const text = await response.text();
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = null;
      }
      return { status: response.status, json, headers: response.headers, text };
    },
  };
}

function expectError(response, code) {
  if (!response.json || !response.json.error) {
    throw new Error(`Expected error payload, got: ${JSON.stringify(response.json)}`);
  }
  const actual = typeof response.json.error === "string" ? response.json.error : response.json.error.code;
  if (actual !== code.toUpperCase()) {
    throw new Error(`Expected error ${code.toUpperCase()}, got ${actual}`);
  }
}

const USER_PASSWORD = "MotDePasse-123!";

async function registerUser(client, base, overrides = {}) {
  const payload = {
    firstName: overrides.firstName || "Sara",
    lastName: overrides.lastName || "Benali",
    email: overrides.email || `sara.${Date.now()}.${Math.floor(Math.random() * 9999)}@example.com`,
    password: overrides.password || USER_PASSWORD,
  };
  const response = await client.request("POST", "/api/auth/register", { body: payload });
  if (response.status !== 201) {
    throw new Error(`registerUser failed: ${response.status} ${JSON.stringify(response.json)}`);
  }
  return { ...response, payload };
}

async function registerAdmin(client, base) {
  process.env.ADMIN_EMAILS = "";
  const adminEmail = `admin.${Date.now()}.${Math.floor(Math.random() * 9999)}@example.com`;
  const app = require("../server/app");
  const config = app.config;
  config.adminEmails = [adminEmail];
  const payload = {
    firstName: "Adam",
    lastName: "Admin",
    email: adminEmail,
    password: USER_PASSWORD,
  };
  const response = await client.request("POST", "/api/auth/register", { body: payload });
  if (response.status !== 201) {
    throw new Error(`registerAdmin failed: ${response.status} ${JSON.stringify(response.json)}`);
  }
  return { ...response, payload, email: adminEmail };
}

module.exports = {
  startTestServer,
  stopTestServer,
  makeClient,
  expectError,
  registerUser,
  registerAdmin,
  resetRateLimits,
  USER_PASSWORD,
};
