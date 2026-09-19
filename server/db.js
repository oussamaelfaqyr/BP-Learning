"use strict";

const { MongoClient } = require("mongodb");
const { config } = require("./config");

let client = null;
let db = null;
let available = false;
let startupError = null;

const COLLECTIONS = [
  "users",
  "sessions",
  "passwordResetTokens",
  "emailVerificationTokens",
  "courses",
  "lessons",
  "courseAssignments",
  "lessonProgress",
  "simulationSessions",
  "evaluations",
  "auditLogs",
  "rateLimits",
];

async function connect() {
  if (!config.mongodbUri) {
    startupError = new Error("MONGODB_URI is not set");
    console.error("[db] MONGODB_URI is not set: authentication and persistence are disabled.");
    return false;
  }
  try {
    client = new MongoClient(config.mongodbUri, {
      maxPoolSize: 5,
      minPoolSize: 0,
      serverSelectionTimeoutMS: 5000,
      connectTimeoutMS: 10000,
    });
    await client.connect();
    db = client.db(config.mongoDbName || undefined);
    await client.db("admin").command({ ping: 1 });
    await createIndexes();
    available = true;
    console.log("[db] Connected to MongoDB Atlas.");
    return true;
  } catch (error) {
    startupError = error;
    console.error(`[db] MongoDB connection failed: ${error.message}`);
    try {
      if (client) await client.close();
    } catch {
      /* ignore */
    }
    client = null;
    db = null;
    available = false;
    return false;
  }
}

async function createIndexes() {
  const users = db.collection("users");
  const assignments = db.collection("courseAssignments");
  const progress = db.collection("lessonProgress");
  const sessions = db.collection("sessions");
  const resetTokens = db.collection("passwordResetTokens");
  const verificationTokens = db.collection("emailVerificationTokens");
  const simulations = db.collection("simulationSessions");
  const evaluations = db.collection("evaluations");
  const courses = db.collection("courses");
  const lessons = db.collection("lessons");
  const audit = db.collection("auditLogs");
  const rateLimits = db.collection("rateLimits");

  await users.createIndex({ email: 1 }, { unique: true, name: "users_email_unique" });
  await users.createIndex({ role: 1 }, { name: "users_role" });
  await users.createIndex({ status: 1 }, { name: "users_status" });

  await sessions.createIndex({ userId: 1 }, { name: "sessions_user" });
  await sessions.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0, name: "sessions_ttl" });

  await resetTokens.createIndex({ userId: 1 }, { name: "reset_tokens_user" });
  await resetTokens.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0, name: "reset_tokens_ttl" });

  await verificationTokens.createIndex({ userId: 1 }, { name: "verification_tokens_user" });
  await verificationTokens.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0, name: "verification_tokens_ttl" });

  await assignments.createIndex({ userId: 1 }, { name: "assignments_user" });
  await assignments.createIndex({ courseId: 1 }, { name: "assignments_course" });
  await assignments.createIndex({ userId: 1, courseId: 1 }, { unique: true, name: "assignments_user_course_unique" });

  await progress.createIndex({ userId: 1 }, { name: "progress_user" });
  await progress.createIndex({ courseId: 1 }, { name: "progress_course" });
  await progress.createIndex(
    { userId: 1, courseId: 1, moduleId: 1 },
    { unique: true, name: "progress_user_course_module_unique" }
  );

  await simulations.createIndex({ userId: 1, createdAt: -1 }, { name: "simulations_user_created" });
  await simulations.createIndex({ userId: 1, scenarioId: 1 }, { name: "simulations_user_scenario" });

  await evaluations.createIndex({ userId: 1, createdAt: -1 }, { name: "evaluations_user_created" });
  await evaluations.createIndex({ userId: 1, scenarioId: 1 }, { name: "evaluations_user_scenario" });

  await courses.createIndex({ status: 1, updatedAt: -1 }, { name: "courses_status_updated" });
  await courses.createIndex({ ownerUserId: 1 }, { name: "courses_owner" });
  await lessons.createIndex({ courseId: 1, moduleId: 1 }, { name: "lessons_course_module" });
  await lessons.createIndex({ userId: 1 }, { name: "lessons_user" });

  await audit.createIndex({ createdAt: -1 }, { name: "audit_created" });
  await audit.createIndex({ event: 1 }, { name: "audit_event" });

  await rateLimits.createIndex({ resetAt: 1 }, { expireAfterSeconds: 0, name: "rate_limits_ttl" });
}

function getDb() {
  return db;
}

function isAvailable() {
  return available;
}

function getStartupError() {
  return startupError;
}

async function close() {
  if (client) {
    await client.close();
    client = null;
    db = null;
    available = false;
  }
}

module.exports = { connect, getDb, isAvailable, getStartupError, close, COLLECTIONS };
