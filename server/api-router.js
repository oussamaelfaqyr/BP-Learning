"use strict";

const { sendJson, sendError, extractQuery } = require("./http");
const deepseek = require("./deepseek");
const { requireAuth, requireRole } = require("./middleware");
const authRoutes = require("./routes-auth");
const meRoutes = require("./routes-me");
const adminRoutes = require("./routes-admin");
const aiRoutes = require("./routes-ai");

const OBJECT_ID_PATTERN = "[a-fA-F0-9]{24}";
const MODULE_ID_PATTERN = "[a-z0-9-]{1,60}";

const routes = [
  { method: "GET", pattern: /^\/api\/health$/, auth: "none", handler: handleHealth },
  { method: "GET", pattern: /^\/api\/auth\/config$/, auth: "none", handler: authRoutes.handleAuthConfig },
  { method: "POST", pattern: /^\/api\/auth\/register$/, auth: "none", handler: authRoutes.handleRegister },
  { method: "POST", pattern: /^\/api\/auth\/login$/, auth: "none", handler: authRoutes.handleLogin },
  { method: "POST", pattern: /^\/api\/auth\/logout$/, auth: "none", handler: authRoutes.handleLogout },
  { method: "POST", pattern: /^\/api\/auth\/forgot-password$/, auth: "none", handler: authRoutes.handleForgotPassword },
  { method: "POST", pattern: /^\/api\/auth\/reset-password$/, auth: "none", handler: authRoutes.handleResetPassword },
  { method: "POST", pattern: /^\/api\/auth\/verify-email$/, auth: "none", handler: authRoutes.handleVerifyEmail },
  { method: "POST", pattern: /^\/api\/auth\/resend-verification$/, auth: "none", handler: authRoutes.handleResendVerification },

  { method: "GET", pattern: /^\/api\/me$/, auth: "user", handler: meRoutes.handleMe },
  { method: "PATCH", pattern: /^\/api\/me$/, auth: "user", handler: meRoutes.handleUpdateMe },
  { method: "PUT", pattern: /^\/api\/me\/password$/, auth: "user", handler: meRoutes.handleChangePassword },
  { method: "GET", pattern: /^\/api\/me\/dashboard$/, auth: "user", handler: meRoutes.handleDashboard },
  { method: "GET", pattern: /^\/api\/me\/courses$/, auth: "user", handler: meRoutes.handleMyCourses },
  { method: "GET", pattern: /^\/api\/me\/progress$/, auth: "user", handler: meRoutes.handleMyProgress },
  { method: "GET", pattern: /^\/api\/me\/simulations$/, auth: "user", handler: meRoutes.handleMySimulations },
  { method: "POST", pattern: /^\/api\/me\/courses$/, auth: "user", handler: meRoutes.handleCreatePersonalCourse },
  { method: "POST", pattern: /^\/api\/me\/simulations$/, auth: "user", handler: meRoutes.handleSaveSimulation },
  { method: "POST", pattern: /^\/api\/me\/migrate$/, auth: "user", handler: meRoutes.handleMigrate },
  {
    method: "POST",
    pattern: new RegExp(`^/api/me/courses/(${OBJECT_ID_PATTERN})/modules/(${MODULE_ID_PATTERN})/complete$`),
    auth: "user",
    handler: withParams(meRoutes.handleCompleteLesson, ["courseId", "moduleId"]),
  },
  {
    method: "POST",
    pattern: new RegExp(`^/api/me/courses/(${OBJECT_ID_PATTERN})/modules/(${MODULE_ID_PATTERN})/quiz$`),
    auth: "user",
    handler: withParams(meRoutes.handleSaveQuizResult, ["courseId", "moduleId"]),
  },

  { method: "GET", pattern: /^\/api\/admin\/stats$/, auth: "admin", handler: adminRoutes.handleStats },
  { method: "GET", pattern: /^\/api\/admin\/users$/, auth: "admin", handler: adminRoutes.handleListUsers },
  { method: "POST", pattern: /^\/api\/admin\/users$/, auth: "admin", handler: adminRoutes.handleCreateUser },
  {
    method: "PATCH",
    pattern: new RegExp(`^/api/admin/users/(${OBJECT_ID_PATTERN})$`),
    auth: "admin",
    handler: withParams(adminRoutes.handleUpdateUser, ["id"]),
  },
  {
    method: "DELETE",
    pattern: new RegExp(`^/api/admin/users/(${OBJECT_ID_PATTERN})$`),
    auth: "admin",
    handler: withParams(adminRoutes.handleDeleteUser, ["id"]),
  },
  {
    method: "POST",
    pattern: new RegExp(`^/api/admin/users/(${OBJECT_ID_PATTERN})/reset-access$`),
    auth: "admin",
    handler: withParams(adminRoutes.handleResetAccess, ["id"]),
  },
  {
    method: "GET",
    pattern: new RegExp(`^/api/admin/users/(${OBJECT_ID_PATTERN})/performance$`),
    auth: "admin",
    handler: withParams(adminRoutes.handleUserPerformance, ["id"]),
  },
  { method: "GET", pattern: /^\/api\/admin\/courses$/, auth: "admin", handler: adminRoutes.handleListCourses },
  { method: "POST", pattern: /^\/api\/admin\/courses\/generate$/, auth: "admin", handler: adminRoutes.handleGenerateCourse },
  { method: "POST", pattern: /^\/api\/admin\/courses$/, auth: "admin", handler: adminRoutes.handleCreateCourse },
  {
    method: "PATCH",
    pattern: new RegExp(`^/api/admin/courses/(${OBJECT_ID_PATTERN})$`),
    auth: "admin",
    handler: withParams(adminRoutes.handleUpdateCourse, ["id"]),
  },
  {
    method: "DELETE",
    pattern: new RegExp(`^/api/admin/courses/(${OBJECT_ID_PATTERN})$`),
    auth: "admin",
    handler: withParams(adminRoutes.handleDeleteCourse, ["id"]),
  },
  {
    method: "POST",
    pattern: new RegExp(`^/api/admin/courses/(${OBJECT_ID_PATTERN})/publish$`),
    auth: "admin",
    handler: withParams(adminRoutes.handlePublishCourse, ["id"]),
  },
  {
    method: "POST",
    pattern: new RegExp(`^/api/admin/courses/(${OBJECT_ID_PATTERN})/archive$`),
    auth: "admin",
    handler: withParams(adminRoutes.handleArchiveCourse, ["id"]),
  },
  { method: "GET", pattern: /^\/api\/admin\/assignments$/, auth: "admin", handler: adminRoutes.handleListAssignments },
  { method: "POST", pattern: /^\/api\/admin\/assignments$/, auth: "admin", handler: adminRoutes.handleAssignCourse },
  {
    method: "DELETE",
    pattern: new RegExp(`^/api/admin/assignments/(${OBJECT_ID_PATTERN})$`),
    auth: "admin",
    handler: withParams(adminRoutes.handleUnassignCourse, ["id"]),
  },
  { method: "GET", pattern: /^\/api\/admin\/audit$/, auth: "admin", handler: adminRoutes.handleAuditLogs },
  { method: "GET", pattern: /^\/api\/admin\/settings$/, auth: "admin", handler: adminRoutes.handleSettings },
  { method: "POST", pattern: /^\/api\/admin\/messages$/, auth: "admin", handler: adminRoutes.handleSendMessage },

  { method: "POST", pattern: /^\/api\/customer$/, auth: "optional", handler: aiRoutes.handleCustomer },
  { method: "POST", pattern: /^\/api\/evaluate$/, auth: "optional", handler: aiRoutes.handleEvaluate },
  { method: "POST", pattern: /^\/api\/course\/generate$/, auth: "optional", handler: aiRoutes.handleCourseGenerate },
  { method: "POST", pattern: /^\/api\/lesson\/generate$/, auth: "optional", handler: aiRoutes.handleLessonGenerate },
  { method: "POST", pattern: /^\/api\/tutor$/, auth: "optional", handler: aiRoutes.handleTutor },
  { method: "POST", pattern: /^\/api\/exercise\/evaluate$/, auth: "optional", handler: aiRoutes.handleExerciseEvaluate },
  { method: "GET", pattern: /^\/api\/scenarios$/, auth: "none", handler: aiRoutes.handleScenarios },
  { method: "GET", pattern: /^\/api\/catalogue$/, auth: "optional", handler: aiRoutes.handleCatalogue },
  { method: "POST", pattern: /^\/api\/tts$/, auth: "optional", handler: aiRoutes.handleTts },
];

function withParams(handler, names) {
  return (req, res, auth, match) => {
    req.params = {};
    names.forEach((name, index) => {
      req.params[name] = match[index + 1];
    });
    return handler(req, res, auth);
  };
}

function handleHealth(req, res) {
  if (req.method !== "GET") return sendError(res, "method_not_allowed");
  sendJson(res, 200, { ok: true, service: "bp-learning-ai", ai: deepseek.getPublicConfig() });
}

async function handleApi(req, res, url) {
  const method = req.method;
  const pathname = url.pathname;
  for (const route of routes) {
    if (route.method !== method) continue;
    const match = pathname.match(route.pattern);
    if (!match) continue;
    let auth = { user: null };
    if (route.auth === "user") {
      const result = await requireAuth()(req, res);
      if (!result) return;
      auth = result;
    } else if (route.auth === "admin") {
      const result = await requireRole("admin")(req, res);
      if (!result) return;
      auth = result;
    } else if (route.auth === "optional") {
      const result = await aiRoutes.requireOptionalAuth(req, res);
      if (!result) return;
      auth = result;
    }
    req.query = extractQuery(url);
    await route.handler(req, res, auth, match);
    return;
  }
  sendError(res, "not_found");
}

module.exports = { handleApi };
