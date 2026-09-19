"use strict";

const { resolveImage, sanitizeThumbnail } = require("./image-library");

const SECTION_TYPES = ["concept", "example", "key_points", "question", "comparison", "process", "timeline", "checklist", "warning", "summary", "scenario", "diagram", "chart"];

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cleanString(value, max) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function cleanItems(value, maxItems, maxChars) {
  return Array.isArray(value) ? value.map((item) => cleanString(item, maxChars)).filter(Boolean).slice(0, maxItems) : [];
}

function sanitizeCourse(value) {
  if (!isPlainObject(value)) return null;
  const modules = [];
  if (Array.isArray(value.modules)) {
    value.modules.slice(0, 5).forEach((module, index) => {
      if (!isPlainObject(module)) return;
      const title = cleanString(module.title, 160);
      const description = cleanString(module.description, 400);
      if (!title || !description) return;
      const id = cleanString(module.id, 40).toLowerCase().replace(/[^a-z0-9-]/g, "-") || `module-${index + 1}`;
      const imageId = typeof module.imageId === "string" ? module.imageId.trim().slice(0, 60) : null;
      modules.push({ id, title, description, imageId });
    });
  }
  const title = cleanString(value.title, 200);
  const objective = cleanString(value.objective, 500);
  const estimatedDuration = cleanString(value.estimatedDuration, 60);
  if (!title || !objective || modules.length < 3) return null;
  const thumbnail = sanitizeThumbnail(value.thumbnail);
  const resolvedModules = modules.map((module) => {
    const image = resolveImage(module.imageId);
    return image ? { ...module, image } : module;
  });
  return { title, objective, estimatedDuration: estimatedDuration || "Environ 20 minutes", thumbnail, modules: resolvedModules };
}

function sanitizeSection(section) {
  if (!isPlainObject(section) || !SECTION_TYPES.includes(section.type)) return null;
  const title = cleanString(section.title, 180);
  switch (section.type) {
    case "concept": {
      const content = cleanString(section.content, 2400);
      return content ? { type: "concept", title, content } : null;
    }
    case "example":
    case "scenario": {
      const situation = cleanString(section.situation, 1400);
      const response = cleanString(section.response, 1400);
      return situation || response ? { type: section.type, title, situation, response } : null;
    }
    case "key_points":
    case "checklist": {
      const items = cleanItems(section.items, 8, 300);
      return items.length ? { type: section.type, title, items } : null;
    }
    case "question": {
      const question = cleanString(section.question, 800);
      if (!question) return null;
      const options = cleanItems(section.options, 5, 300);
      return { type: "question", title, question, options };
    }
    case "comparison": {
      const items = Array.isArray(section.items)
        ? section.items.slice(0, 6).map((item) => ({
            label: cleanString(item && item.label, 160),
            left: cleanString(item && item.left, 500),
            right: cleanString(item && item.right, 500),
          })).filter((item) => item.label && (item.left || item.right))
        : [];
      return items.length ? { type: "comparison", title, items } : null;
    }
    case "process": {
      const steps = Array.isArray(section.steps)
        ? section.steps.slice(0, 6).map((step) => ({
            title: cleanString(step && step.title, 160),
            description: cleanString(step && step.description, 500),
          })).filter((step) => step.title)
        : [];
      return steps.length ? { type: "process", title, steps } : null;
    }
    case "timeline": {
      const items = Array.isArray(section.items)
        ? section.items.slice(0, 6).map((item) => ({
            label: cleanString(item && item.label, 160),
            text: cleanString(item && item.text, 500),
          })).filter((item) => item.label || item.text)
        : [];
      return items.length ? { type: "timeline", title, items } : null;
    }
    case "warning": {
      const content = cleanString(section.content, 1200);
      return content ? { type: "warning", title, content } : null;
    }
    case "summary": {
      const content = cleanString(section.content, 1600);
      const items = cleanItems(section.items, 6, 400);
      return content || items.length ? { type: "summary", title, content, items } : null;
    }
    case "diagram": {
      const nodes = Array.isArray(section.nodes)
        ? section.nodes.slice(0, 5).map((node) => ({
            label: cleanString(node && node.label, 160),
            text: cleanString(node && node.text, 500),
          })).filter((node) => node.label)
        : [];
      return nodes.length ? { type: "diagram", title, nodes } : null;
    }
    case "chart": {
      const data = Array.isArray(section.data)
        ? section.data.slice(0, 6).map((entry) => ({
            label: cleanString(entry && entry.label, 160),
            value: Number.isFinite(entry && entry.value) ? Math.max(0, Math.min(100, Math.round(entry.value))) : 0,
          })).filter((entry) => entry.label)
        : [];
      return data.length ? { type: "chart", title, data } : null;
    }
    default:
      return null;
  }
}

function sanitizeLesson(value) {
  if (!isPlainObject(value)) return null;
  const sections = [];
  if (Array.isArray(value.sections)) {
    value.sections.slice(0, 14).forEach((section) => {
      const sanitized = sanitizeSection(section);
      if (sanitized) sections.push(sanitized);
    });
  }
  const lessonTitle = cleanString(value.lessonTitle, 200);
  const objective = cleanString(value.objective, 500);
  if (!lessonTitle || !objective || sections.length === 0) return null;
  return { lessonTitle, objective, sections };
}

function sanitizeExerciseResult(value) {
  if (!isPlainObject(value)) return null;
  const assessment = cleanString(value.assessment, 40);
  const explanation = cleanString(value.explanation, 1600);
  const keyPoint = cleanString(value.key_point, 500);
  if (!["appropriate", "partial", "a_ameliorer"].includes(assessment) || !explanation || !keyPoint) return null;
  return { assessment, explanation, keyPoint };
}

module.exports = { sanitizeCourse, sanitizeLesson, sanitizeExerciseResult };
