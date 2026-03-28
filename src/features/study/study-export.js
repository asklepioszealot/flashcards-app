import { sanitizeHtml } from '../../core/security.js';
import { getAssessmentLevel } from './assessment.js';

export function generateAnkiGuid(setId, cardId) {
  const str = `${setId}_${cardId}`;
  let hash = 2166136261;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return hash >>> 0;
}

export function generateExportSnapshot(cards, scope = 'all') {
  return cards.map((card, index) => {
    const questionText = card.q ? card.q.replace(/<[^>]*>?/gm, '') : '';
    const uniqueId = card.__cardKey || String(index);
    const setId = card.__setId || 'unknown-set';
    
    return {
      setId: setId,
      cardId: uniqueId,
      ankiGuid: generateAnkiGuid(setId, uniqueId),
      subject: card.subject || '',
      questionText: questionText,
      questionHtml: sanitizeHtml(card.q || ''),
      answerHtml: sanitizeHtml(card.a || ''),
      answerMarkdown: card.a || '',
      assessmentStatus: getAssessmentLevel(card) || 'unanswered'
    };
  });
}

export async function generateApkg(cards) {
  const snapshots = generateExportSnapshot(cards, 'all');
  
  let initSqlJs;
  let fflate;
  try {
    const sqlJsModule = await import('../../../vendor/sql-wasm.js' + (window.__BUILD_INFO__ ? '' : '')); 
    initSqlJs = sqlJsModule.default || window.initSqlJs;
    fflate = await import('../../../vendor/fflate.js');
  } catch (error) {
    console.error("Export dependencies loading error:", error);
    throw new Error('Export bağımlılıkları yüklenemedi. Lütfen internet bağlantınızı kontrol edin veya uygulamayı güncelleyin.');
  }

  if (!initSqlJs || !fflate) {
    throw new Error('Bağımlılıklar başlatılamadı.');
  }

  const wasmUrl = new URL('../../../vendor/sql-wasm.wasm', window.location.href).href;

  const SQL = await initSqlJs({
    locateFile: () => wasmUrl
  });

  const db = new SQL.Database();
  
  db.run(`
    CREATE TABLE col (
      id integer primary key, crt integer not null, mod integer not null, scm integer not null, ver integer not null,
      dty integer not null, usn integer not null, ls integer not null, conf text not null, models text not null, decks text not null,
      dconf text not null, tags text not null
    );
    CREATE TABLE notes (
      id integer primary key, guid text not null, mid integer not null, mod integer not null, usn integer not null, tags text not null,
      flds text not null, sfld integer not null, csum integer not null, flags integer not null, data text not null
    );
    CREATE TABLE cards (
      id integer primary key, nid integer not null, did integer not null, ord integer not null, mod integer not null, usn integer not null,
      type integer not null, queue integer not null, due integer not null, ivl integer not null, factor integer not null, reps integer not null,
      lapses integer not null, left integer not null, odue integer not null, odid integer not null, flags integer not null, data text not null
    );
    CREATE TABLE revlog (
      id integer primary key, cid integer not null, usn integer not null, ease integer not null, ivl integer not null, lastIvl integer not null,
      factor integer not null, time integer not null, type integer not null
    );
  `);

  const nowMs = Date.now();
  const todayUnix = Math.floor(nowMs / 1000);
  const deckId = todayUnix;
  let nextModelId = todayUnix + 1;

  const models = {
    [nextModelId]: {
      id: nextModelId,
      name: "Basic (Flashcards App)",
      type: 0,
      mod: todayUnix,
      usn: -1,
      sortf: 0,
      did: deckId,
      tmpls: [
        {
          name: "Card 1",
          ord: 0,
          qfmt: "{{Front}}",
          afmt: "{{FrontSide}}\\n\\n<hr id=answer>\\n\\n{{Back}}",
          bqfmt: "",
          bafmt: "",
          did: null
        }
      ],
      flds: [
        { name: "Front", ord: 0, sticky: false, rtl: false, font: "Arial", size: 20 },
        { name: "Back", ord: 1, sticky: false, rtl: false, font: "Arial", size: 20 }
      ],
      css: ".card { font-family: arial; font-size: 20px; text-align: center; color: black; background-color: white; }",
      req: [[0, "any", [0]]]
    }
  };

  const rootDeckName = `Flashcards Export ${new Date().toISOString().split('T')[0]}`;
  const decks = {
    "1": { id: 1, mod: todayUnix, name: "Default", usn: -1, collapsed: false, browserCollapsed: false, desc: "", dyn: 0, conf: 1, extendNew: 10, extendRev: 50 },
    [deckId]: { id: deckId, mod: todayUnix, name: rootDeckName, usn: -1, collapsed: false, browserCollapsed: false, desc: "", dyn: 0, conf: 1, extendNew: 10, extendRev: 50 }
  };

  let nextDeckId = deckId + 1;
  const subjectDeckIds = {};
  
  const uniqueSubjects = [...new Set(snapshots.map(s => s.subject).filter(Boolean))];
  uniqueSubjects.forEach(subject => {
     const subDeckId = nextDeckId++;
     decks[subDeckId] = {
       id: subDeckId, mod: todayUnix, name: `${rootDeckName}::${subject}`, usn: -1, collapsed: false, browserCollapsed: false, desc: "", dyn: 0, conf: 1, extendNew: 10, extendRev: 50
     };
     subjectDeckIds[subject] = subDeckId;
  });

  const conf = { 1: { id: 1, mod: todayUnix, name: "Default", usn: -1, maxTaken: 60, autoplay: true, timer: 0, replayq: true, new: { delays: [1, 10], ints: [1, 4, 7], initialFactor: 2500, separate: true, order: 1, perDay: 20, bury: false }, rev: { perDay: 200, ease4: 1.3, ivlFct: 1, maxIvl: 36500, bury: false, minSpace: 1 }, lapse: { delays: [10], mult: 0, minInt: 1, leeches: [8, 0] }, dyn: false } };
  
  db.run(`INSERT INTO col (id, crt, mod, scm, ver, dty, usn, ls, conf, models, decks, dconf, tags) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
    1, todayUnix, todayUnix, todayUnix, 11, 0, 0, 0, JSON.stringify(conf), JSON.stringify(models), JSON.stringify(decks), "{}", "{}"
  ]);

  let noteId = todayUnix * 1000;
  let cardIdCounter = todayUnix * 1000;

  const insertNote = db.prepare(`INSERT INTO notes (id, guid, mid, mod, usn, tags, flds, sfld, csum, flags, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const insertCard = db.prepare(`INSERT INTO cards (id, nid, did, ord, mod, usn, type, queue, due, ivl, factor, reps, lapses, left, odue, odid, flags, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

  snapshots.forEach(snap => {
     const nId = noteId++;
     const cId = cardIdCounter++;
     const targetDeckId = snap.subject && subjectDeckIds[snap.subject] ? subjectDeckIds[snap.subject] : deckId;
     
     const tags = ` status_${snap.assessmentStatus} `;
     const fields = `${snap.questionHtml}\x1f${snap.answerHtml}`;
     
     insertNote.run([nId, snap.ankiGuid.toString(), nextModelId, todayUnix, -1, tags, fields, 0, 0, 0, ""]);
     insertCard.run([cId, nId, targetDeckId, 0, todayUnix, -1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, ""]);
  });

  insertNote.free();
  insertCard.free();

  const sqliteBytes = db.export();
  db.close();

  const zipData = {
    'collection.anki2': sqliteBytes,
    'media': new TextEncoder().encode('{}')
  };

  const zippedBytes = fflate.zipSync(zipData, { level: 0 });
  
  return new Blob([zippedBytes], { type: 'application/apkg' });
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 100);
}

export function generateCsv(cards) {
  const snapshots = generateExportSnapshot(cards, 'all');
  const escapeCsv = (str) => typeof str === 'string' ? `"${str.replace(/"/g, '""')}"` : str;
  let csv = 'Soru,Cevap,Etiket,Konu\n';
  snapshots.forEach(s => {
    csv += `${escapeCsv(s.questionText)},${escapeCsv(s.answerMarkdown)},${escapeCsv(s.assessmentStatus)},${escapeCsv(s.subject)}\n`;
  });
  return new Blob([new Uint8Array([0xEF, 0xBB, 0xBF]), csv], { type: 'text/csv;charset=utf-8;' });
}

export function generateMarkdown(cards) {
  const snapshots = generateExportSnapshot(cards, 'all');
  let md = '# Flashcards Dışa Aktarım\n\n';
  snapshots.forEach((s, idx) => {
    md += `## ${idx + 1}. ${s.subject || 'Soru'}\n`;
    md += `* **Durum:** ${s.assessmentStatus}\n\n`;
    md += `### Soru\n${s.questionText}\n\n`;
    md += `### Cevap\n${s.answerMarkdown}\n\n---\n\n`;
  });
  return new Blob([md], { type: 'text/markdown;charset=utf-8;' });
}

export function generateHtml(cards) {
  const snapshots = generateExportSnapshot(cards, 'all');
  let html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Flashcards Export</title>
  <style>body{font-family:sans-serif;max-width:800px;margin:0 auto;padding:20px;line-height:1.6} 
  .card{border:1px solid #ddd;padding:20px;margin-bottom:20px;border-radius:8px;} 
  h2{margin-top:0;color:#333}</style></head><body><h1>Flashcards</h1>`;
  snapshots.forEach((s, idx) => {
    html += `<div class="card"><h2>${idx + 1}. ${s.subject || 'Kart'} (${s.assessmentStatus})</h2>
      <div style="font-weight:bold;margin-bottom:10px">${s.questionHtml}</div>
      <div>${s.answerHtml}</div></div>`;
  });
  html += '</body></html>';
  return new Blob([html], { type: 'text/html;charset=utf-8;' });
}
