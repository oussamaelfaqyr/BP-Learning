"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const deepseek = require("./deepseek");
const store = require("./store");
const { getScenario, publicScenarioList } = require("./scenarios");
const {
  buildCustomerSystemPrompt,
  buildEvaluatorSystemPrompt,
  buildEvaluatorUserPrompt,
  buildCourseSystemPrompt,
  buildCourseUserPrompt,
  buildLessonSystemPrompt,
  buildLessonUserPrompt,
  buildTutorSystemPrompt,
  buildExerciseSystemPrompt,
  buildExerciseUserPrompt,
} = require("./prompts");
const { validateEvaluation, sanitizeEvaluation } = require("./evaluation-schema");
const { sanitizeCourse, sanitizeLesson, sanitizeExerciseResult } = require("./learning-schema");
const { sendJson, isPlainObject, readJsonBody } = require("./http");
const dbModule = require("./db");
const { authenticate } = require("./middleware");

const MAX_BODY_BYTES = 64 * 1024;
const MAX_MESSAGES = 20;
const MAX_MESSAGE_CHARS = 1500;
const MAX_TOTAL_CHARS = 12000;
const CUSTOMER_TEMPERATURE = 0.7;
const CUSTOMER_MAX_TOKENS = 300;
const TUTOR_MAX_MESSAGES = 12;
const OBJECTIVE_MIN_LENGTH = 10;
const OBJECTIVE_MAX_LENGTH = 600;
const TTS_SERVICE_URL = process.env.TTS_SERVICE_URL || "http://127.0.0.1:8765";
const TTS_CACHE_DIR =
  process.env.TTS_CACHE_DIR ||
  (process.env.VERCEL
    ? path.join(os.tmpdir(), "bp-learning-tts")
    : path.join(__dirname, "..", ".tts-cache"));
const TTS_VOICES = [
  "fr-FR-VivienneMultilingualNeural",
  "fr-FR-RemyMultilingualNeural",
  "fr-FR-DeniseNeural",
  "ar-MA-MounaNeural",
  "ar-MA-JamalNeural",
];
const TTS_DEFAULT_VOICE = "fr-FR-VivienneMultilingualNeural";
const TTS_MAX_TEXT = 1500;
const TTS_TIMEOUT_MS = 30000;

async function requireOptionalAuth(req, res) {
  if (!dbModule.isAvailable()) {
    return { user: null };
  }
  const result = await authenticate(req, res);
  if (result.error) {
    sendJson(res, 503, { error: "db_unavailable" });
    return null;
  }
  if (!result.user) {
    sendJson(res, 401, { error: "unauthorized" });
    return null;
  }
  return { user: result.user };
}

function mapAiError(error) {
  const code = error && error.code;
  if (code === "not_configured") return { status: 503, publicCode: "ai_unavailable", logCode: code };
  if (code === "timeout") return { status: 504, publicCode: "ai_timeout", logCode: code };
  if (code === "rate_limit") return { status: 429, publicCode: "ai_rate_limited", logCode: code };
  return { status: 502, publicCode: "ai_error", logCode: code || "unknown" };
}

function validateConversationRequest(body) {
  if (!isPlainObject(body)) return { error: "invalid_request", status: 400 };
  const scenario = getScenario(body.scenarioId);
  if (!scenario) return { error: "unknown_scenario", status: 404 };
  if (!Array.isArray(body.messages) || body.messages.length === 0) return { error: "invalid_messages", status: 400 };
  if (body.messages.length > MAX_MESSAGES) return { error: "too_many_messages", status: 400 };
  const first = body.messages[0];
  if (!isPlainObject(first) || (first.role !== "user" && first.role !== "assistant")) return { error: "invalid_role", status: 400 };
  const firstRole = first.role;
  const otherRole = firstRole === "user" ? "assistant" : "user";
  const messages = [];
  let totalChars = 0;
  for (let index = 0; index < body.messages.length; index += 1) {
    const message = body.messages[index];
    if (!isPlainObject(message)) return { error: "invalid_messages", status: 400 };
    if (message.role !== "user" && message.role !== "assistant") return { error: "invalid_role", status: 400 };
    const expectedRole = index % 2 === 0 ? firstRole : otherRole;
    if (message.role !== expectedRole) return { error: "invalid_conversation", status: 400 };
    if (typeof message.content !== "string") return { error: "invalid_messages", status: 400 };
    const content = message.content.trim();
    if (!content) return { error: "invalid_messages", status: 400 };
    if (content.length > MAX_MESSAGE_CHARS) return { error: "message_too_long", status: 413 };
    totalChars += content.length;
    messages.push({ role: message.role, content });
  }
  if (totalChars > MAX_TOTAL_CHARS) return { error: "conversation_too_long", status: 413 };
  return { scenario, messages };
}

function parsePracticeTarget(body, scenario) {
  if (body.practiceTarget === undefined || body.practiceTarget === null) return { criterion: null };
  if (typeof body.practiceTarget !== "string") return { error: "invalid_practice_target", status: 400 };
  const criterion = scenario.criteria.find((item) => item.id === body.practiceTarget);
  if (!criterion) return { error: "invalid_practice_target", status: 400 };
  return { criterion };
}

async function readBody(req, res) {
  try {
    return await readJsonBody(req, MAX_BODY_BYTES);
  } catch (error) {
    if (error && error.code === "too_large") {
      sendJson(res, 413, { error: "payload_too_large" });
    } else {
      sendJson(res, 400, { error: "invalid_json" });
    }
    return undefined;
  }
}

async function callCustomer(res, scenario, messages, practiceTarget) {
  try {
    const result = await deepseek.chatCompletion({
      messages: [{ role: "system", content: buildCustomerSystemPrompt(scenario, practiceTarget) }, ...messages],
      temperature: CUSTOMER_TEMPERATURE,
      maxTokens: CUSTOMER_MAX_TOKENS,
      thinking: { type: "disabled" },
    });
    sendJson(res, 200, { reply: result.content });
  } catch (error) {
    const mapped = mapAiError(error);
    console.error(`AI customer request failed: ${mapped.logCode}`);
    sendJson(res, mapped.status, { error: mapped.publicCode });
  }
}

async function handleCustomer(req, res, auth) {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "method_not_allowed" });
    return;
  }
  const body = await readBody(req, res);
  if (body === undefined) return;
  if (isPlainObject(body) && body.opening === true) {
    const scenario = getScenario(body.scenarioId);
    if (!scenario) {
      sendJson(res, 404, { error: "unknown_scenario" });
      return;
    }
    if (body.messages !== undefined && (!Array.isArray(body.messages) || body.messages.length !== 0)) {
      sendJson(res, 400, { error: "invalid_request" });
      return;
    }
    const target = parsePracticeTarget(body, scenario);
    if (target.error) {
      sendJson(res, target.status, { error: target.error });
      return;
    }
    await callCustomer(res, scenario, [{ role: "user", content: scenario.openingInstruction }], target.criterion);
    return;
  }
  const parsed = validateConversationRequest(body);
  if (parsed.error) {
    sendJson(res, parsed.status, { error: parsed.error });
    return;
  }
  const target = parsePracticeTarget(body, parsed.scenario);
  if (target.error) {
    sendJson(res, target.status, { error: target.error });
    return;
  }
  await callCustomer(res, parsed.scenario, parsed.messages, target.criterion);
}

function parseEvaluationContent(content, scenario) {
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    return { ok: false };
  }
  const criteriaIds = scenario.criteria.map((criterion) => criterion.id);
  const validation = validateEvaluation(parsed, criteriaIds);
  if (!validation.ok) return { ok: false };
  return { ok: true, evaluation: sanitizeEvaluation(parsed, scenario.criteria) };
}

async function handleEvaluate(req, res, auth) {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "method_not_allowed" });
    return;
  }
  const body = await readBody(req, res);
  if (body === undefined) return;
  const parsed = validateConversationRequest(body);
  if (parsed.error) {
    sendJson(res, parsed.status, { error: parsed.error });
    return;
  }
  try {
    const result = await deepseek.chatCompletion({
      messages: [
        { role: "system", content: buildEvaluatorSystemPrompt(parsed.scenario) },
        { role: "user", content: buildEvaluatorUserPrompt(parsed.scenario, parsed.messages) },
      ],
      temperature: 0.2,
      maxTokens: 1400,
      jsonMode: true,
      thinking: { type: "disabled" },
    });
    const outcome = parseEvaluationContent(result.content, parsed.scenario);
    if (!outcome.ok) {
      console.error("AI evaluation request failed: evaluation_invalid");
      sendJson(res, 502, { error: "evaluation_invalid" });
      return;
    }
    sendJson(res, 200, outcome.evaluation);
  } catch (error) {
    const mapped = mapAiError(error);
    console.error(`AI evaluation request failed: ${mapped.logCode}`);
    sendJson(res, mapped.status, { error: mapped.publicCode });
  }
}

function parseJsonContent(content) {
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}

async function handleCourseGenerate(req, res, auth) {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "method_not_allowed" });
    return;
  }
  const body = await readBody(req, res);
  if (body === undefined) return;
  if (!isPlainObject(body) || typeof body.objective !== "string") {
    sendJson(res, 400, { error: "invalid_request" });
    return;
  }
  const objective = body.objective.trim().slice(0, OBJECTIVE_MAX_LENGTH);
  if (objective.length < OBJECTIVE_MIN_LENGTH) {
    sendJson(res, 400, { error: "objective_too_short" });
    return;
  }
  const skill = typeof body.skill === "string" ? body.skill.trim().slice(0, 100) : "";
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
    if (!course) {
      console.error("AI course request failed: course_invalid");
      sendJson(res, 502, { error: "course_invalid" });
      return;
    }
    sendJson(res, 200, course);
  } catch (error) {
    const mapped = mapAiError(error);
    console.error(`AI course request failed: ${mapped.logCode}`);
    sendJson(res, mapped.status, { error: mapped.publicCode });
  }
}

async function handleLessonGenerate(req, res, auth) {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "method_not_allowed" });
    return;
  }
  const body = await readBody(req, res);
  if (body === undefined) return;
  if (!isPlainObject(body)) {
    sendJson(res, 400, { error: "invalid_request" });
    return;
  }
  const courseTitle = typeof body.courseTitle === "string" ? body.courseTitle.trim().slice(0, 300) : "";
  const moduleTitle = typeof body.moduleTitle === "string" ? body.moduleTitle.trim().slice(0, 300) : "";
  const moduleDescription = typeof body.moduleDescription === "string" ? body.moduleDescription.trim().slice(0, 600) : "";
  if (!courseTitle || !moduleTitle || !moduleDescription) {
    sendJson(res, 400, { error: "invalid_request" });
    return;
  }
  try {
    const result = await deepseek.chatCompletion({
      messages: [
        { role: "system", content: buildLessonSystemPrompt() },
        { role: "user", content: buildLessonUserPrompt(courseTitle, moduleTitle, moduleDescription) },
      ],
      temperature: 0.4,
      maxTokens: 1800,
      jsonMode: true,
      thinking: { type: "disabled" },
    });
    const lesson = sanitizeLesson(parseJsonContent(result.content));
    if (!lesson) {
      console.error("AI lesson request failed: lesson_invalid");
      sendJson(res, 502, { error: "lesson_invalid" });
      return;
    }
    sendJson(res, 200, lesson);
  } catch (error) {
    const mapped = mapAiError(error);
    console.error(`AI lesson request failed: ${mapped.logCode}`);
    sendJson(res, mapped.status, { error: mapped.publicCode });
  }
}

function validateTutorRequest(body) {
  if (!isPlainObject(body)) return { error: "invalid_request", status: 400 };
  if (typeof body.lessonTitle !== "string" || !body.lessonTitle.trim()) return { error: "invalid_request", status: 400 };
  if (typeof body.lessonObjective !== "string" || !body.lessonObjective.trim()) return { error: "invalid_request", status: 400 };
  if (!Array.isArray(body.messages) || body.messages.length === 0) return { error: "invalid_messages", status: 400 };
  if (body.messages.length > TUTOR_MAX_MESSAGES) return { error: "too_many_messages", status: 400 };
  const messages = [];
  for (let index = 0; index < body.messages.length; index += 1) {
    const message = body.messages[index];
    if (!isPlainObject(message) || (message.role !== "user" && message.role !== "assistant")) return { error: "invalid_role", status: 400 };
    const expectedRole = index % 2 === 0 ? "user" : "assistant";
    if (message.role !== expectedRole) return { error: "invalid_conversation", status: 400 };
    if (typeof message.content !== "string" || !message.content.trim()) return { error: "invalid_messages", status: 400 };
    if (message.content.length > MAX_MESSAGE_CHARS) return { error: "message_too_long", status: 413 };
    messages.push({ role: message.role, content: message.content.trim() });
  }
  return {
    messages,
    lessonTitle: body.lessonTitle.trim().slice(0, 300),
    lessonObjective: body.lessonObjective.trim().slice(0, 500),
    lessonSummary: typeof body.lessonSummary === "string" ? body.lessonSummary.trim().slice(0, 6000) : "",
  };
}

async function handleTutor(req, res, auth) {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "method_not_allowed" });
    return;
  }
  const body = await readBody(req, res);
  if (body === undefined) return;
  const parsed = validateTutorRequest(body);
  if (parsed.error) {
    sendJson(res, parsed.status, { error: parsed.error });
    return;
  }
  try {
    const result = await deepseek.chatCompletion({
      messages: [
        { role: "system", content: buildTutorSystemPrompt(parsed.lessonTitle, parsed.lessonObjective, parsed.lessonSummary) },
        ...parsed.messages,
      ],
      temperature: 0.7,
      maxTokens: 400,
      thinking: { type: "disabled" },
    });
    sendJson(res, 200, { reply: result.content });
  } catch (error) {
    const mapped = mapAiError(error);
    console.error(`AI tutor request failed: ${mapped.logCode}`);
    sendJson(res, mapped.status, { error: mapped.publicCode });
  }
}

async function handleExerciseEvaluate(req, res, auth) {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "method_not_allowed" });
    return;
  }
  const body = await readBody(req, res);
  if (body === undefined) return;
  if (!isPlainObject(body)) {
    sendJson(res, 400, { error: "invalid_request" });
    return;
  }
  const question = typeof body.question === "string" ? body.question.trim().slice(0, 1000) : "";
  const answer = typeof body.answer === "string" ? body.answer.trim().slice(0, 1500) : "";
  const options = Array.isArray(body.options)
    ? body.options.slice(0, 5).map((option) => (typeof option === "string" ? option.trim().slice(0, 300) : "")).filter(Boolean)
    : [];
  if (!question || !answer) {
    sendJson(res, 400, { error: "invalid_request" });
    return;
  }
  try {
    const result = await deepseek.chatCompletion({
      messages: [
        { role: "system", content: buildExerciseSystemPrompt() },
        { role: "user", content: buildExerciseUserPrompt(question, options, answer) },
      ],
      temperature: 0.2,
      maxTokens: 600,
      jsonMode: true,
      thinking: { type: "disabled" },
    });
    const outcome = sanitizeExerciseResult(parseJsonContent(result.content));
    if (!outcome) {
      console.error("AI exercise request failed: exercise_invalid");
      sendJson(res, 502, { error: "exercise_invalid" });
      return;
    }
    sendJson(res, 200, { assessment: outcome.assessment, explanation: outcome.explanation, key_point: outcome.keyPoint });
  } catch (error) {
    const mapped = mapAiError(error);
    console.error(`AI exercise request failed: ${mapped.logCode}`);
    sendJson(res, mapped.status, { error: mapped.publicCode });
  }
}

function serveMp3(res, filePath) {
  try {
    const buffer = fs.readFileSync(filePath);
    res.writeHead(200, {
      "Content-Type": "audio/mpeg",
      "Content-Length": buffer.length,
      "Cache-Control": "public, max-age=86400",
    });
    res.end(buffer);
  } catch {
    sendJson(res, 404, { error: "not_found" });
  }
}

async function handleTts(req, res, auth) {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "method_not_allowed" });
    return;
  }
  const body = await readBody(req, res);
  if (body === undefined) return;
  if (!isPlainObject(body) || typeof body.text !== "string") {
    sendJson(res, 400, { error: "invalid_request" });
    return;
  }
  const text = body.text.trim().slice(0, TTS_MAX_TEXT);
  if (!text) {
    sendJson(res, 400, { error: "invalid_request" });
    return;
  }
  const voice = TTS_VOICES.includes(body.voice) ? body.voice : TTS_DEFAULT_VOICE;
  const rate = typeof body.rate === "string" ? body.rate : "-4%";
  const pitch = typeof body.pitch === "string" ? body.pitch : "+0Hz";
  const cacheKey = crypto.createHash("sha256").update(`${voice}|${rate}|${pitch}|${text}`).digest("hex");
  const cachePath = path.join(TTS_CACHE_DIR, `${cacheKey}.mp3`);
  if (fs.existsSync(cachePath)) {
    serveMp3(res, cachePath);
    return;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TTS_TIMEOUT_MS);
  let upstream;
  try {
    upstream = await fetch(`${TTS_SERVICE_URL}/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, voice, rate, pitch }),
      signal: controller.signal,
    });
  } catch {
    clearTimeout(timer);
    console.error("AI tts request failed: unreachable");
    sendJson(res, 503, { error: "tts_unavailable" });
    return;
  }
  clearTimeout(timer);
  if (!upstream.ok) {
    console.error(`AI tts request failed: ${upstream.status}`);
    sendJson(res, 502, { error: "tts_failed" });
    return;
  }
  const buffer = Buffer.from(await upstream.arrayBuffer());
  if (!buffer.length) {
    console.error("AI tts request failed: empty");
    sendJson(res, 502, { error: "tts_failed" });
    return;
  }
  try {
    fs.mkdirSync(TTS_CACHE_DIR, { recursive: true });
    fs.writeFileSync(cachePath, buffer);
  } catch {
    /* cache write failure is non-fatal */
  }
  res.writeHead(200, {
    "Content-Type": "audio/mpeg",
    "Content-Length": buffer.length,
    "Cache-Control": "public, max-age=86400",
  });
  res.end(buffer);
}

async function handleScenarios(req, res) {
  if (req.method !== "GET") {
    sendJson(res, 405, { error: "method_not_allowed" });
    return;
  }
  sendJson(res, 200, { scenarios: publicScenarioList() });
}

async function handleCatalogue(req, res) {
  if (req.method !== "GET") {
    sendJson(res, 405, { error: "method_not_allowed" });
    return;
  }
  try {
    const courses = await store.listCourses({ status: "published" });
    const catalogue = courses.map((course) => ({
      id: course.id,
      title: course.title,
      objective: course.objective,
      estimatedDuration: course.estimatedDuration || "",
      modules: (course.modules || []).map((module) => ({
        id: module.id,
        title: module.title,
        description: module.description || "",
      })),
    }));
    sendJson(res, 200, { courses: catalogue });
  } catch {
    sendJson(res, 503, { error: "db_unavailable" });
  }
}

module.exports = {
  requireOptionalAuth,
  handleCustomer,
  handleEvaluate,
  handleCourseGenerate,
  handleLessonGenerate,
  handleTutor,
  handleExerciseEvaluate,
  handleTts,
  handleScenarios,
  handleCatalogue,
};
