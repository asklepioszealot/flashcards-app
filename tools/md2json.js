const fs = require('fs');
const path = require('path');

const inputPath = process.argv[2];
if (!inputPath) {
  console.error("Kullanım: node tools/md2json.js <girdi.md> [cikti.json]");
  process.exit(1);
}

const outputPath = process.argv[3] || inputPath.replace(/\.md$/, '.json');

try {
  const content = fs.readFileSync(inputPath, 'utf8');
  const lines = content.split(/\r?\n/);
  
  let setName = "";
  let currentSubject = "";
  const cards = [];
  
  let currentCard = null;
  let freeAnswerLines = [];
  let explanationLines = [];
  let awaitingQuestionText = false;
  let collectingExplanation = false;

  function processFormatting(text) {
    return text
      .replace(/==([^=]+)==/g, "<strong class='highlight-critical'>$1</strong>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/^(?:> )?⚠️(.*)$/gm, "<span class='highlight-important'>⚠️$1</span>");
  }

  function finalizeCurrentCard() {
    if (!currentCard) return;

    const freeAnswer = freeAnswerLines.join('\n').trim();
    const explanation = explanationLines.join('\n').trim();

    let answerRaw = "";
    if (currentCard.correctChar || currentCard.options.length > 0 || explanation) {
      const parts = [];

      if (currentCard.correctChar) {
        const idx = currentCard.correctChar.charCodeAt(0) - 65;
        const correctOption = idx >= 0 && idx < currentCard.options.length
          ? currentCard.options[idx]
          : "";
        const correctLine = correctOption
          ? `Doğru Cevap: ${currentCard.correctChar}) ${correctOption}`
          : `Doğru Cevap: ${currentCard.correctChar}`;
        parts.push(`**${correctLine}**`);
      }

      if (explanation) {
        parts.push(explanation);
      }

      answerRaw = parts.join("\n\n").trim();
      if (!answerRaw && freeAnswer) {
        answerRaw = freeAnswer;
      }
    } else {
      answerRaw = freeAnswer;
    }

    if (!answerRaw) {
      answerRaw = "Açıklama bulunamadı.";
    }

    let answerHtml = processFormatting(answerRaw);
    answerHtml = answerHtml.replace(/\n\s*\n/g, "<br><br>\n");

    cards.push({
      q: (currentCard.q || "").trim(),
      a: answerHtml,
      subject: currentCard.subject || currentSubject || setName || "Genel",
    });

    currentCard = null;
    freeAnswerLines = [];
    explanationLines = [];
    awaitingQuestionText = false;
    collectingExplanation = false;
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    const normalized = trimmed.replace(/^\*\*(.*?)\*\*$/, '$1').trim();

    // Ignore markdown horizontal rules
    if (/^[-*_]{3,}$/.test(trimmed)) continue;

    const h1Match = normalized.match(/^#\s+(.+)$/);
    if (h1Match) {
      if (!setName) setName = h1Match[1].trim();
      continue;
    }

    // Subject (##)
    const h2Match = line.match(/^##\s+(.+)$/);
    if (h2Match) {
      finalizeCurrentCard();
      const title = h2Match[1].trim();
      currentSubject = title;
      if (!setName) setName = title;
      continue;
    }

    const konuMatch = normalized.match(/^#{0,3}\s*Konu:\s*(.+)$/i);
    if (konuMatch) {
      currentSubject = konuMatch[1].trim();
      if (!setName) setName = currentSubject;
      continue;
    }

    // Question (### / Soru:)
    const h3Match = line.match(/^###\s+(.+)$/);
    const soruInlineMatch = normalized.match(/^Soru:\s*(.+)$/i);
    const soruNumberedMatch = normalized.match(/^Soru\s+\d+[.)]?\s*(?::\s*(.*))?$/i);

    if (h3Match || soruInlineMatch || soruNumberedMatch) {
      finalizeCurrentCard();
      const qText = (
        h3Match
          ? h3Match[1]
          : soruInlineMatch
            ? soruInlineMatch[1]
            : soruNumberedMatch[1] || ""
      ).trim();
      currentCard = {
        q: qText,
        a: "",
        subject: currentSubject || setName || "Genel",
        options: [],
        correctChar: "",
      };
      freeAnswerLines = [];
      explanationLines = [];
      collectingExplanation = false;
      awaitingQuestionText = qText.length === 0;
      continue;
    }

    if (awaitingQuestionText && currentCard && normalized) {
      currentCard.q = normalized;
      awaitingQuestionText = false;
      continue;
    }

    const optionMatch = normalized.match(/^([A-Ea-e])[).]\s+(.+)$/);
    if (optionMatch && currentCard && !collectingExplanation) {
      currentCard.options.push(optionMatch[2].trim());
      continue;
    }

    const correctMatch = normalized.match(/^Doğru\s*Cevap:\s*([A-Ea-e])\b/i);
    if (correctMatch && currentCard) {
      currentCard.correctChar = correctMatch[1].toUpperCase();
      continue;
    }

    const explanationStartMatch = normalized.match(/^Açıklama:\s*(.*)$/i);
    if (explanationStartMatch && currentCard) {
      collectingExplanation = true;
      explanationLines.push(explanationStartMatch[1]);
      continue;
    }

    const blockquoteMatch = line.match(/^>\s?(.*)$/);
    if (blockquoteMatch && currentCard && (currentCard.correctChar || currentCard.options.length > 0 || collectingExplanation)) {
      collectingExplanation = true;
      explanationLines.push(blockquoteMatch[1]);
      continue;
    }

    if (currentCard) {
      if (collectingExplanation) {
        explanationLines.push(line);
      } else {
        freeAnswerLines.push(line);
      }
    }
  }
  
  finalizeCurrentCard();
  
  const result = {
    setName: setName || path.basename(inputPath, '.md'),
    cards
  };
  
  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2), 'utf8');
  console.log(`✅ Dönüştürme başarılı: ${outputPath} (${cards.length} kart)`);
  
} catch (e) {
  console.error("Hata oluştu:", e);
}
