"use strict";

const { sendJson, sendError, readJsonBody } = require("./http");
const { hashPassword, randomToken, resetTokenHash } = require("./auth");
const { config } = require("./config");
const store = require("./store");
const validation = require("./validation");
const emailService = require("./email");
const { getScenario } = require("./scenarios");
const deepseek = require("./deepseek");
const {
  buildCourseSystemPrompt,
  buildCourseUserPrompt,
} = require("./prompts");
const { sanitizeCourse } = require("./learning-schema");
const { collectUserCourses } = require("./routes-me");

const MAX_BODY_BYTES = 256 * 1024;

async function readBody(req, res) {
  try {
    return await readJsonBody(req, MAX_BODY_BYTES);
  } catch (error) {
    if (error && error.code === "too_large") sendError(res, "payload_too_large");
    else sendError(res, "invalid_json");
    return undefined;
  }
}

function scenarioTitle(id) {
  const scenario = getScenario(id);
  return scenario ? scenario.title : id;
}

function parseJsonContent(content) {
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/* ------------------------------ stats ------------------------------ */

async function handleStats(req, res) {
  if (req.method !== "GET") return sendError(res, "method_not_allowed");
  const totalUsers = await store.countUsers();
  const activeUsers = await store.countUsers({
    lastLoginAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
  });
  const disabledUsers = await store.countUsers({ status: "disabled" });
  const publishedCourses = await store.countCourses({ status: "published" });
  const draftCourses = await store.countCourses({ status: "draft" });
  const assignments = await store.listAssignments({});
  const assignedCount = assignments.total;
  const completedAssignments = assignments.assignments.filter((item) => item.status === "completed").length;
  const simulations = await store.countSimulations({});
  const evaluations = await store.listRecentEvaluations(60);

  const weaknessCounts = new Map();
  for (const evaluation of evaluations) {
    for (const criterion of evaluation.criteria || []) {
      if (criterion.status === "a_renforcer") {
        weaknessCounts.set(criterion.label, (weaknessCounts.get(criterion.label) || 0) + 1);
      }
    }
  }
  const weaknesses = [...weaknessCounts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  let averageProgress = 0;
  if (assignedCount) {
    let sum = 0;
    for (const item of assignments.assignments) {
      const total = item.course ? item.course.modules.length : 0;
      if (!total) continue;
      const completed = await store.countCompletedModules(item.userId, item.courseId);
      sum += Math.round((completed / total) * 100);
    }
    averageProgress = Math.round(sum / assignedCount);
  }

  const simulationsList = await store.listRecentSimulations(10);
  const usersById = new Map();
  if (simulationsList.length) {
    const userIds = [...new Set(simulationsList.map((sim) => sim.userId))];
    for (const userId of userIds) {
      const user = await store.findUserById(userId);
      if (user) usersById.set(userId.toString(), `${user.firstName} ${user.lastName}`);
    }
  }
  const recentActivity = simulationsList.map((sim) => ({
    id: sim._id.toString(),
    user: usersById.get(sim.userId.toString()) || "Utilisateur",
    scenarioTitle: scenarioTitle(sim.scenarioId),
    priority: sim.evaluation && sim.evaluation.priority ? sim.evaluation.priority : null,
    createdAt: sim.createdAt,
  }));

  sendJson(res, 200, {
    totalUsers,
    activeUsers,
    disabledUsers,
    publishedCourses,
    draftCourses,
    assignedCourses: assignedCount,
    completedCourses: completedAssignments,
    averageProgress,
    simulations,
    evaluations: evaluations.length,
    weaknesses,
    recentActivity,
  });
}

/* ------------------------------ users ------------------------------ */

async function handleListUsers(req, res) {
  if (req.method !== "GET") return sendError(res, "method_not_allowed");
  const { limit, offset } = validation.isValidPagination(req.query);
  const search = validation.cleanString(req.query.search, 120);
  const role = validation.isValidRole(req.query.role) ? req.query.role : "";
  const status = validation.isValidUserStatus(req.query.status) ? req.query.status : "";
  const result = await store.listUsers({ search, role, status, limit, offset });

  const userIds = result.users.map((user) => user.id);
  const enriched = [];
  for (const user of result.users) {
    const assignments = await store.listAssignments({ userId: user.id });
    const progress = await store.listLessonProgress(user.id);
    const simulations = await store.listSimulations(user.id, 100);
    enriched.push({
      ...user,
      assignedCourses: assignments.total,
      completedLessons: progress.filter((item) => item.completed).length,
      simulationsRun: simulations.length,
    });
  }
  sendJson(res, 200, { users: enriched, total: result.total, limit, offset });
}

async function handleCreateUser(req, res, auth) {
  if (req.method !== "POST") return sendError(res, "method_not_allowed");
  const body = await readBody(req, res);
  if (body === undefined) return;
  const parsed = validation.validateAdminUserInput(body);
  if (parsed.error) return sendError(res, parsed.error);
  const { firstName, lastName, email, role } = parsed.value;

  const existing = await store.findUserByEmail(email);
  if (existing) return sendError(res, "email_taken");

  let user;
  try {
    user = await store.createUser({ firstName, lastName, email, role, passwordHash: null });
  } catch (error) {
    if (error && error.code === 11000) return sendError(res, "email_taken");
    throw error;
  }

  const token = randomToken(32);
  await store.createResetToken(user._id, resetTokenHash(token));
  const resetUrl = `${config.appBaseUrl}/#/reset-password?token=${token}`;
  const emailResult = await emailService.sendResetPasswordEmail({
    to: user.email,
    firstName: user.firstName,
    resetUrl,
  });

  await store.recordAudit("USER_CREATED", auth.user._id, user._id, { role, email: user.email });

  sendJson(res, 201, {
    user: store.publicUser(user),
    invitation: { sent: emailResult.delivered },
    ...(config.isProduction ? {} : { devResetUrl: resetUrl }),
  });
}

async function handleUpdateUser(req, res, auth) {
  if (req.method !== "PATCH") return sendError(res, "method_not_allowed");
  const targetId = req.params.id;
  const target = await store.findUserById(targetId);
  if (!target) return sendError(res, "user_not_found");
  const body = await readBody(req, res);
  if (body === undefined) return;
  if (!validation.isPlainObject(body)) return sendError(res, "invalid_request");

  const update = {};
  if (body.firstName !== undefined) {
    const firstName = validation.cleanString(body.firstName, 80);
    if (!validation.isValidName(firstName)) return sendError(res, "invalid_first_name");
    update.firstName = firstName;
  }
  if (body.lastName !== undefined) {
    const lastName = validation.cleanString(body.lastName, 80);
    if (!validation.isValidName(lastName)) return sendError(res, "invalid_last_name");
    update.lastName = lastName;
  }
  if (body.role !== undefined) {
    if (!validation.isValidRole(body.role)) return sendError(res, "invalid_role");
    update.role = body.role;
  }
  if (body.status !== undefined) {
    if (!validation.isValidUserStatus(body.status)) return sendError(res, "invalid_status");
    update.status = body.status;
  }

  const removesActiveAdmin =
    target.role === "admin" &&
    target.status === "active" &&
    (update.status === "disabled" || update.role === "user");
  if (removesActiveAdmin && (await store.countActiveAdmins()) <= 1) {
    return sendError(res, "last_admin");
  }

  const updated = await store.updateUser(target._id, update);
  if (update.status === "disabled") {
    await store.deleteAllSessionsForUser(target._id);
    await store.recordAudit("USER_DISABLED", auth.user._id, target._id, {});
  }
  if (update.status === "active") {
    await store.recordAudit("USER_ENABLED", auth.user._id, target._id, {});
  }
  if (update.role && update.role !== target.role) {
    await store.recordAudit("ROLE_CHANGED", auth.user._id, target._id, {
      from: target.role,
      to: update.role,
    });
  }
  sendJson(res, 200, { user: store.publicUser(updated || target) });
}

async function handleResetAccess(req, res, auth) {
  if (req.method !== "POST") return sendError(res, "method_not_allowed");
  const target = await store.findUserById(req.params.id);
  if (!target) return sendError(res, "user_not_found");

  const token = randomToken(32);
  await store.createResetToken(target._id, resetTokenHash(token));
  const resetUrl = `${config.appBaseUrl}/#/reset-password?token=${token}`;
  const emailResult = await emailService.sendResetPasswordEmail({
    to: target.email,
    firstName: target.firstName,
    resetUrl,
  });

  await store.recordAudit("ACCESS_RESET", auth.user._id, target._id, {});
  sendJson(res, 200, {
    ok: true,
    invitation: { sent: emailResult.delivered },
    ...(config.isProduction ? {} : { devResetUrl: resetUrl }),
  });
}

async function handleDeleteUser(req, res, auth) {
  if (req.method !== "DELETE") return sendError(res, "method_not_allowed");
  const target = await store.findUserById(req.params.id);
  if (!target) return sendError(res, "user_not_found");
  if (target._id.toString() === auth.user._id.toString()) {
    return sendError(res, "cannot_delete_self");
  }
  if (target.role === "admin" && target.status === "active" && (await store.countActiveAdmins()) <= 1) {
    return sendError(res, "last_admin");
  }
  await store.deleteUserAccount(target._id);
  await store.recordAudit("USER_DELETED", auth.user._id, target._id, {
    email: target.email,
    role: target.role,
  });
  sendJson(res, 200, { ok: true });
}

/* ----------------------------- messages ----------------------------- */

const MESSAGE_BATCH_SIZE = 3;

async function handleSendMessage(req, res, auth) {
  if (req.method !== "POST") return sendError(res, "method_not_allowed");
  const body = await readBody(req, res);
  if (body === undefined) return;
  const parsed = validation.validateAdminMessageInput(body);
  if (parsed.error) return sendError(res, parsed.error);
  const { subject, text, recipients } = parsed.value;

  let candidateIds = [];
  if (recipients === "all") {
    const result = await store.listUsers({ status: "active", limit: validation.MAX_MESSAGE_RECIPIENTS });
    candidateIds = result.users.map((user) => user.id);
  } else {
    candidateIds = recipients;
  }

  const targets = [];
  for (const id of candidateIds) {
    const user = await store.findUserById(id);
    if (user && user.status === "active" && user.email) targets.push(user);
  }
  if (!targets.length) return sendError(res, "invalid_recipients");

  let sent = 0;
  let failed = 0;
  for (let index = 0; index < targets.length; index += MESSAGE_BATCH_SIZE) {
    const batch = targets.slice(index, index + MESSAGE_BATCH_SIZE);
    const results = await Promise.all(
      batch.map((user) =>
        emailService.sendAdminMessageEmail({
          to: user.email,
          firstName: user.firstName,
          subject,
          text,
        })
      )
    );
    for (const result of results) {
      if (result.delivered) sent += 1;
      else failed += 1;
    }
  }

  await store.recordAudit("MESSAGE_SENT", auth.user._id, null, {
    subject: subject.slice(0, 200),
    recipients: targets.length,
    sent,
    failed,
  });
  sendJson(res, 200, { ok: true, total: targets.length, sent, failed });
}

async function handleUserPerformance(req, res) {
  if (req.method !== "GET") return sendError(res, "method_not_allowed");
  const userId = req.params.id;
  const user = await store.findUserById(userId);
  if (!user) return sendError(res, "user_not_found");

  const progress = await store.listLessonProgress(userId);
  const completedLessons = progress.filter((item) => item.completed);
  const simulations = await store.listSimulations(userId, 100);
  const evaluations = await store.listEvaluations(userId, 100);
  const assignments = await store.listAssignments({ userId });

  const weaknessCounts = new Map();
  const strengthCounts = new Map();
  for (const evaluation of evaluations) {
    for (const criterion of evaluation.criteria || []) {
      if (criterion.status === "a_renforcer") {
        weaknessCounts.set(criterion.label, (weaknessCounts.get(criterion.label) || 0) + 1);
      }
      if (criterion.status === "acquis") {
        strengthCounts.set(criterion.label, (strengthCounts.get(criterion.label) || 0) + 1);
      }
    }
  }
  const weakCriteria = [...weaknessCounts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);
  const strongCriteria = [...strengthCounts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  const coursesWithProgress = [];
  for (const item of assignments.assignments) {
    if (!item.course) continue;
    const completed = await store.countCompletedModules(userId, item.courseId);
    const percent = item.course.modules.length
      ? Math.round((completed / item.course.modules.length) * 100)
      : 0;
    coursesWithProgress.push({
      id: item.courseId,
      title: item.course.title,
      progress: { completed, total: item.course.modules.length, percent },
      assignmentStatus: item.status,
      deadline: item.deadline,
    });
  }
  const recommended = coursesWithProgress
    .filter((course) => course.progress.percent < 100)
    .sort((a, b) => a.progress.percent - b.progress.percent)[0] || null;

  sendJson(res, 200, {
    user: store.publicUser(user),
    learningProgress: {
      completedLessons: completedLessons.length,
      totalLessons: progress.length,
      simulationsRun: simulations.length,
      evaluationsReceived: evaluations.length,
    },
    weakCriteria,
    strongCriteria,
    courses: coursesWithProgress,
    recommendedNextTraining: recommended,
    recentSimulations: simulations.slice(0, 5).map((sim) => ({
      id: sim._id.toString(),
      scenarioTitle: scenarioTitle(sim.scenarioId),
      priority: sim.evaluation && sim.evaluation.priority ? sim.evaluation.priority : null,
      createdAt: sim.createdAt,
    })),
  });
}

/* ------------------------------ courses ------------------------------ */

async function handleListCourses(req, res) {
  if (req.method !== "GET") return sendError(res, "method_not_allowed");
  const status = validation.isValidCourseStatus(req.query.status) ? req.query.status : "";
  const courses = await store.listCourses({ status });
  sendJson(res, 200, { courses });
}

async function handleGenerateCourse(req, res) {
  if (req.method !== "POST") return sendError(res, "method_not_allowed");
  const body = await readBody(req, res);
  if (body === undefined) return;
  if (!validation.isPlainObject(body) || typeof body.objective !== "string") {
    return sendError(res, "invalid_request");
  }
  const objective = body.objective.trim().slice(0, 600);
  if (objective.length < 10) return sendError(res, "invalid_objective");
  const skill = validation.cleanString(body.skill, 100);
  try {
    const result = await deepseek.chatCompletion({
      messages: [
        { role: "system", content: buildCourseSystemPrompt() },
        { role: "user", content: buildCourseUserPrompt(objective, skill) },
      ],
      temperature: 0.4,
      maxTokens: 1400,
      jsonMode: true,
      thinking: { type: "disabled" },
    });
    const course = sanitizeCourse(parseJsonContent(result.content));
    if (!course) return sendError(res, "course_invalid");
    sendJson(res, 200, { course, draft: true });
  } catch (error) {
    const code = error && error.code;
    if (code === "not_configured") return sendError(res, "ai_unavailable", 503);
    if (code === "timeout") return sendError(res, "ai_timeout", 504);
    if (code === "rate_limit") return sendError(res, "ai_rate_limited", 429);
    return sendError(res, "ai_error", 502);
  }
}

async function handleCreateCourse(req, res, auth) {
  if (req.method !== "POST") return sendError(res, "method_not_allowed");
  const body = await readBody(req, res);
  if (body === undefined) return;
  const parsed = validation.validateCourseInput(body);
  if (parsed.error) return sendError(res, parsed.error);
  const course = await store.createCourse({
    title: parsed.value.title,
    objective: parsed.value.objective,
    description: parsed.value.description,
    estimatedDuration: parsed.value.estimatedDuration,
    modules: parsed.value.modules,
    status: "draft",
    origin: "admin",
    createdBy: auth.user._id,
  });
  await store.recordAudit("COURSE_CREATED", auth.user._id, course._id, {
    title: course.title,
  });
  sendJson(res, 201, { course: store.publicCourse(course) });
}

async function handleUpdateCourse(req, res, auth) {
  if (req.method !== "PATCH") return sendError(res, "method_not_allowed");
  const course = await store.findCourseById(req.params.id);
  if (!course) return sendError(res, "course_not_found");
  const body = await readBody(req, res);
  if (body === undefined) return;
  const parsed = validation.validateCourseInput(body);
  if (parsed.error) return sendError(res, parsed.error);
  const update = {
    title: parsed.value.title,
    objective: parsed.value.objective,
    description: parsed.value.description,
    estimatedDuration: parsed.value.estimatedDuration,
    modules: parsed.value.modules,
  };
  if (parsed.value.deadline !== undefined) update.deadline = parsed.value.deadline;
  const updated = await store.updateCourse(course._id, update);
  await store.recordAudit("COURSE_UPDATED", auth.user._id, course._id, { title: updated.title });
  sendJson(res, 200, { course: store.publicCourse(updated || course) });
}

async function handlePublishCourse(req, res, auth) {
  if (req.method !== "POST") return sendError(res, "method_not_allowed");
  const course = await store.findCourseById(req.params.id);
  if (!course) return sendError(res, "course_not_found");
  const updated = await store.updateCourse(course._id, {
    status: "published",
    publishedAt: new Date(),
  });
  await store.recordAudit("COURSE_PUBLISHED", auth.user._id, course._id, { title: course.title });
  sendJson(res, 200, { course: store.publicCourse(updated || course) });
}

async function handleArchiveCourse(req, res, auth) {
  if (req.method !== "POST") return sendError(res, "method_not_allowed");
  const course = await store.findCourseById(req.params.id);
  if (!course) return sendError(res, "course_not_found");
  const updated = await store.updateCourse(course._id, { status: "archived" });
  await store.recordAudit("COURSE_ARCHIVED", auth.user._id, course._id, { title: course.title });
  sendJson(res, 200, { course: store.publicCourse(updated || course) });
}

async function handleDeleteCourse(req, res, auth) {
  if (req.method !== "DELETE") return sendError(res, "method_not_allowed");
  const course = await store.findCourseById(req.params.id);
  if (!course) return sendError(res, "course_not_found");
  await store.deleteCourse(course._id);
  await store.recordAudit("COURSE_DELETED", auth.user._id, course._id, { title: course.title });
  sendJson(res, 200, { ok: true });
}

/* ---------------------------- assignments ---------------------------- */

async function handleListAssignments(req, res) {
  if (req.method !== "GET") return sendError(res, "method_not_allowed");
  const userId = validation.isValidObjectId(req.query.userId) ? req.query.userId : "";
  const courseId = validation.isValidObjectId(req.query.courseId) ? req.query.courseId : "";
  const result = await store.listAssignments({ userId, courseId });
  const usersById = new Map();
  if (result.assignments.length) {
    const ids = [...new Set(result.assignments.map((item) => item.userId))];
    for (const id of ids) {
      const user = await store.findUserById(id);
      if (user) usersById.set(id, `${user.firstName} ${user.lastName}`);
    }
  }
  sendJson(res, 200, {
    assignments: result.assignments.map((item) => ({
      ...item,
      userName: usersById.get(item.userId) || null,
    })),
    total: result.total,
  });
}

async function handleAssignCourse(req, res, auth) {
  if (req.method !== "POST") return sendError(res, "method_not_allowed");
  const body = await readBody(req, res);
  if (body === undefined) return;
  if (!validation.isPlainObject(body)) return sendError(res, "invalid_request");
  const courseId = validation.cleanString(body.courseId, 64);
  const course = await store.findCourseById(courseId);
  if (!course) return sendError(res, "course_not_found");
  if (course.status !== "published") return sendError(res, "course_not_published");

  let userIds = [];
  if (body.allUsers === true) {
    const result = await store.listUsers({ limit: 1000 });
    userIds = result.users.map((user) => user.id);
  } else if (Array.isArray(body.userIds)) {
    userIds = body.userIds
      .filter((id) => validation.isValidObjectId(id))
      .slice(0, 500)
      .map((id) => id);
  }
  if (!userIds.length) return sendError(res, "invalid_request");

  const deadline = validation.isValidDeadline(body.deadline);
  if (deadline.error) return sendError(res, "invalid_deadline");

  const assigned = await store.assignCourse(courseId, userIds, auth.user._id, deadline.deadline);
  await store.recordAudit("COURSE_ASSIGNED", auth.user._id, course._id, {
    count: assigned.length,
    title: course.title,
  });
  sendJson(res, 200, { ok: true, assigned: assigned.length });
}

async function handleUnassignCourse(req, res, auth) {
  if (req.method !== "DELETE") return sendError(res, "method_not_allowed");
  const removed = await store.unassignCourse(req.params.id);
  if (!removed) return sendError(res, "assignment_not_found");
  await store.recordAudit("COURSE_UNASSIGNED", auth.user._id, removed.courseId, {
    userId: removed.userId.toString(),
  });
  sendJson(res, 200, { ok: true });
}

/* ------------------------------ audit ------------------------------ */

async function handleAuditLogs(req, res) {
  if (req.method !== "GET") return sendError(res, "method_not_allowed");
  const logs = await store.listAudit(50);
  sendJson(res, 200, {
    logs: logs.map((log) => ({
      event: log.event,
      actorId: log.actorId ? log.actorId.toString() : null,
      targetId: log.targetId ? log.targetId.toString() : null,
      details: log.details,
      createdAt: log.createdAt,
    })),
  });
}

/* ----------------------------- settings ----------------------------- */

async function handleSettings(req, res) {
  if (req.method !== "GET") return sendError(res, "method_not_allowed");
  const db = require("./db");
  sendJson(res, 200, {
    allowPublicRegistration: config.allowPublicRegistration,
    aiConfigured: deepseek.isConfigured(),
    aiModel: deepseek.getPublicConfig().model,
    appBaseUrl: config.appBaseUrl,
    environment: config.env,
    database: db.isAvailable() ? "connected" : "disconnected",
  });
}

module.exports = {
  handleStats,
  handleListUsers,
  handleCreateUser,
  handleUpdateUser,
  handleResetAccess,
  handleDeleteUser,
  handleSendMessage,
  handleUserPerformance,
  handleListCourses,
  handleGenerateCourse,
  handleCreateCourse,
  handleUpdateCourse,
  handlePublishCourse,
  handleArchiveCourse,
  handleDeleteCourse,
  handleListAssignments,
  handleAssignCourse,
  handleUnassignCourse,
  handleAuditLogs,
  handleSettings,
};
