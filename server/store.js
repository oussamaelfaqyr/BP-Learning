"use strict";

const { ObjectId } = require("mongodb");
const dbModule = require("./db");
const { toObjectId } = require("./validation");
const { config } = require("./config");

function getDb() {
  const db = dbModule.getDb();
  if (!db) throw Object.assign(new Error("database_unavailable"), { code: "db_unavailable" });
  return db;
}

const collections = () => {
  const db = getDb();
  return {
    users: db.collection("users"),
    sessions: db.collection("sessions"),
    resetTokens: db.collection("passwordResetTokens"),
    verificationTokens: db.collection("emailVerificationTokens"),
    courses: db.collection("courses"),
    lessons: db.collection("lessons"),
    assignments: db.collection("courseAssignments"),
    progress: db.collection("lessonProgress"),
    simulations: db.collection("simulationSessions"),
    evaluations: db.collection("evaluations"),
    audit: db.collection("auditLogs"),
  };
};

function publicUser(user) {
  if (!user) return null;
  return {
    id: user._id.toString(),
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    role: user.role,
    status: user.status,
    emailVerified: Boolean(user.emailVerified),
    learningObjective: user.learningObjective || "",
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    lastLoginAt: user.lastLoginAt || null,
  };
}

function publicCourse(course) {
  if (!course) return null;
  return {
    id: course._id.toString(),
    title: course.title,
    objective: course.objective,
    description: course.description || "",
    estimatedDuration: course.estimatedDuration || "",
    modules: course.modules || [],
    status: course.status,
    origin: course.origin,
    ownerUserId: course.ownerUserId ? course.ownerUserId.toString() : null,
    createdBy: course.createdBy ? course.createdBy.toString() : null,
    createdAt: course.createdAt,
    updatedAt: course.updatedAt,
    publishedAt: course.publishedAt || null,
  };
}

function publicAssignment(assignment, course) {
  if (!assignment) return null;
  return {
    id: assignment._id.toString(),
    userId: assignment.userId.toString(),
    courseId: assignment.courseId.toString(),
    course: course ? publicCourse(course) : null,
    status: assignment.status,
    assignedBy: assignment.assignedBy ? assignment.assignedBy.toString() : null,
    assignedAt: assignment.assignedAt,
    deadline: assignment.deadline || null,
    completedAt: assignment.completedAt || null,
  };
}

/* ------------------------------ users ------------------------------ */

async function findUserByEmail(email) {
  return collections().users.findOne({ email });
}

async function findUserById(id) {
  const objectId = toObjectId(id);
  if (!objectId) return null;
  return collections().users.findOne({ _id: objectId });
}

async function createUser(fields) {
  const now = new Date();
  const doc = {
    email: fields.email,
    passwordHash: fields.passwordHash || null,
    firstName: fields.firstName,
    lastName: fields.lastName,
    role: fields.role || "user",
    status: fields.status || "active",
    emailVerified: fields.emailVerified === undefined ? false : Boolean(fields.emailVerified),
    learningObjective: fields.learningObjective || "",
    createdAt: now,
    updatedAt: now,
    lastLoginAt: null,
  };
  const result = await collections().users.insertOne(doc);
  doc._id = result.insertedId;
  return doc;
}

async function updateUser(id, update) {
  const objectId = toObjectId(id);
  if (!objectId) return null;
  update.updatedAt = new Date();
  const result = await collections().users.findOneAndUpdate(
    { _id: objectId },
    { $set: update },
    { returnDocument: "after" }
  );
  return result || null;
}

async function setUserPassword(id, passwordHash) {
  const objectId = toObjectId(id);
  if (!objectId) return false;
  const result = await collections().users.updateOne(
    { _id: objectId },
    { $set: { passwordHash, updatedAt: new Date() } }
  );
  return result.modifiedCount === 1;
}

async function recordUserLogin(id) {
  const objectId = toObjectId(id);
  if (!objectId) return;
  await collections().users.updateOne({ _id: objectId }, { $set: { lastLoginAt: new Date() } });
}

async function listUsers({ search = "", role = "", status = "", limit = 25, offset = 0 } = {}) {
  const filter = {};
  if (role) filter.role = role;
  if (status) filter.status = status;
  if (search) {
    const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    filter.$or = [
      { email: { $regex: escaped, $options: "i" } },
      { firstName: { $regex: escaped, $options: "i" } },
      { lastName: { $regex: escaped, $options: "i" } },
    ];
  }
  const users = await collections()
    .users.find(filter, { sort: { createdAt: -1 } })
    .skip(offset)
    .limit(limit)
    .toArray();
  const total = await collections().users.countDocuments(filter);
  return { users: users.map(publicUser), total };
}

async function countUsers(filter = {}) {
  return collections().users.countDocuments(filter);
}

async function countActiveAdmins() {
  return collections().users.countDocuments({ status: "active" });
}

/* ------------------------------ sessions ------------------------------ */

async function createSession(record) {
  await collections().sessions.insertOne(record);
}

async function findSession(tokenHash) {
  const session = await collections().sessions.findOne({ _id: tokenHash });
  if (!session) return null;
  if (session.expiresAt && session.expiresAt.getTime() <= Date.now()) return null;
  const user = await findUserById(session.userId);
  if (!user) return null;
  return { session, user };
}

async function touchSession(tokenHash) {
  const session = await collections().sessions.findOne({ _id: tokenHash });
  if (!session) return false;
  if (session.expiresAt.getTime() - Date.now() < 24 * 60 * 60 * 1000) {
    await collections().sessions.updateOne(
      { _id: tokenHash },
      { $set: { lastSeenAt: new Date(), expiresAt: new Date(Date.now() + config.sessionTtlMs) } }
    );
  } else {
    await collections().sessions.updateOne({ _id: tokenHash }, { $set: { lastSeenAt: new Date() } });
  }
  return true;
}

async function deleteSession(tokenHash) {
  await collections().sessions.deleteOne({ _id: tokenHash });
}

async function deleteAllSessionsForUser(userId) {
  const objectId = toObjectId(userId);
  if (!objectId) return;
  await collections().sessions.deleteMany({ userId: objectId });
}

/* --------------------------- reset tokens --------------------------- */

async function createResetToken(userId, tokenHash) {
  const now = new Date();
  await collections().resetTokens.insertOne({
    _id: tokenHash,
    userId: toObjectId(userId),
    createdAt: now,
    expiresAt: new Date(now.getTime() + config.resetTokenTtlMs),
    usedAt: null,
  });
}

async function consumeResetToken(tokenHash) {
  const result = await collections().resetTokens.findOneAndUpdate(
    { _id: tokenHash, usedAt: null, expiresAt: { $gt: new Date() } },
    { $set: { usedAt: new Date() } },
    { returnDocument: "after" }
  );
  return result || null;
}

/* ------------------------- verification tokens ------------------------- */

async function createVerificationToken(userId, tokenHash) {
  const now = new Date();
  const userObjectId = toObjectId(userId);
  if (!userObjectId) return;
  await collections().verificationTokens.deleteMany({ userId: userObjectId });
  await collections().verificationTokens.insertOne({
    _id: tokenHash,
    userId: userObjectId,
    createdAt: now,
    expiresAt: new Date(now.getTime() + config.emailVerificationTtlMs),
    usedAt: null,
  });
}

async function consumeVerificationToken(tokenHash) {
  const result = await collections().verificationTokens.findOneAndUpdate(
    { _id: tokenHash, usedAt: null, expiresAt: { $gt: new Date() } },
    { $set: { usedAt: new Date() } },
    { returnDocument: "after" }
  );
  return result || null;
}

async function markEmailVerified(userId) {
  const objectId = toObjectId(userId);
  if (!objectId) return false;
  const result = await collections().users.updateOne(
    { _id: objectId },
    { $set: { emailVerified: true, updatedAt: new Date() } }
  );
  return result.modifiedCount === 1;
}

/* ------------------------------ courses ------------------------------ */

async function createCourse(fields) {
  const now = new Date();
  const doc = {
    title: fields.title,
    objective: fields.objective,
    description: fields.description || "",
    estimatedDuration: fields.estimatedDuration || "Environ 20 minutes",
    modules: fields.modules || [],
    status: fields.status || "draft",
    origin: fields.origin || "admin",
    ownerUserId: fields.ownerUserId ? toObjectId(fields.ownerUserId) : null,
    createdBy: fields.createdBy ? toObjectId(fields.createdBy) : null,
    createdAt: now,
    updatedAt: now,
    publishedAt: fields.status === "published" ? now : null,
  };
  const result = await collections().courses.insertOne(doc);
  doc._id = result.insertedId;
  return doc;
}

async function findCourseById(id) {
  const objectId = toObjectId(id);
  if (!objectId) return null;
  return collections().courses.findOne({ _id: objectId });
}

async function updateCourse(id, update) {
  const objectId = toObjectId(id);
  if (!objectId) return null;
  update.updatedAt = new Date();
  const result = await collections().courses.findOneAndUpdate(
    { _id: objectId },
    { $set: update },
    { returnDocument: "after" }
  );
  return result || null;
}

async function listCourses({ status = "", ownerUserId = "", limit = 100, offset = 0 } = {}) {
  const filter = {};
  if (status) filter.status = status;
  if (ownerUserId) {
    const ownerObjectId = toObjectId(ownerUserId);
    if (!ownerObjectId) return [];
    filter.ownerUserId = ownerObjectId;
  }
  const items = await collections()
    .courses.find(filter, { sort: { updatedAt: -1 } })
    .skip(offset)
    .limit(limit)
    .toArray();
  return items.map(publicCourse);
}

async function countCourses(filter = {}) {
  return collections().courses.countDocuments(filter);
}

/* ------------------------------ lessons ------------------------------ */

async function saveLesson(fields) {
  const now = new Date();
  const filter = {
    courseId: toObjectId(fields.courseId),
    moduleId: fields.moduleId,
    userId: fields.userId ? toObjectId(fields.userId) : null,
  };
  const doc = {
    ...filter,
    courseTitle: fields.courseTitle || "",
    content: fields.content,
    createdAt: now,
    updatedAt: now,
  };
  await collections().lessons.updateOne(filter, { $set: doc }, { upsert: true });
  return doc;
}

async function findLesson(courseId, moduleId, userId) {
  return collections().lessons.findOne({
    courseId: toObjectId(courseId),
    moduleId,
    userId: userId ? toObjectId(userId) : null,
  });
}

/* ---------------------------- assignments ---------------------------- */

async function assignCourse(courseId, userIds, adminId, deadline) {
  const courseObjectId = toObjectId(courseId);
  const now = new Date();
  const docs = userIds.map((userId) => ({
    courseId: courseObjectId,
    userId: toObjectId(userId),
    status: "assigned",
    assignedBy: toObjectId(adminId),
    assignedAt: now,
    deadline: deadline || null,
    completedAt: null,
  }));
  const results = [];
  for (const doc of docs) {
    if (!doc.courseId || !doc.userId) continue;
    try {
      await collections().assignments.updateOne(
        { courseId: doc.courseId, userId: doc.userId },
        { $setOnInsert: doc },
        { upsert: true }
      );
      const saved = await collections().assignments.findOne({ courseId: doc.courseId, userId: doc.userId });
      if (saved) results.push(saved);
    } catch {
      /* duplicate race: keep going */
    }
  }
  return results;
}

async function listAssignments({ userId = "", courseId = "", limit = 200, offset = 0 } = {}) {
  const filter = {};
  if (userId) {
    const objectId = toObjectId(userId);
    if (!objectId) return { assignments: [], total: 0 };
    filter.userId = objectId;
  }
  if (courseId) {
    const objectId = toObjectId(courseId);
    if (!objectId) return { assignments: [], total: 0 };
    filter.courseId = objectId;
  }
  const items = await collections()
    .assignments.find(filter, { sort: { assignedAt: -1 } })
    .skip(offset)
    .limit(limit)
    .toArray();
  const total = await collections().assignments.countDocuments(filter);
  const courseIds = [...new Set(items.map((item) => item.courseId.toString()))];
  const courses = await collections()
    .courses.find({ _id: { $in: courseIds.map((id) => toObjectId(id)) } })
    .toArray();
  const byId = new Map(courses.map((course) => [course._id.toString(), course]));
  return { assignments: items.map((item) => publicAssignment(item, byId.get(item.courseId.toString()))), total };
}

async function unassignCourse(assignmentId) {
  const objectId = toObjectId(assignmentId);
  if (!objectId) return null;
  const existing = await collections().assignments.findOne({ _id: objectId });
  if (!existing) return null;
  await collections().assignments.deleteOne({ _id: objectId });
  return existing;
}

async function markAssignmentCompleted(userId, courseId) {
  const userObjectId = toObjectId(userId);
  const courseObjectId = toObjectId(courseId);
  if (!userObjectId || !courseObjectId) return;
  await collections().assignments.updateOne(
    { userId: userObjectId, courseId: courseObjectId },
    { $set: { status: "completed", completedAt: new Date() } }
  );
}

async function findAssignment(userId, courseId) {
  const userObjectId = toObjectId(userId);
  const courseObjectId = toObjectId(courseId);
  if (!userObjectId || !courseObjectId) return null;
  return collections().assignments.findOne({ userId: userObjectId, courseId: courseObjectId });
}

/* --------------------------- lesson progress --------------------------- */

async function upsertLessonProgress(userId, courseId, moduleId, data) {
  const userObjectId = toObjectId(userId);
  const courseObjectId = toObjectId(courseId);
  if (!userObjectId || !courseObjectId) return null;
  const now = new Date();
  const result = await collections().progress.findOneAndUpdate(
    { userId: userObjectId, courseId: courseObjectId, moduleId },
    { $set: { ...data, userId: userObjectId, courseId: courseObjectId, moduleId, updatedAt: now } },
    { upsert: true, returnDocument: "after" }
  );
  return result;
}

async function listLessonProgress(userId, courseId) {
  const userObjectId = toObjectId(userId);
  if (!userObjectId) return [];
  const filter = { userId: userObjectId };
  if (courseId) {
    const courseObjectId = toObjectId(courseId);
    if (!courseObjectId) return [];
    filter.courseId = courseObjectId;
  }
  return collections().progress.find(filter).toArray();
}

async function countCompletedModules(userId, courseId) {
  const userObjectId = toObjectId(userId);
  const courseObjectId = toObjectId(courseId);
  if (!userObjectId || !courseObjectId) return 0;
  return collections().progress.countDocuments({
    userId: userObjectId,
    courseId: courseObjectId,
    completed: true,
  });
}

async function deleteUserData(userId) {
  const userObjectId = toObjectId(userId);
  if (!userObjectId) return;
  await collections().progress.deleteMany({ userId: userObjectId });
  await collections().assignments.deleteMany({ userId: userObjectId });
  await collections().simulations.deleteMany({ userId: userObjectId });
  await collections().evaluations.deleteMany({ userId: userObjectId });
}

/* ---------------------------- simulations ---------------------------- */

async function createSimulation(fields) {
  const now = new Date();
  const doc = {
    userId: toObjectId(fields.userId),
    courseId: fields.courseId ? toObjectId(fields.courseId) : null,
    moduleId: fields.moduleId || null,
    scenarioId: fields.scenarioId,
    messages: fields.messages || [],
    status: fields.status || "complete",
    practiceTarget: fields.practiceTarget || null,
    evaluation: fields.evaluation || null,
    migrated: Boolean(fields.migrated),
    startedAt: fields.startedAt || now,
    endedAt: fields.endedAt || now,
    createdAt: now,
  };
  const result = await collections().simulations.insertOne(doc);
  doc._id = result.insertedId;
  return doc;
}

async function listSimulations(userId, limit = 10) {
  const userObjectId = toObjectId(userId);
  if (!userObjectId) return [];
  return collections()
    .simulations.find({ userId: userObjectId }, { sort: { createdAt: -1 } })
    .limit(limit)
    .toArray();
}

async function listRecentSimulations(limit = 10) {
  return collections()
    .simulations.find({}, { sort: { createdAt: -1 } })
    .limit(limit)
    .toArray();
}

async function countSimulations(filter = {}) {
  return collections().simulations.countDocuments(filter);
}

/* ---------------------------- evaluations ---------------------------- */

async function createEvaluation(fields) {
  const now = new Date();
  const doc = {
    userId: toObjectId(fields.userId),
    simulationId: fields.simulationId ? toObjectId(fields.simulationId) : null,
    courseId: fields.courseId ? toObjectId(fields.courseId) : null,
    moduleId: fields.moduleId || null,
    scenarioId: fields.scenarioId,
    overall: fields.overall,
    criteria: fields.criteria || [],
    priority: fields.priority,
    nextPractice: fields.nextPractice,
    strengths: fields.strengths || [],
    createdAt: now,
  };
  const result = await collections().evaluations.insertOne(doc);
  doc._id = result.insertedId;
  return doc;
}

async function listEvaluations(userId, limit = 10) {
  const userObjectId = toObjectId(userId);
  if (!userObjectId) return [];
  return collections()
    .evaluations.find({ userId: userObjectId }, { sort: { createdAt: -1 } })
    .limit(limit)
    .toArray();
}

async function listRecentEvaluations(limit = 50) {
  return collections()
    .evaluations.find({}, { sort: { createdAt: -1 } })
    .limit(limit)
    .toArray();
}

/* ------------------------------ audit ------------------------------ */

async function recordAudit(event, actorId, targetId, details = {}) {
  const now = new Date();
  const safeDetails = JSON.parse(JSON.stringify(details || {}));
  await collections().audit.insertOne({
    event,
    actorId: actorId ? toObjectId(actorId) : null,
    targetId: targetId ? toObjectId(targetId) : null,
    details: safeDetails,
    createdAt: now,
  });
}

async function listAudit(limit = 50) {
  return collections().audit.find({}, { sort: { createdAt: -1 } }).limit(limit).toArray();
}

module.exports = {
  publicUser,
  publicCourse,
  publicAssignment,
  findUserByEmail,
  findUserById,
  createUser,
  updateUser,
  setUserPassword,
  recordUserLogin,
  listUsers,
  countUsers,
  countActiveAdmins,
  createSession,
  findSession,
  touchSession,
  deleteSession,
  deleteAllSessionsForUser,
  createResetToken,
  consumeResetToken,
  createVerificationToken,
  consumeVerificationToken,
  markEmailVerified,
  createCourse,
  findCourseById,
  updateCourse,
  listCourses,
  countCourses,
  saveLesson,
  findLesson,
  assignCourse,
  listAssignments,
  unassignCourse,
  markAssignmentCompleted,
  findAssignment,
  upsertLessonProgress,
  listLessonProgress,
  countCompletedModules,
  deleteUserData,
  createSimulation,
  listSimulations,
  listRecentSimulations,
  countSimulations,
  createEvaluation,
  listEvaluations,
  listRecentEvaluations,
  recordAudit,
  listAudit,
};
