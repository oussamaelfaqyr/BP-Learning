"use strict";

const { config } = require("./config");
const { sendMailSmtp } = require("./smtp");

function transportName() {
  return (process.env.EMAIL_TRANSPORT || "").toLowerCase();
}

async function deliver({ to, subject, text }) {
  const transport = transportName();

  if (transport === "http") {
    const endpoint = process.env.EMAIL_HTTP_URL;
    if (!endpoint) return { delivered: false, reason: "transport_not_configured" };
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to, from: config.emailFrom, subject, text }),
      });
      return { delivered: response.ok, transport: "http" };
    } catch (error) {
      console.error(`[email] delivery failed: ${error.message}`);
      return { delivered: false, reason: "delivery_failed" };
    }
  }

  if (transport === "smtp") {
    const host = process.env.SMTP_HOST || "";
    const port = Number(process.env.SMTP_PORT) || 587;
    const user = process.env.SMTP_USER || "";
    const password = process.env.SMTP_PASSWORD || "";
    const fromName = process.env.SMTP_FROM_NAME || "BP Learning";
    const secure = /^(1|true|yes|on)$/i.test(process.env.SMTP_SECURE || "");
    if (!host || !user) {
      console.error("[email] SMTP is not fully configured (SMTP_HOST, SMTP_USER).");
      return { delivered: false, reason: "transport_not_configured" };
    }
    return sendMailSmtp({
      host,
      port,
      secure,
      user,
      password,
      fromName,
      fromEmail: user || config.emailFrom,
      to: [to],
      subject,
      text,
    });
  }

  if (transport === "console") {
    console.log(`[email] Would send to ${to}`);
    console.log(`[email] Subject: ${subject}`);
    console.log(`[email] Body:\n${text}`);
    return { delivered: true, transport: "console" };
  }

  if (!config.isProduction) {
    console.log(`[email] (development) Would send to ${to}`);
    console.log(`[email] Subject: ${subject}`);
    console.log(`[email] Body:\n${text}`);
    return { delivered: true, transport: "console" };
  }

  console.error(
    "[email] EMAIL_TRANSPORT is not configured in production: cannot deliver email."
  );
  return { delivered: false, reason: "transport_not_configured" };
}

function signature() {
  return [
    "",
    "L’équipe BP Learning",
    "",
    "Ce message est généré automatiquement.",
  ].join("\n");
}

async function sendResetPasswordEmail({ to, firstName, resetUrl }) {
  const subject = "BP Learning — réinitialisation de votre mot de passe";
  const text = [
    `Bonjour ${firstName || ""},`,
    "",
    "Une demande de réinitialisation de mot de passe a été faite pour votre compte BP Learning.",
    "Si vous êtes à l’origine de cette demande, ouvrez le lien suivant (valable 60 minutes) :",
    "",
    resetUrl,
    "",
    "Si vous n’avez pas demandé cette réinitialisation, ignorez ce message : votre mot de passe actuel reste valide.",
    "",
    "Ce message est généré automatiquement.",
  ].join("\n");
  return deliver({ to, subject, text });
}

async function sendWelcomeEmail({ to, firstName, loginUrl }) {
  const subject = "Bienvenue sur BP Learning";
  const text = [
    `Bonjour ${firstName || ""},`,
    "",
    "Votre compte BP Learning a bien été créé. Bienvenue dans votre espace de formation !",
    "",
    "Vous pouvez dès maintenant vous connecter pour découvrir vos parcours, suivre vos leçons et vous entraîner en simulation :",
    "",
    loginUrl,
    "",
    "À bientôt au comptoir !",
    signature(),
  ].join("\n");
  return deliver({ to, subject, text });
}

async function sendVerificationEmail({ to, firstName, verifyUrl }) {
  const subject = "BP Learning — vérifiez votre adresse e-mail";
  const text = [
    `Bonjour ${firstName || ""},`,
    "",
    "Pour confirmer votre adresse e-mail sur BP Learning, ouvrez le lien suivant :",
    "",
    verifyUrl,
    "",
    "Ce lien est valable 24 heures. Si vous n’avez pas créé de compte BP Learning, ignorez ce message.",
    signature(),
  ].join("\n");
  return deliver({ to, subject, text });
}

async function sendAdminMessageEmail({ to, firstName, subject, text }) {
  const body = [
    `Bonjour ${firstName || ""},`,
    "",
    text,
    "",
    "Ce message vous a été envoyé par l’administrateur de la plateforme BP Learning.",
  ].join("\n");
  return deliver({ to, subject, text: body });
}

module.exports = {
  sendResetPasswordEmail,
  sendWelcomeEmail,
  sendVerificationEmail,
  sendAdminMessageEmail,
  deliver,
};
