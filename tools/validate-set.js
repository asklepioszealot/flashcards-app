#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const SUPPORTED_EXTENSIONS = new Set([".json", ".md"]);
const REQUIRE_FILES_FLAG = "--require-files";

function parseCliArgs(rawArgs) {
  const inputTargets = [];
  let requireFiles = false;

  for (const arg of rawArgs) {
    if (arg === REQUIRE_FILES_FLAG) {
      requireFiles = true;
      continue;
    }

    if (arg.startsWith("-")) {
      throw new Error(
        `Unknown option: ${arg}. Supported options: ${REQUIRE_FILES_FLAG}`,
      );
    }

    inputTargets.push(path.resolve(arg));
  }

  return {
    requireFiles,
    usedDefaultTarget: inputTargets.length === 0,
    inputTargets:
      inputTargets.length > 0 ? inputTargets : [path.resolve("data")],
  };
}

function collectSetFiles(inputPaths, options = {}) {
  const resolvedFiles = [];
  const seen = new Set();
  const allowMissingPaths = options.allowMissingPaths || new Set();

  function walk(targetPath) {
    if (!fs.existsSync(targetPath)) {
      if (allowMissingPaths.has(path.resolve(targetPath))) {
        return;
      }
      throw new Error(`Path not found: ${targetPath}`);
    }

    const stat = fs.statSync(targetPath);
    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(targetPath)) {
        walk(path.join(targetPath, entry));
      }
      return;
    }

    const extension = path.extname(targetPath).toLowerCase();
    if (!SUPPORTED_EXTENSIONS.has(extension)) {
      return;
    }

    const normalized = path.resolve(targetPath);
    if (!seen.has(normalized)) {
      seen.add(normalized);
      resolvedFiles.push(normalized);
    }
  }

  inputPaths.forEach(walk);
  return resolvedFiles.sort((a, b) => a.localeCompare(b));
}

function normalizeQuestionText(text) {
  return String(text || "")
    .normalize("NFKC")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/[*_`>#~[\](){}|\\]/g, " ")
    .replace(/[\u200B-\u200D\uFEFF]/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .toLocaleLowerCase("tr-TR")
    .replace(/\s+/g, " ")
    .trim();
}

function questionHash(text) {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

function parseMarkdownQuestions(content) {
  const lines = content.split(/\r?\n/);
  const questions = [];
  let awaitingQuestionText = false;

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed) {
      continue;
    }

    const normalized = trimmed.replace(/^\*\*(.*?)\*\*$/, "$1").trim();
    const h3Match = normalized.match(/^###\s+(.+)$/);
    const inlineMatch = normalized.match(/^Soru:\s*(.+)$/i);
    const numberedMatch = normalized.match(
      /^Soru\s+\d+[.)]?\s*(?::\s*(.*))?$/i,
    );

    if (h3Match || inlineMatch || numberedMatch) {
      const questionText = (
        h3Match ? h3Match[1] : inlineMatch ? inlineMatch[1] : numberedMatch[1] || ""
      ).trim();

      if (questionText) {
        questions.push(questionText);
        awaitingQuestionText = false;
      } else {
        awaitingQuestionText = true;
      }
      continue;
    }

    if (awaitingQuestionText) {
      questions.push(normalized);
      awaitingQuestionText = false;
    }
  }

  return questions;
}

function validateMcqJson(setJson, filePath, errors) {
  const questions = setJson.questions;
  if (!Array.isArray(questions) || questions.length === 0) {
    errors.push(`[${filePath}] 'questions' alanı boş olamaz.`);
    return [];
  }

  const extractedQuestions = [];
  questions.forEach((question, index) => {
    const label = `[${filePath}] questions[${index}]`;
    if (!question || typeof question !== "object" || Array.isArray(question)) {
      errors.push(`${label} nesne olmalı.`);
      return;
    }

    if (typeof question.q !== "string" || !question.q.trim()) {
      errors.push(`${label}.q zorunlu ve metin olmalı.`);
    } else {
      extractedQuestions.push(question.q);
    }

    if (!Array.isArray(question.options) || question.options.length < 2) {
      errors.push(`${label}.options en az 2 seçenek içermeli.`);
    } else {
      question.options.forEach((option, optionIndex) => {
        if (typeof option !== "string" || !option.trim()) {
          errors.push(`${label}.options[${optionIndex}] boş olamaz.`);
        }
      });
    }

    if (
      !Number.isInteger(question.correct) ||
      !Array.isArray(question.options) ||
      question.correct < 0 ||
      question.correct >= question.options.length
    ) {
      errors.push(`${label}.correct geçerli bir seçenek index'i olmalı.`);
    }

    if (
      typeof question.explanation !== "string" ||
      !question.explanation.trim()
    ) {
      errors.push(`${label}.explanation zorunlu ve boş olmayan metin olmalı.`);
    }

    if (question.subject !== undefined && typeof question.subject !== "string") {
      errors.push(`${label}.subject metin olmalı.`);
    }
  });

  return extractedQuestions;
}

function validateCardArray(cards, filePath, errors, sourceLabel) {
  if (!Array.isArray(cards) || cards.length === 0) {
    errors.push(`[${filePath}] '${sourceLabel}' alanı boş olamaz.`);
    return [];
  }

  const extractedQuestions = [];
  cards.forEach((card, index) => {
    const label = `[${filePath}] ${sourceLabel}[${index}]`;
    if (!card || typeof card !== "object" || Array.isArray(card)) {
      errors.push(`${label} nesne olmalı.`);
      return;
    }

    if (typeof card.q !== "string" || !card.q.trim()) {
      errors.push(`${label}.q zorunlu ve metin olmalı.`);
    } else {
      extractedQuestions.push(card.q);
    }

    if (typeof card.a !== "string" || !card.a.trim()) {
      errors.push(`${label}.a zorunlu ve metin olmalı.`);
    }

    if (card.subject !== undefined && typeof card.subject !== "string") {
      errors.push(`${label}.subject metin olmalı.`);
    }
  });

  return extractedQuestions;
}

function validateJsonSet(content, filePath, errors) {
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    errors.push(`[${filePath}] JSON parse hatası: ${error.message}`);
    return [];
  }

  if (Array.isArray(parsed)) {
    return validateCardArray(parsed, filePath, errors, "cards");
  }

  if (!parsed || typeof parsed !== "object") {
    errors.push(`[${filePath}] JSON kök nesnesi object veya array olmalı.`);
    return [];
  }

  if (parsed.setName !== undefined && typeof parsed.setName !== "string") {
    errors.push(`[${filePath}] setName metin olmalı.`);
  }

  if (Array.isArray(parsed.questions)) {
    return validateMcqJson(parsed, filePath, errors);
  }

  if (Array.isArray(parsed.cards)) {
    return validateCardArray(parsed.cards, filePath, errors, "cards");
  }

  errors.push(
    `[${filePath}] Tanınmayan şema. 'questions' veya 'cards' dizisi bekleniyor.`,
  );
  return [];
}

function validateMarkdownSet(content, filePath, errors) {
  const questions = parseMarkdownQuestions(content);
  if (questions.length === 0) {
    errors.push(
      `[${filePath}] Markdown set içinde soru bulunamadı (###, Soru:, Soru N:).`,
    );
  }
  return questions;
}

function formatOccurrence(entry) {
  return `${entry.file} [${entry.source} #${entry.index + 1}]`;
}

function main() {
  let cliConfig;
  try {
    cliConfig = parseCliArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`❌ ${error.message}`);
    process.exit(1);
  }

  let files = [];
  try {
    const allowMissingPaths =
      !cliConfig.requireFiles && cliConfig.usedDefaultTarget
        ? new Set([path.resolve("data")])
        : new Set();
    files = collectSetFiles(cliConfig.inputTargets, { allowMissingPaths });
  } catch (error) {
    console.error(`❌ ${error.message}`);
    process.exit(1);
  }

  if (files.length === 0) {
    if (cliConfig.requireFiles) {
      console.error("❌ Doğrulanacak .json/.md set dosyası bulunamadı.");
      process.exit(1);
    }
    console.log("⚠️ Doğrulanacak .json/.md set dosyası bulunamadı.");
    process.exit(0);
  }

  const errors = [];
  const questionIndex = new Map();
  let totalQuestionCount = 0;

  for (const filePath of files) {
    const extension = path.extname(filePath).toLowerCase();
    const content = fs.readFileSync(filePath, "utf8");

    const questions =
      extension === ".json"
        ? validateJsonSet(content, filePath, errors)
        : validateMarkdownSet(content, filePath, errors);

    questions.forEach((questionText, index) => {
      const normalized = normalizeQuestionText(questionText);
      if (!normalized) {
        errors.push(`[${filePath}] Soru metni normalize sonrası boş kaldı (#${index + 1}).`);
        return;
      }

      const hash = questionHash(normalized);
      const occurrences = questionIndex.get(hash) || [];
      occurrences.push({
        file: filePath,
        source: extension === ".json" ? "json" : "md",
        index,
        text: questionText.trim(),
      });
      questionIndex.set(hash, occurrences);
      totalQuestionCount += 1;
    });
  }

  const duplicateGroups = [];
  for (const [hash, occurrences] of questionIndex.entries()) {
    if (occurrences.length > 1) {
      duplicateGroups.push({ hash, occurrences });
    }
  }

  if (errors.length > 0) {
    console.error("❌ Şema doğrulama hataları:");
    errors.forEach((error) => console.error(`- ${error}`));
  }

  if (duplicateGroups.length > 0) {
    console.error("❌ Duplicate soru tespit edildi:");
    duplicateGroups.forEach((group, idx) => {
      console.error(`- Grup ${idx + 1} (${group.hash.slice(0, 12)}...):`);
      group.occurrences.forEach((occurrence) => {
        console.error(`  • ${formatOccurrence(occurrence)} => "${occurrence.text}"`);
      });
    });
  }

  if (errors.length > 0 || duplicateGroups.length > 0) {
    process.exit(1);
  }

  console.log(
    `✅ Doğrulama başarılı. Dosya: ${files.length}, soru: ${totalQuestionCount}, duplicate: 0`,
  );
}

main();
