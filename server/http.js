"use strict";

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "same-origin",
  });
  res.end(body);
}

function sendText(res, status, text) {
  res.writeHead(status, {
    "Content-Type": "text/plain; charset=utf-8",
    "Content-Length": Buffer.byteLength(text),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "same-origin",
  });
  res.end(text);
}

const ERROR_MESSAGES = {
  invalid_request: { status: 400, message: "Requête invalide." },
  invalid_json: { status: 400, message: "Corps de requête JSON invalide." },
  payload_too_large: { status: 413, message: "Requête trop volumineuse." },
  method_not_allowed: { status: 405, message: "Méthode non autorisée." },
  not_found: { status: 404, message: "Ressource introuvable." },
  unauthorized: { status: 401, message: "Authentification requise." },
  forbidden: { status: 403, message: "Accès refusé." },
  db_unavailable: { status: 503, message: "La base de données est momentanément indisponible." },
  internal_error: { status: 500, message: "Erreur interne." },
  rate_limited: { status: 429, message: "Trop de tentatives. Réessayez plus tard." },
  invalid_email: { status: 400, message: "Adresse e-mail invalide." },
  invalid_first_name: { status: 400, message: "Prénom invalide." },
  invalid_last_name: { status: 400, message: "Nom invalide." },
  weak_password: { status: 400, message: "Le mot de passe doit contenir au moins 10 caractères." },
  invalid_credentials: { status: 401, message: "E-mail ou mot de passe incorrect." },
  account_disabled: { status: 403, message: "Ce compte est désactivé. Contactez votre administrateur." },
  email_taken: { status: 409, message: "Un compte existe déjà avec cette adresse e-mail." },
  registration_disabled: { status: 403, message: "L’inscription publique est désactivée. Contactez votre administrateur." },
  invalid_token: { status: 400, message: "Lien de réinitialisation invalide ou expiré." },
  verification_invalid: { status: 400, message: "Lien de vérification invalide ou expiré. Vous pouvez demander un nouvel envoi." },
  invalid_subject: { status: 400, message: "Objet du message invalide." },
  invalid_message: { status: 400, message: "Contenu du message invalide." },
  invalid_recipients: { status: 400, message: "Destinataires invalides." },
  invalid_role: { status: 400, message: "Rôle invalide." },
  invalid_status: { status: 400, message: "Statut invalide." },
  invalid_objective: { status: 400, message: "Objectif invalide." },
  invalid_title: { status: 400, message: "Titre invalide." },
  invalid_modules: { status: 400, message: "Modules invalides." },
  invalid_deadline: { status: 400, message: "Échéance invalide." },
  empty_update: { status: 400, message: "Aucun champ à mettre à jour." },
  user_not_found: { status: 404, message: "Utilisateur introuvable." },
  course_not_found: { status: 404, message: "Cours introuvable." },
  assignment_not_found: { status: 404, message: "Affectation introuvable." },
  course_not_published: { status: 409, message: "Le cours n’est pas publié." },
  already_assigned: { status: 409, message: "Le cours est déjà affecté à cet utilisateur." },
  last_admin: { status: 409, message: "Impossible de désactiver le dernier administrateur actif." },
  cannot_self_disable: { status: 409, message: "Vous ne pouvez pas désactiver votre propre compte." },
  cannot_delete_self: { status: 409, message: "Vous ne pouvez pas supprimer votre propre compte." },
  password_mismatch: { status: 400, message: "Le mot de passe actuel est incorrect." },
  course_invalid: { status: 502, message: "Le contenu généré n’a pas pu être validé. Réessayez." },
  ai_unavailable: { status: 503, message: "Le service IA est momentanément indisponible." },
  ai_timeout: { status: 504, message: "Le service IA met trop de temps à répondre." },
  ai_rate_limited: { status: 429, message: "Le service IA est très sollicité. Réessayez dans un instant." },
  ai_error: { status: 502, message: "Le service IA a rencontré une erreur." },
};

function sendError(res, code, statusOverride) {
  const definition = ERROR_MESSAGES[code] || ERROR_MESSAGES.internal_error;
  sendJson(res, statusOverride || definition.status, {
    error: { code: code.toUpperCase(), message: definition.message },
  });
}

function readJsonBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let settled = false;
    const chunks = [];
    const fail = (code) => {
      if (settled) return;
      settled = true;
      reject({ code });
    };
    req.on("data", (chunk) => {
      if (settled) return;
      size += chunk.length;
      if (size > limit) {
        fail("too_large");
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (settled) return;
      settled = true;
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw.trim()) {
        reject({ code: "invalid_json" });
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject({ code: "invalid_json" });
      }
    });
    req.on("error", () => fail("read_error"));
  });
}

function extractQuery(url) {
  const query = {};
  url.searchParams.forEach((value, key) => {
    query[key] = value;
  });
  return query;
}

function safeRoute(req, res, handler) {
  Promise.resolve()
    .then(() => handler())
    .catch((error) => {
      if (error && error.code === "db_unavailable") {
        if (!res.headersSent) sendError(res, "db_unavailable");
        return;
      }
      console.error(`[api] unhandled route error: ${error && error.stack ? error.stack : error}`);
      if (!res.headersSent) sendError(res, "internal_error");
      else res.destroy();
    });
}

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  let originHost;
  try {
    originHost = new URL(origin).host;
  } catch {
    return false;
  }
  return originHost === req.headers.host;
}

function requireSameOrigin(req, res, next) {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") {
    return next();
  }
  if (!sameOrigin(req)) {
    sendError(res, "forbidden");
    return Promise.resolve();
  }
  return next();
}

module.exports = {
  isPlainObject,
  sendJson,
  sendText,
  sendError,
  readJsonBody,
  extractQuery,
  safeRoute,
  requireSameOrigin,
};
