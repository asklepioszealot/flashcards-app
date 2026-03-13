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
  let answerLines = [];

  function finalizeCurrentCard() {
    if (currentCard) {
      let answerHtml = answerLines.join('\n').trim();
      
      // ==metin== -> <strong class='highlight-critical'>metin</strong>
      answerHtml = answerHtml.replace(/==([^=]+)==/g, "<strong class='highlight-critical'>$1</strong>");
      
      // **metin** -> <strong>metin</strong>
      answerHtml = answerHtml.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
      
      // > ⚠️ metin -> <span class='highlight-important'>⚠️ metin</span>
      answerHtml = answerHtml.replace(/^(?:> )?⚠️(.*)$/gm, "<span class='highlight-important'>⚠️$1</span>");
      
      // Empty lines -> <br><br>
      answerHtml = answerHtml.replace(/\n\s*\n/g, "<br><br>\n");
      
      currentCard.a = answerHtml;
      cards.push(currentCard);
      
      currentCard = null;
      answerLines = [];
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // Ignore markdown horizontal rules
    if (line.trim() === '---') continue;
    
    // Subject (##)
    const h2Match = line.match(/^##\s+(.+)$/);
    if (h2Match) {
      finalizeCurrentCard();
      const title = h2Match[1].trim();
      currentSubject = title;
      if (!setName) setName = title;
      continue;
    }
    
    // Question (###)
    const h3Match = line.match(/^###\s+(.+)$/);
    if (h3Match) {
      finalizeCurrentCard();
      currentCard = {
        q: h3Match[1].trim(),
        a: "",
        subject: currentSubject || setName || "Genel"
      };
      continue;
    }
    
    // Answer text
    if (currentCard) {
      answerLines.push(line);
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
