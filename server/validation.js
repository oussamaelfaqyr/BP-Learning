"use strict";

const { ObjectId } = require("mongodb");

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const NAME_PATTERN = /^[\p{L}\p{M}' .-]+$/u;

const ROLE_VALUES = ["user", "admin"];
const USER_STATUS_VALUES = ["active", "disabled"];
const COURSE_STATUS_VALUES = ["draft", "published", "archived"];
const ASSIGNMENT_STATUS_VALUES = ["assigned", "completed", "cancelled"];
const COURSE_ORIGIN_VALUES = ["personal", "admin"];

const MAX_EMAIL_LENGTH = 254;
const MAX_NAME_LENGTH = 80;
const MIN_PASSWORD_LENGTH = 10;
const MAX_PASSWORD_LENGTH = 128;
const MAX_OBJECTIVE_LENGTH = 600;

function cleanString(value, max) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function isValidEmail(value) {
  return typeof value === "string" && value.length <= MAX_EMAIL_LENGTH && EMAIL_PATTERN.test(value.trim());
}

function normalizeEmail(value) {
  return isValidEmail(value) ? value.trim().toLowerCase() : "";
}

function isValidName(value) {
  return typeof value === "string" && value.trim().length >= 1 && value.trim().length <= MAX_NAME_LENGTH && NAME_PATTERN.test(value.trim());
}

function isValidPassword(value) {
  return (
    typeof value === "string" &&
    value.length >= MIN_PASSWORD_LENGTH &&
    value.length <= MAX_PASSWORD_LENGTH
  );
}

function isValidObjectId(value) {
  return typeof value === "string" && ObjectId.isValid(value);
}

function toObjectId(value) {
  if (value instanceof ObjectId) return value;
  if (isValidObjectId(value)) return new ObjectId(value);
  return null;
}

function isValidRole(value) {
  return ROLE_VALUES.includes(value);
}

function isValidUserStatus(value) {
  return USER_STATUS_VALUES.includes(value);
}

function isValidCourseStatus(value) {
  return COURSE_STATUS_VALUES.includes(value);
}

function isValidCourseOrigin(value) {
  return COURSE_ORIGIN_VALUES.includes(value);
}

function isValidAssignmentStatus(value) {
  return ASSIGNMENT_STATUS_VALUES.includes(value);
}

function isValidPagination(value) {
  if (!isPlainObject(value)) return { limit: 25, offset: 0 };
  let limit = Number(value.limit);
  let offset = Number(value.offset);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) limit = 25;
  if (!Number.isInteger(offset) || offset < 0) offset = 0;
  return { limit, offset };
}

function isValidDeadline(value) {
  if (value === null || value === undefined || value === "") return { deadline: null };
  if (typeof value !== "string") return { error: "invalid_deadline" };
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { error: "invalid_deadline" };
  return { deadline: date };
}

function validateRegistrationInput(body) {
  if (!isPlainObject(body)) return { error: "invalid_request" };
  const firstName = cleanString(body.firstName, MAX_NAME_LENGTH);
  const lastName = cleanString(body.lastName, MAX_NAME_LENGTH);
  const email = normalizeEmail(body.email);
  const password = typeof body.password === "string" ? body.password : "";
  if (!isValidName(firstName)) return { error: "invalid_first_name" };
  if (!isValidName(lastName)) return { error: "invalid_last_name" };
  if (!email) return { error: "invalid_email" };
  if (!isValidPassword(password)) return { error: "weak_password" };
  return { value: { firstName, lastName, email, password } };
}

function validateLoginInput(body) {
  if (!isPlainObject(body)) return { error: "invalid_request" };
  const email = normalizeEmail(body.email);
  const password = typeof body.password === "string" ? body.password : "";
  if (!email) return { error: "invalid_email" };
  if (!password || password.length > MAX_PASSWORD_LENGTH) return { error: "invalid_credentials" };
  return { value: { email, password } };
}

function validateAdminUserInput(body, { requirePassword = false } = {}) {
  if (!isPlainObject(body)) return { error: "invalid_request" };
  const firstName = cleanString(body.firstName, MAX_NAME_LENGTH);
  const lastName = cleanString(body.lastName, MAX_NAME_LENGTH);
  const email = normalizeEmail(body.email);
  const role = typeof body.role === "string" && body.role.trim() ? body.role.trim() : "admin";
  if (!isValidName(firstName)) return { error: "invalid_first_name" };
  if (!isValidName(lastName)) return { error: "invalid_last_name" };
  if (!email) return { error: "invalid_email" };
  if (!isValidRole(role)) return { error: "invalid_role" };
  if (requirePassword) {
    const password = typeof body.password === "string" ? body.password : "";
    if (!isValidPassword(password)) return { error: "weak_password" };
    return { value: { firstName, lastName, email, role, password } };
  }
  return { value: { firstName, lastName, email, role } };
}

function validateProfileUpdate(body) {
  if (!isPlainObject(body)) return { error: "invalid_request" };
  const update = {};
  if (body.firstName !== undefined) {
    const firstName = cleanString(body.firstName, MAX_NAME_LENGTH);
    if (!isValidName(firstName)) return { error: "invalid_first_name" };
    update.firstName = firstName;
  }
  if (body.lastName !== undefined) {
    const lastName = cleanString(body.lastName, MAX_NAME_LENGTH);
    if (!isValidName(lastName)) return { error: "invalid_last_name" };
    update.lastName = lastName;
  }
  if (body.learningObjective !== undefined) {
    if (typeof body.learningObjective !== "string" || body.learningObjective.length > MAX_OBJECTIVE_LENGTH) {
      return { error: "invalid_objective" };
    }
    update.learningObjective = body.learningObjective.trim();
  }
  if (!Object.keys(update).length) return { error: "empty_update" };
  return { value: update };
}

function validatePasswordChange(body) {
  if (!isPlainObject(body)) return { error: "invalid_request" };
  const currentPassword = typeof body.currentPassword === "string" ? body.currentPassword : "";
  const newPassword = typeof body.newPassword === "string" ? body.newPassword : "";
  if (!currentPassword || currentPassword.length > MAX_PASSWORD_LENGTH) return { error: "invalid_credentials" };
  if (!isValidPassword(newPassword)) return { error: "weak_password" };
  return { value: { currentPassword, newPassword } };
}

function validateResetPasswordInput(body) {
  if (!isPlainObject(body)) return { error: "invalid_request" };
  const token = typeof body.token === "string" ? body.token.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!/^[a-f0-9]{64}$/i.test(token)) return { error: "invalid_token" };
  if (!isValidPassword(password)) return { error: "weak_password" };
  return { value: { token, password } };
}

function validateForgotInput(body) {
  if (!isPlainObject(body)) return { error: "invalid_request" };
  const email = normalizeEmail(body.email);
  if (!email) return { error: "invalid_email" };
  return { value: { email } };
}

function validateVerifyEmailInput(body) {
  if (!isPlainObject(body)) return { error: "invalid_request" };
  const token = typeof body.token === "string" ? body.token.trim() : "";
  if (!/^[a-f0-9]{64}$/i.test(token)) return { error: "invalid_token" };
  return { value: { token } };
}

const MAX_MESSAGE_SUBJECT_LENGTH = 200;
const MAX_MESSAGE_TEXT_LENGTH = 5000;
const MAX_MESSAGE_RECIPIENTS = 200;

function validateAdminMessageInput(body) {
  if (!isPlainObject(body)) return { error: "invalid_request" };
  const subject = cleanString(body.subject, MAX_MESSAGE_SUBJECT_LENGTH);
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!subject) return { error: "invalid_subject" };
  if (!text || text.length > MAX_MESSAGE_TEXT_LENGTH) return { error: "invalid_message" };

  let recipients = null;
  if (body.recipients === "all") {
    recipients = "all";
  } else if (Array.isArray(body.recipients)) {
    const userIds = body.recipients
      .filter((id) => isValidObjectId(id))
      .slice(0, MAX_MESSAGE_RECIPIENTS);
    if (!userIds.length) return { error: "invalid_recipients" };
    recipients = userIds;
  }
  if (!recipients) return { error: "invalid_recipients" };
  return { value: { subject, text, recipients } };
}

function validateCourseInput(body) {
  if (!isPlainObject(body)) return { error: "invalid_request" };
  const title = cleanString(body.title, 200);
  const objective = cleanString(body.objective, 500);
  const estimatedDuration = cleanString(body.estimatedDuration, 60) || "Environ 20 minutes";
  const modules = Array.isArray(body.modules)
    ? body.modules
        .slice(0, 6)
        .map((module, index) => {
          if (!isPlainObject(module)) return null;
          const moduleTitle = cleanString(module.title, 160);
          const description = cleanString(module.description, 400);
          if (!moduleTitle || !description) return null;
          const id =
            cleanString(module.id, 40).toLowerCase().replace(/[^a-z0-9-]/g, "-") ||
            `module-${index + 1}`;
          return { id, title: moduleTitle, description };
        })
        .filter(Boolean)
    : [];
  if (!title) return { error: "invalid_title" };
  if (!objective) return { error: "invalid_objective" };
  if (modules.length < 1) return { error: "invalid_modules" };
  const deadline = isValidDeadline(body.deadline);
  if (deadline.error) return { error: deadline.error };
  return {
    value: {
      title,
      objective,
      estimatedDuration,
      modules,
      description: cleanString(body.description, 1000),
      deadline: deadline.deadline,
    },
  };
}

module.exports = {
  isPlainObject,
  cleanString,
  isValidEmail,
  normalizeEmail,
  isValidName,
  isValidPassword,
  isValidObjectId,
  toObjectId,
  isValidRole,
  isValidUserStatus,
  isValidCourseStatus,
  isValidCourseOrigin,
  isValidAssignmentStatus,
  isValidPagination,
  isValidDeadline,
  validateRegistrationInput,
  validateLoginInput,
  validateAdminUserInput,
  validateProfileUpdate,
  validatePasswordChange,
  validateResetPasswordInput,
  validateForgotInput,
  validateVerifyEmailInput,
  validateAdminMessageInput,
  validateCourseInput,
  ROLE_VALUES,
  USER_STATUS_VALUES,
  COURSE_STATUS_VALUES,
  ASSIGNMENT_STATUS_VALUES,
  COURSE_ORIGIN_VALUES,
  MIN_PASSWORD_LENGTH,
  MAX_PASSWORD_LENGTH,
  MAX_MESSAGE_SUBJECT_LENGTH,
  MAX_MESSAGE_TEXT_LENGTH,
  MAX_MESSAGE_RECIPIENTS,
};
