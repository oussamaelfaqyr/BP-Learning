"use strict";

const STATUSES = ["acquis", "a_renforcer", "non_evalue"];

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validateEvaluation(value, criteriaIds) {
  const errors = [];
  if (!isPlainObject(value)) return { ok: false, errors: ["not_an_object"] };
  if (typeof value.overall !== "string" || !value.overall.trim()) errors.push("overall");
  if (!Array.isArray(value.criteria) || value.criteria.length === 0) {
    errors.push("criteria");
  } else {
    const seen = new Set();
    value.criteria.forEach((criterion) => {
      if (!isPlainObject(criterion)) {
        errors.push("criteria.item");
        return;
      }
      if (typeof criterion.id !== "string" || !criteriaIds.includes(criterion.id)) errors.push("criteria.id");
      if (seen.has(criterion.id)) errors.push("criteria.duplicate");
      seen.add(criterion.id);
      if (typeof criterion.label !== "string" || !criterion.label.trim()) errors.push("criteria.label");
      if (!Number.isFinite(criterion.score) || criterion.score < 0 || criterion.score > 100) errors.push("criteria.score");
      if (!STATUSES.includes(criterion.status)) errors.push("criteria.status");
      if (typeof criterion.evidence !== "string" || !criterion.evidence.trim()) errors.push("criteria.evidence");
      if (typeof criterion.improvement !== "string" || !criterion.improvement.trim()) errors.push("criteria.improvement");
    });
    if (seen.size !== criteriaIds.length) errors.push("criteria.incomplete");
  }
  if (typeof value.priority !== "string" || !criteriaIds.includes(value.priority)) errors.push("priority");
  if (typeof value.next_practice !== "string" || !value.next_practice.trim()) errors.push("next_practice");
  return { ok: errors.length === 0, errors };
}

function sanitizeEvaluation(value, criteria) {
  const criteriaById = new Map(criteria.map((criterion) => [criterion.id, criterion]));
  return {
    overall: value.overall.trim(),
    criteria: value.criteria.map((criterion) => {
      const definition = criteriaById.get(criterion.id) || { id: criterion.id, label: criterion.label };
      return {
        id: definition.id,
        label: definition.label,
        score: criterion.score,
        status: criterion.status,
        evidence: criterion.evidence.trim(),
        improvement: criterion.improvement.trim(),
      };
    }),
    priority: value.priority,
    next_practice: value.next_practice.trim(),
  };
}

module.exports = { STATUSES, validateEvaluation, sanitizeEvaluation };
