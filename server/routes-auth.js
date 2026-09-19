"use strict";

const { sendJson, sendError, readJsonBody } = require("./http");
const {
  hashPassword,
  verifyPassword,
  randomToken,
  sessionTokenHash,
  resetTokenHash,
  verificationTokenHash,
  buildSessionRecord,
  serializeCookie,
  secureCookieOptions,
  clearSessionCookie,
  extractSessionToken,
} = require("./auth");
const { config } = require("./config");
const store = require("./store");
const { loginLimiter, authLimiter } = require("./rate-limit");
const validation = require("./validation");
const emailService = require("./email");

const MAX_BODY_BYTES = 16 * 1024;

let dummyHashPromise = null;
function getDummyHash() {
  if (!dummyHashPromise) dummyHashPromise = hashPassword("bp-learning-dummy-password");
  return dummyHashPromise;
}

async function readBody(req, res) {
  try {
    return await readJsonBody(req, MAX_BODY_BYTES);
  } catch (error) {
    if (error && error.code === "too_large") {
      sendError(res, "payload_too_large");
    } else {
      sendError(res, "invalid_json");
    }
    return undefined;
  }
}

async function handleRegister(req, res) {
  if (req.method !== "POST") return sendError(res, "method_not_allowed");
  if (!config.allowPublicRegistration) return sendError(res, "registration_disabled");
  const limited = await authLimiter(req);
  if (!limited.allowed) return sendError(res, "rate_limited");
  const body = await readBody(req, res);
  if (body === undefined) return;
  const parsed = validation.validateRegistrationInput(body);
  if (parsed.error) return sendError(res, parsed.error);
  const { firstName, lastName, email, password } = parsed.value;

  const existing = await store.findUserByEmail(email);
  if (existing) return sendError(res, "email_taken");

  const passwordHash = await hashPassword(password);
  const role = config.adminEmails.includes(email.toLowerCase()) ? "admin" : "user";
  let user;
  try {
    user = await store.createUser({ firstName, lastName, email, role, passwordHash });
  } catch (error) {
    if (error && error.code === 11000) return sendError(res, "email_taken");
    throw error;
  }

  await store.recordAudit("USER_REGISTERED", user._id, user._id, { role });

  const verificationToken = randomToken(32);
  await store.createVerificationToken(user._id, verificationTokenHash(verificationToken));
  const verifyUrl = `${config.appBaseUrl}/#/verify-email?token=${verificationToken}`;
  const loginUrl = `${config.appBaseUrl}/#/login`;
  const welcomeResultPromise = emailService
    .sendWelcomeEmail({ to: user.email, firstName: user.firstName, loginUrl })
    .catch((error) => {
      console.error(`[email] welcome delivery failed: ${error && error.message}`);
      return { delivered: false, reason: "delivery_failed" };
    });
  const verificationResultPromise = emailService
    .sendVerificationEmail({ to: user.email, firstName: user.firstName, verifyUrl })
    .catch((error) => {
      console.error(`[email] verification delivery failed: ${error && error.message}`);
      return { delivered: false, reason: "delivery_failed" };
    });

  const token = randomToken(32);
  await store.createSession(buildSessionRecord(user._id, token, req));
  res.setHeader("Set-Cookie", serializeCookie(config.sessionCookieName, token, secureCookieOptions()));

  const [welcomeResult, verificationResult] = await Promise.all([
    welcomeResultPromise,
    verificationResultPromise,
  ]);
  sendJson(res, 201, {
    user: store.publicUser(user),
    welcome: { sent: welcomeResult.delivered },
    verification: {
      sent: verificationResult.delivered,
      ...(config.isProduction ? {} : { devVerifyUrl: verifyUrl }),
    },
  });
}

async function handleLogin(req, res) {
  if (req.method !== "POST") return sendError(res, "method_not_allowed");
  const body = await readBody(req, res);
  if (body === undefined) return;
  const parsed = validation.validateLoginInput(body);
  if (parsed.error) {
    if (parsed.error === "invalid_email") return sendError(res, "invalid_credentials");
    return sendError(res, parsed.error);
  }
  const { email, password } = parsed.value;

  const limited = await loginLimiter(req, email);
  if (!limited.allowed) return sendError(res, "rate_limited");

  const user = await store.findUserByEmail(email);
  const hashToVerify = user && user.passwordHash ? user.passwordHash : await getDummyHash();
  const passwordOk = await verifyPassword(password, hashToVerify);

  if (!user || !passwordOk) {
    return sendError(res, "invalid_credentials");
  }
  if (user.status !== "active") {
    return sendError(res, "account_disabled");
  }

  const token = randomToken(32);
  await store.createSession(buildSessionRecord(user._id, token, req));
  await store.recordUserLogin(user._id);
  res.setHeader("Set-Cookie", serializeCookie(config.sessionCookieName, token, secureCookieOptions()));
  sendJson(res, 200, { user: store.publicUser(user) });
}

async function handleLogout(req, res) {
  if (req.method !== "POST") return sendError(res, "method_not_allowed");
  const token = extractSessionToken(req);
  if (token) {
    try {
      await store.deleteSession(sessionTokenHash(token));
    } catch {
      /* database hiccup during logout: still clear the cookie */
    }
  }
  res.setHeader("Set-Cookie", clearSessionCookie());
  sendJson(res, 200, { ok: true });
}

async function handleForgotPassword(req, res) {
  if (req.method !== "POST") return sendError(res, "method_not_allowed");
  const limited = await authLimiter(req);
  if (!limited.allowed) return sendError(res, "rate_limited");
  const body = await readBody(req, res);
  if (body === undefined) return;
  const parsed = validation.validateForgotInput(body);
  if (parsed.error) return sendError(res, parsed.error);

  const user = await store.findUserByEmail(parsed.value.email);
  let devResetUrl = null;
  if (user && user.status === "active") {
    const token = randomToken(32);
    await store.createResetToken(user._id, resetTokenHash(token));
    const resetUrl = `${config.appBaseUrl}/#/reset-password?token=${token}`;
    await emailService.sendResetPasswordEmail({
      to: user.email,
      firstName: user.firstName,
      resetUrl,
    });
    if (!config.isProduction) {
      devResetUrl = resetUrl;
    }
  }

  sendJson(res, 202, {
    ok: true,
    message: "Si un compte existe avec cette adresse, un lien de réinitialisation a été envoyé.",
    ...(devResetUrl ? { devResetUrl } : {}),
  });
}

async function handleResetPassword(req, res) {
  if (req.method !== "POST") return sendError(res, "method_not_allowed");
  const limited = await authLimiter(req);
  if (!limited.allowed) return sendError(res, "rate_limited");
  const body = await readBody(req, res);
  if (body === undefined) return;
  const parsed = validation.validateResetPasswordInput(body);
  if (parsed.error) return sendError(res, parsed.error);
  const { token, password } = parsed.value;

  const consumed = await store.consumeResetToken(resetTokenHash(token));
  if (!consumed) return sendError(res, "invalid_token");

  const user = await store.findUserById(consumed.userId);
  if (!user || user.status !== "active") return sendError(res, "invalid_token");

  const passwordHash = await hashPassword(password);
  await store.setUserPassword(user._id, passwordHash);
  await store.deleteAllSessionsForUser(user._id);
  await store.markEmailVerified(user._id);
  await store.recordAudit("PASSWORD_RESET", user._id, user._id, {});

  sendJson(res, 200, { ok: true, message: "Mot de passe réinitialisé. Vous pouvez vous connecter." });
}

async function handleVerifyEmail(req, res) {
  if (req.method !== "POST") return sendError(res, "method_not_allowed");
  const limited = await authLimiter(req);
  if (!limited.allowed) return sendError(res, "rate_limited");
  const body = await readBody(req, res);
  if (body === undefined) return;
  const parsed = validation.validateVerifyEmailInput(body);
  if (parsed.error) return sendError(res, parsed.error);

  const consumed = await store.consumeVerificationToken(verificationTokenHash(parsed.value.token));
  if (!consumed) return sendError(res, "verification_invalid");

  const user = await store.findUserById(consumed.userId);
  if (!user) return sendError(res, "verification_invalid");

  await store.markEmailVerified(user._id);
  await store.recordAudit("EMAIL_VERIFIED", user._id, user._id, {});
  sendJson(res, 200, {
    ok: true,
    user: store.publicUser({ ...user, emailVerified: true }),
    message: "Votre adresse e-mail a été vérifiée.",
  });
}

async function handleResendVerification(req, res) {
  if (req.method !== "POST") return sendError(res, "method_not_allowed");
  const limited = await authLimiter(req);
  if (!limited.allowed) return sendError(res, "rate_limited");
  const body = await readBody(req, res);
  if (body === undefined) return;
  const parsed = validation.validateForgotInput(body);
  if (parsed.error) return sendError(res, parsed.error);

  const user = await store.findUserByEmail(parsed.value.email);
  let devVerifyUrl = null;
  if (user && user.status === "active" && !user.emailVerified) {
    const token = randomToken(32);
    await store.createVerificationToken(user._id, verificationTokenHash(token));
    const verifyUrl = `${config.appBaseUrl}/#/verify-email?token=${token}`;
    await emailService.sendVerificationEmail({
      to: user.email,
      firstName: user.firstName,
      verifyUrl,
    });
    if (!config.isProduction) devVerifyUrl = verifyUrl;
  }

  sendJson(res, 202, {
    ok: true,
    message: "Si votre compte n’est pas encore vérifié, un lien de vérification a été envoyé.",
    ...(devVerifyUrl ? { devVerifyUrl } : {}),
  });
}

async function handleAuthConfig(req, res) {
  if (req.method !== "GET") return sendError(res, "method_not_allowed");
  sendJson(res, 200, {
    allowPublicRegistration: config.allowPublicRegistration,
    minimumPasswordLength: validation.MIN_PASSWORD_LENGTH,
  });
}

module.exports = {
  handleRegister,
  handleLogin,
  handleLogout,
  handleForgotPassword,
  handleResetPassword,
  handleVerifyEmail,
  handleResendVerification,
  handleAuthConfig,
};
