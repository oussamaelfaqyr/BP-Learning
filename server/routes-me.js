"use strict";

const { sendJson, sendError, readJsonBody } = require("./http");
const { hashPassword, verifyPassword } = require("./auth");
const store = require("./store");
const validation = require("./validation");
const { sanitizeCourse } = require("./learning-schema");
const { getScenario } = require("./scenarios");

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

async function courseProgress(userId, courseId, moduleCount) {
  if (!moduleCount) return { completed: 0, total: 0, percent: 0 };
  const completed = await store.countCompletedModules(userId, courseId);
  return {
    completed,
    total: moduleCount,
    percent: Math.round((completed / moduleCount) * 100),
  };
}

async function handleMe(req, res, auth) {
  if (req.method !== "GET") return sendError(res, "method_not_allowed");
  sendJson(res, 200, { user: store.publicUser(auth.user) });
}

async function handleUpdateMe(req, res, auth) {
  if (req.method !== "PATCH") return sendError(res, "method_not_allowed");
  const body = await readBody(req, res);
  if (body === undefined) return;
  const parsed = validation.validateProfileUpdate(body);
  if (parsed.error) return sendError(res, parsed.error);
  const updated = await store.updateUser(auth.user._id, parsed.value);
  sendJson(res, 200, { user: store.publicUser(updated || auth.user) });
}

async function handleChangePassword(req, res, auth) {
  if (req.method !== "PUT") return sendError(res, "method_not_allowed");
  const body = await readBody(req, res);
  if (body === undefined) return;
  const parsed = validation.validatePasswordChange(body);
  if (parsed.error) return sendError(res, parsed.error);
  const fresh = await store.findUserById(auth.user._id);
  if (!fresh) return sendError(res, "user_not_found");
  const ok = fresh.passwordHash
    ? await verifyPassword(parsed.value.currentPassword, fresh.passwordHash)
    : false;
  if (!ok) return sendError(res, "password_mismatch");
  const passwordHash = await hashPassword(parsed.value.newPassword);
  await store.setUserPassword(auth.user._id, passwordHash);
  await store.recordAudit("PASSWORD_CHANGED", auth.user._id, auth.user._id, {});
  sendJson(res, 200, { ok: true });
}

async function collectUserCourses(userId) {
  const personalCourses = await store.listCourses({ ownerUserId: userId });
  const assignedResult = await store.listAssignments({ userId });
  const assigned = assignedResult.assignments.filter(
    (item) => item.course && item.course.status === "published"
  );
  const seen = new Set();
  const courses = [];
  for (const course of personalCourses) {
    if (seen.has(course.id)) continue;
    seen.add(course.id);
    courses.push({
      ...course,
      origin: "personal",
      progress: await courseProgress(userId, course.id, course.modules.length),
      assignment: null,
    });
  }
  for (const item of assigned) {
    if (seen.has(item.courseId)) continue;
    seen.add(item.courseId);
    courses.push({
      ...item.course,
      origin: "assigned",
      progress: await courseProgress(userId, item.courseId, item.course.modules.length),
      assignment: {
        id: item.id,
        status: item.status,
        assignedAt: item.assignedAt,
        deadline: item.deadline,
      },
    });
  }
  const statusRank = { draft: 0, published: 0, archived: 1 };
  courses.sort(
    (a, b) =>
      (statusRank[a.status] ?? 0) - (statusRank[b.status] ?? 0) ||
      new Date(b.updatedAt) - new Date(a.updatedAt)
  );
  return courses;
}

async function handleMyCourses(req, res, auth) {
  if (req.method !== "GET") return sendError(res, "method_not_allowed");
  const courses = await collectUserCourses(auth.user._id.toString());
  sendJson(res, 200, { courses });
}

async function handleDashboard(req, res, auth) {
  if (req.method !== "GET") return sendError(res, "method_not_allowed");
  const userId = auth.user._id.toString();
  const courses = await collectUserCourses(userId);
  const activeCourses = courses.filter((course) => course.status !== "archived");

  const overall =
    activeCourses.length
      ? Math.round(activeCourses.reduce((sum, course) => sum + course.progress.percent, 0) / activeCourses.length)
      : 0;

  let next = null;
  for (const course of activeCourses) {
    if (course.progress.percent >= 100) continue;
    const progress = await store.listLessonProgress(userId, course.id);
    const done = new Set(progress.filter((item) => item.completed).map((item) => item.moduleId));
    const module = course.modules.find((item) => !done.has(item.id));
    if (module) {
      next = { courseId: course.id, courseTitle: course.title, module };
      break;
    }
  }

  const simulations = await store.listSimulations(userId, 5);
  const recentSimulations = simulations.map((sim) => ({
    id: sim._id.toString(),
    scenarioId: sim.scenarioId,
    scenarioTitle: scenarioTitle(sim.scenarioId),
    courseId: sim.courseId ? sim.courseId.toString() : null,
    moduleId: sim.moduleId || null,
    priority: sim.evaluation && sim.evaluation.priority ? sim.evaluation.priority : null,
    createdAt: sim.createdAt,
  }));

  const evaluations = await store.listEvaluations(userId, 10);
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
  const weakPoints = [...weaknessCounts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 3);
  const strongPoints = [...strengthCounts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 3);

  sendJson(res, 200, {
    user: store.publicUser(auth.user),
    overallProgress: overall,
    courses,
    nextLesson: next,
    recentSimulations,
    weakPoints,
    strongPoints,
    stats: {
      coursesAssigned: courses.filter((course) => course.assignment).length,
      coursesCompleted: courses.filter((course) => course.progress.percent >= 100).length,
      simulationsRun: simulations.length,
      evaluationsReceived: evaluations.length,
      lessonsCompleted: (await store.listLessonProgress(userId)).filter((item) => item.completed).length,
    },
  });
}

async function handleMyProgress(req, res, auth) {
  if (req.method !== "GET") return sendError(res, "method_not_allowed");
  const userId = auth.user._id.toString();
  const progress = await store.listLessonProgress(userId);
  const completed = progress.filter((item) => item.completed).length;
  const quizOk = progress.filter(
    (item) => item.quizResult && item.quizResult.assessment === "appropriate"
  ).length;
  const evaluations = await store.listEvaluations(userId, 20);
  let acquis = 0;
  let renforcer = 0;
  const seenEvaluations = new Set();
  for (const evaluation of evaluations) {
    const key = evaluation.scenarioId + evaluation.createdAt.toISOString();
    if (seenEvaluations.has(key)) continue;
    seenEvaluations.add(key);
    for (const criterion of evaluation.criteria || []) {
      if (criterion.status === "acquis") acquis += 1;
      if (criterion.status === "a_renforcer") renforcer += 1;
    }
  }
  const base = completed > 0 ? 20 : 0;
  const skills = {
    Communication: Math.min(100, base + completed * 10 + acquis * 15 + Math.round(renforcer * 7)),
    "Conseil client": Math.min(100, base + completed * 10 + quizOk * 15),
    "Gestion des objections": Math.min(100, completed * 14 + quizOk * 10),
    "Connaissances produits": Math.min(100, completed * 12),
  };
  sendJson(res, 200, {
    skills,
    lessonsCompleted: completed,
    quizzesAnswered: quizOk,
    simulations: evaluations.length,
    courseProgress: (await collectUserCourses(userId)).map((course) => ({
      id: course.id,
      title: course.title,
      progress: course.progress,
      deadline: course.assignment ? course.assignment.deadline : null,
    })),
  });
}

async function handleMySimulations(req, res, auth) {
  if (req.method !== "GET") return sendError(res, "method_not_allowed");
  const simulations = await store.listSimulations(auth.user._id.toString(), 20);
  const evaluations = await store.listEvaluations(auth.user._id.toString(), 20);
  sendJson(res, 200, {
    simulations: simulations.map((sim) => ({
      id: sim._id.toString(),
      scenarioId: sim.scenarioId,
      scenarioTitle: scenarioTitle(sim.scenarioId),
      status: sim.status,
      practiceTarget: sim.practiceTarget,
      evaluation: sim.evaluation
        ? {
            overall: sim.evaluation.overall,
            priority: sim.evaluation.priority,
            nextPractice: sim.evaluation.nextPractice,
            criteria: sim.evaluation.criteria,
          }
        : null,
      createdAt: sim.createdAt,
    })),
    evaluations: evaluations.map((evaluation) => ({
      id: evaluation._id.toString(),
      scenarioId: evaluation.scenarioId,
      scenarioTitle: scenarioTitle(evaluation.scenarioId),
      overall: evaluation.overall,
      priority: evaluation.priority,
      nextPractice: evaluation.nextPractice,
      criteria: evaluation.criteria,
      createdAt: evaluation.createdAt,
    })),
  });
}

async function handleCreatePersonalCourse(req, res, auth) {
  if (req.method !== "POST") return sendError(res, "method_not_allowed");
  const body = await readBody(req, res);
  if (body === undefined) return;
  const parsed = validation.validateCourseInput(body);
  if (parsed.error) return sendError(res, parsed.error);
  const existing = (await collectUserCourses(auth.user._id.toString())).find(
    (course) => course.origin === "personal" && course.status !== "archived"
  );
  const course = await store.createCourse({
    ...parsed.value,
    status: "draft",
    origin: "personal",
    ownerUserId: auth.user._id,
    createdBy: auth.user._id,
  });
  if (existing) {
    await store.updateCourse(existing.id, { status: "archived" });
  }
  sendJson(res, 201, { course: store.publicCourse(course) });
}

async function handleCompleteLesson(req, res, auth) {
  if (req.method !== "POST") return sendError(res, "method_not_allowed");
  const courseId = req.params.courseId;
  const moduleId = req.params.moduleId;
  const course = await store.findCourseById(courseId);
  if (!course) return sendError(res, "course_not_found");
  if (!course.modules.some((module) => module.id === moduleId)) {
    return sendError(res, "invalid_modules");
  }
  const access = await courseAccess(auth.user._id.toString(), course);
  if (!access) return sendError(res, "forbidden");
  const result = await store.upsertLessonProgress(auth.user._id, courseId, moduleId, {
    completed: true,
    completedAt: new Date(),
  });
  const completed = await store.countCompletedModules(auth.user._id, courseId);
  if (course.modules.length && completed >= course.modules.length) {
    await store.markAssignmentCompleted(auth.user._id, courseId);
  }
  sendJson(res, 200, { ok: true, progress: result });
}

async function handleSaveQuizResult(req, res, auth) {
  if (req.method !== "POST") return sendError(res, "method_not_allowed");
  const courseId = req.params.courseId;
  const moduleId = req.params.moduleId;
  const body = await readBody(req, res);
  if (body === undefined) return;
  if (!validation.isPlainObject(body)) return sendError(res, "invalid_request");
  const assessment = ["appropriate", "partial", "a_ameliorer"].includes(body.assessment)
    ? body.assessment
    : null;
  const explanation = validation.cleanString(body.explanation, 1600);
  const keyPoint = validation.cleanString(body.keyPoint, 500);
  if (!assessment || !explanation || !keyPoint) return sendError(res, "invalid_request");
  const course = await store.findCourseById(courseId);
  if (!course) return sendError(res, "course_not_found");
  const access = await courseAccess(auth.user._id.toString(), course);
  if (!access) return sendError(res, "forbidden");
  await store.upsertLessonProgress(auth.user._id, courseId, moduleId, {
    quizResult: { assessment, explanation, keyPoint, savedAt: new Date() },
  });
  sendJson(res, 200, { ok: true });
}

async function courseAccess(userId, course) {
  if (course.ownerUserId && course.ownerUserId.toString() === userId) return true;
  const assignment = await store.findAssignment(userId, course._id.toString());
  if (assignment && course.status === "published") return true;
  return false;
}

async function handleSaveSimulation(req, res, auth) {
  if (req.method !== "POST") return sendError(res, "method_not_allowed");
  const body = await readBody(req, res);
  if (body === undefined) return;
  if (!validation.isPlainObject(body)) return sendError(res, "invalid_request");
  const scenarioId = validation.cleanString(body.scenarioId, 60);
  if (!getScenario(scenarioId)) return sendError(res, "invalid_request");
  const messages = Array.isArray(body.messages)
    ? body.messages
        .slice(0, 40)
        .map((message) =>
          message &&
          validation.isPlainObject(message) &&
          (message.role === "user" || message.role === "assistant")
            ? { role: message.role, content: validation.cleanString(message.content, 4000) }
            : null
        )
        .filter(Boolean)
    : [];
  if (!messages.length) return sendError(res, "invalid_request");

  let courseId = null;
  let moduleId = null;
  if (body.courseId) {
    const course = await store.findCourseById(body.courseId);
    if (!course || !(await courseAccess(auth.user._id.toString(), course))) {
      return sendError(res, "forbidden");
    }
    courseId = course._id.toString();
    moduleId = validation.cleanString(body.moduleId, 60) || null;
  }

  const evaluationRaw = body.evaluation;
  let evaluation = null;
  if (validation.isPlainObject(evaluationRaw) && typeof evaluationRaw.overall === "string") {
    evaluation = {
      overall: validation.cleanString(evaluationRaw.overall, 4000),
      priority: validation.cleanString(evaluationRaw.priority, 60),
      nextPractice: validation.cleanString(evaluationRaw.nextPractice, 2000),
      criteria: Array.isArray(evaluationRaw.criteria)
        ? evaluationRaw.criteria.slice(0, 12).map((criterion) => ({
            id: validation.cleanString(criterion && criterion.id, 60),
            label: validation.cleanString(criterion && criterion.label, 200),
            score: Number.isFinite(criterion && criterion.score)
              ? Math.max(0, Math.min(100, Math.round(criterion.score)))
              : 0,
            status: ["acquis", "a_renforcer", "non_evalue"].includes(criterion && criterion.status)
              ? criterion.status
              : "non_evalue",
            evidence: validation.cleanString(criterion && criterion.evidence, 2000),
            improvement: validation.cleanString(criterion && criterion.improvement, 2000),
          }))
        : [],
    };
  }

  const simulation = await store.createSimulation({
    userId: auth.user._id,
    courseId,
    moduleId,
    scenarioId,
    messages,
    status: "complete",
    practiceTarget: validation.cleanString(body.practiceTarget, 60) || null,
    evaluation,
  });

  let evaluationId = null;
  if (evaluation) {
    const saved = await store.createEvaluation({
      userId: auth.user._id,
      simulationId: simulation._id,
      courseId,
      moduleId,
      scenarioId,
      overall: evaluation.overall,
      criteria: evaluation.criteria,
      priority: evaluation.priority,
      nextPractice: evaluation.nextPractice,
    });
    evaluationId = saved._id.toString();
  }

  sendJson(res, 201, {
    ok: true,
    simulationId: simulation._id.toString(),
    evaluationId,
  });
}

function sanitizeMigrationBlob(body) {
  if (!validation.isPlainObject(body)) return null;
  const result = { course: null, completedModules: [], quizResults: {}, simulations: [] };
  const rawCourse = sanitizeCourse(body.course || null);
  if (rawCourse) result.course = rawCourse;
  if (Array.isArray(body.completedModules)) {
    result.completedModules = body.completedModules
      .filter((id) => typeof id === "string" && id.length <= 60)
      .slice(0, 10);
  }
  if (validation.isPlainObject(body.quizResults)) {
    Object.keys(body.quizResults)
      .slice(0, 10)
      .forEach((moduleId) => {
        const item = body.quizResults[moduleId];
        if (!validation.isPlainObject(item)) return;
        const assessment = ["appropriate", "partial", "a_ameliorer"].includes(item.assessment)
          ? item.assessment
          : null;
        if (!assessment) return;
        result.quizResults[moduleId] = {
          assessment,
          explanation: validation.cleanString(item.explanation, 1600),
          keyPoint: validation.cleanString(item.keyPoint, 500),
        };
      });
  }
  if (Array.isArray(body.simulations)) {
    result.simulations = body.simulations
      .slice(0, 10)
      .map((sim) => {
        if (!validation.isPlainObject(sim)) return null;
        const scenarioId = validation.cleanString(sim.scenarioId, 60);
        if (!getScenario(scenarioId)) return null;
        const messages = Array.isArray(sim.messages)
          ? sim.messages
              .slice(0, 40)
              .map((message) =>
                message &&
                validation.isPlainObject(message) &&
                (message.role === "user" || message.role === "assistant")
                  ? { role: message.role, content: validation.cleanString(message.content, 4000) }
                  : null
              )
              .filter(Boolean)
          : [];
        return { scenarioId, messages };
      })
      .filter(Boolean);
  }
  if (
    !result.course &&
    !result.completedModules.length &&
    !Object.keys(result.quizResults).length &&
    !result.simulations.length
  ) {
    return null;
  }
  return result;
}

async function handleMigrate(req, res, auth) {
  if (req.method !== "POST") return sendError(res, "method_not_allowed");
  const body = await readBody(req, res);
  if (body === undefined) return;
  const blob = sanitizeMigrationBlob(body);
  if (!blob) return sendError(res, "invalid_request");
  const userId = auth.user._id.toString();

  let courseId = null;
  if (blob.course) {
    const existing = (await collectUserCourses(userId)).find(
      (course) => course.origin === "personal" && course.status !== "archived"
    );
    if (!existing) {
      const course = await store.createCourse({
        title: blob.course.title,
        objective: blob.course.objective,
        estimatedDuration: blob.course.estimatedDuration,
        modules: blob.course.modules,
        status: "draft",
        origin: "personal",
        ownerUserId: auth.user._id,
        createdBy: auth.user._id,
      });
      courseId = course._id.toString();
    } else {
      courseId = existing.id;
    }
  }

  let lessonsMigrated = 0;
  if (courseId) {
    for (const moduleId of blob.completedModules) {
      const exists = await store.listLessonProgress(userId, courseId);
      if (exists.some((item) => item.moduleId === moduleId && item.completed)) continue;
      await store.upsertLessonProgress(auth.user._id, courseId, moduleId, {
        completed: true,
        completedAt: new Date(),
        migrated: true,
      });
      lessonsMigrated += 1;
    }
    for (const [moduleId, quizResult] of Object.entries(blob.quizResults)) {
      await store.upsertLessonProgress(auth.user._id, courseId, moduleId, {
        quizResult: { ...quizResult, savedAt: new Date(), migrated: true },
      });
    }
  }

  let simulationsMigrated = 0;
  for (const simulation of blob.simulations) {
    await store.createSimulation({
      userId: auth.user._id,
      courseId,
      moduleId: null,
      scenarioId: simulation.scenarioId,
      messages: simulation.messages,
      status: "complete",
      practiceTarget: null,
      evaluation: null,
      migrated: true,
    });
    simulationsMigrated += 1;
  }

  sendJson(res, 200, {
    ok: true,
    migrated: { lessons: lessonsMigrated, simulations: simulationsMigrated, courseId },
  });
}

module.exports = {
  handleMe,
  handleUpdateMe,
  handleChangePassword,
  handleMyCourses,
  handleDashboard,
  handleMyProgress,
  handleMySimulations,
  handleCreatePersonalCourse,
  handleCompleteLesson,
  handleSaveQuizResult,
  handleSaveSimulation,
  handleMigrate,
  collectUserCourses,
  courseAccess,
};
