      // ═══ STATE ═══
      const SESSION_KEY = "fc_session";
      const SETS_KEY = "fc_loaded_sets";
      const ASSESSMENTS_KEY = "fc_assessments";
      const storage = window.AppStorage;
      
      let loadedSets = {};
      let selectedSets = new Set();
      let removeCandidateSets = new Set();
      let deleteMode = false;
      let lastRemovedSets = [];
      let undoTimeoutId = null;
      
      let currentCardIndex = 0;
      let isFlipped = false;
      let allFlashcards = [];
      let filteredFlashcards = [];
      let cardOrder = [];
      let assessments = {}; // key: card question hash → 'know' | 'review' | 'dunno'
      let activeFilter = "all"; // 'all' | 'review' | 'dunno' | 'unanswered'

      // ═══ CARD ID HELPER ═══
      function cardId(card) {
        // simple hash from question text
        let h = 0;
        for (let i = 0; i < card.q.length; i++) {
          h = ((h << 5) - h + card.q.charCodeAt(i)) | 0;
        }
        return "c" + Math.abs(h);
      }

      // ═══ SET MANAGEMENT ═══
      function showSetManager() {
        document.getElementById("set-manager").classList.remove("hidden");
        document.getElementById("app-container").style.display = "none";
        renderSetList();
      }

      function startStudy() {
        if (selectedSets.size === 0) return;
        
        allFlashcards = [];
        for (const setId of selectedSets) {
          if (loadedSets[setId]) {
            allFlashcards.push(...loadedSets[setId].cards);
          }
        }
        
        filteredFlashcards = [...allFlashcards];
        cardOrder = [...Array(filteredFlashcards.length).keys()];
        currentCardIndex = 0;
        
        document.getElementById("set-manager").classList.add("hidden");
        document.getElementById("app-container").style.display = "block";
        
        populateTopicFilter();
        
        const sessRaw = storage.getItem(SESSION_KEY);
        if (sessRaw) {
          const session = JSON.parse(sessRaw);
          if (session.topic) document.getElementById("topic-select").value = session.topic;
          if (typeof session.currentCardIndex === "number" && session.currentCardIndex < filteredFlashcards.length) {
            currentCardIndex = session.currentCardIndex;
          }
        }
        
        filterByTopic(false);
      }

      function parseMarkdownToFlashcards(content, fileName) {
        const lines = content.split(/\r?\n/);
        const fileStem = (fileName || "set").replace(/\.[^/.]+$/, "");

        let setName = "";
        let canonicalSubject = fileStem;
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

          const freeAnswer = freeAnswerLines.join("\n").trim();
          const explanation = explanationLines.join("\n").trim();

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

          currentCard.a = answerHtml;
          cards.push({
            q: (currentCard.q || "").trim(),
            a: currentCard.a,
            subject: currentCard.subject || canonicalSubject,
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
          const normalized = trimmed.replace(/^\*\*(.*?)\*\*$/, "$1").trim();

          if (/^[-*_]{3,}$/.test(trimmed)) continue;

          const h1Match = normalized.match(/^#\s+(.+)$/);
          if (h1Match) {
            const h1Title = h1Match[1].trim();
            if (!setName) setName = h1Title;
            if (canonicalSubject === fileStem) canonicalSubject = h1Title;
            continue;
          }

          const h2Match = line.match(/^##\s+(.+)$/);
          if (h2Match) {
            finalizeCurrentCard();
            continue;
          }

          const konuMatch = normalized.match(/^#{0,3}\s*Konu:\s*(.+)$/i);
          if (konuMatch) {
            continue;
          }

          const h3Match = line.match(/^###\s+(.+)$/);
          const soruInlineMatch = normalized.match(/^Soru:\s*(.+)$/i);
          const soruNumberedMatch = normalized.match(
            /^Soru\s+\d+[.)]?\s*(?::\s*(.*))?$/i,
          );

          const isQuestionStart = h3Match || soruInlineMatch || soruNumberedMatch;
          if (isQuestionStart) {
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
              subject: canonicalSubject,
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

          const correctMatch = normalized.match(/^Do(?:ğ|g)ru\s*Cevap:\s*([A-Ea-e])\b/i);
          if (correctMatch && currentCard) {
            currentCard.correctChar = correctMatch[1].toUpperCase();
            continue;
          }

          const explanationStartMatch = normalized.match(/^(?:Açıklama|Aciklama):\s*(.*)$/i);
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

        return {
          setName: setName || fileStem,
          cards
        };
      }

      async function handleFileSelect(event) {
        const files = event.target.files;
        if (!files.length) return;

        for (const file of files) {
          try {
            const text = await file.text();
            let data;

            if (file.name.endsWith('.md') || file.name.endsWith('.txt')) {
                data = parseMarkdownToFlashcards(text, file.name);
            } else {
                // JSON'daki sondaki virgülleri (trailing commas) temizle
                const cleanText = text.replace(/,\s*([\]}])/g, "$1");
                data = JSON.parse(cleanText);
            }

            const setId = file.name.replace(/\.[^/.]+$/, "");

            loadedSets[setId] = {
              setName: data.setName || setId,
              cards: data.cards || [],
              fileName: file.name
            };
            selectedSets.add(setId);

            storage.setItem("fc_set_" + setId, JSON.stringify(loadedSets[setId]));
          } catch (e) {
            alert(file.name + " yüklenirken hata oluştu. Geçerli bir JSON dosyası seçtiğinizden emin olun.");
          }
        }
        saveSetsList();
        renderSetList();
        event.target.value = ""; // reset
      }

      function toggleSetCheck(setId) {
        if (deleteMode) {
          if (removeCandidateSets.has(setId)) {
            removeCandidateSets.delete(setId);
          } else {
            removeCandidateSets.add(setId);
          }
          renderSetList();
          return;
        }
        toggleSetSelection(setId);
      }

      function toggleSetSelection(setId) {
        if (selectedSets.has(setId)) {
          selectedSets.delete(setId);
        } else {
          selectedSets.add(setId);
        }
        saveSetsList();
        renderSetList();
      }

      function deleteSet(setId) {
        removeSets([setId]);
      }

      function removeSets(idsToRemove) {
        const removed = [];
        idsToRemove.forEach((setId) => {
          if (!loadedSets[setId]) return;
          removed.push({
            setId: setId,
            setData: loadedSets[setId],
            wasSelected: selectedSets.has(setId),
          });
          delete loadedSets[setId];
          selectedSets.delete(setId);
          removeCandidateSets.delete(setId);
          storage.removeItem("fc_set_" + setId);
        });

        if (removed.length === 0) return;
        lastRemovedSets = removed;
        showUndoToast(
          removed.length === 1
            ? "Set kaldırıldı."
            : `${removed.length} set kaldırıldı.`,
        );
        saveSetsList();
        renderSetList();
      }

      function selectAllSets() {
        if (deleteMode) {
          removeCandidateSets = new Set(Object.keys(loadedSets));
          renderSetList();
          return;
        }
        selectedSets = new Set(Object.keys(loadedSets));
        saveSetsList();
        renderSetList();
      }

      function clearSetSelection() {
        if (deleteMode) {
          removeCandidateSets.clear();
          renderSetList();
          return;
        }
        selectedSets.clear();
        saveSetsList();
        renderSetList();
      }

      function removeSelectedSets() {
        if (!deleteMode || removeCandidateSets.size === 0) return;
        removeSets([...removeCandidateSets]);
      }

      function toggleDeleteMode() {
        deleteMode = !deleteMode;
        if (!deleteMode) {
          removeCandidateSets.clear();
        }
        renderSetList();
      }

      function showUndoToast(message) {
        const toast = document.getElementById("undo-toast");
        const msgEl = document.getElementById("undo-message");
        if (!toast || !msgEl) return;
        msgEl.textContent = message;
        toast.style.display = "flex";
        if (undoTimeoutId) {
          clearTimeout(undoTimeoutId);
        }
        undoTimeoutId = setTimeout(() => {
          toast.style.display = "none";
          lastRemovedSets = [];
        }, 7000);
      }

      function undoLastRemoval() {
        if (!lastRemovedSets || lastRemovedSets.length === 0) return;
        lastRemovedSets.forEach((entry) => {
          loadedSets[entry.setId] = entry.setData;
          storage.setItem("fc_set_" + entry.setId, JSON.stringify(entry.setData));
          if (entry.wasSelected) {
            selectedSets.add(entry.setId);
          }
        });
        const toast = document.getElementById("undo-toast");
        if (toast) toast.style.display = "none";
        if (undoTimeoutId) {
          clearTimeout(undoTimeoutId);
          undoTimeoutId = null;
        }
        removeCandidateSets.clear();
        lastRemovedSets = [];
        saveSetsList();
        renderSetList();
      }

      function saveSetsList() {
        storage.setItem(SETS_KEY, JSON.stringify(Object.keys(loadedSets)));
        const selectedArr = Array.from(selectedSets);
        storage.setItem("fc_selected_sets", JSON.stringify(selectedArr));
      }

      function renderSetList() {
        const listEl = document.getElementById("set-list");
        const setIds = Object.keys(loadedSets);
        const setToolsEl = document.getElementById("set-list-tools");
        const startBtn = document.getElementById("start-btn");
        const removeSelectedBtn = document.getElementById("remove-selected-btn");
        const deleteModeBtn = document.getElementById("delete-mode-btn");
        const selectAllBtn = document.getElementById("select-all-btn");
        const clearSelectionBtn = document.getElementById("clear-selection-btn");
        const modeHint = document.getElementById("mode-hint");

        if (setIds.length === 0) {
          listEl.innerHTML = '<div class="set-item empty">Henüz set yüklenmedi.</div>';
          if (setToolsEl) setToolsEl.style.display = "none";
          if (startBtn) startBtn.disabled = true;
          if (removeSelectedBtn) removeSelectedBtn.disabled = true;
          return;
        }

        if (setToolsEl) setToolsEl.style.display = "flex";
        if (startBtn) startBtn.disabled = selectedSets.size === 0;

        if (deleteModeBtn) {
          deleteModeBtn.textContent = deleteMode ? "Silme Modu: Açık" : "Silme Modu: Kapalı";
          deleteModeBtn.className = deleteMode
            ? "btn btn-small btn-danger"
            : "btn btn-small btn-secondary";
        }
        if (selectAllBtn) {
          selectAllBtn.textContent = deleteMode
            ? "Silineceklerin Tümünü Seç"
            : "Tümünü Derse Dahil Et";
        }
        if (clearSelectionBtn) {
          clearSelectionBtn.textContent = deleteMode
            ? "Silme Seçimini Temizle"
            : "Ders Seçimini Temizle";
        }
        if (modeHint) {
          modeHint.textContent = deleteMode
            ? "Mod: Sileceğin setleri işaretliyorsun."
            : "Mod: Derse dahil edilecek setleri seçiyorsun.";
        }
        if (removeSelectedBtn) {
          removeSelectedBtn.disabled = !deleteMode || removeCandidateSets.size === 0;
          removeSelectedBtn.textContent = `Seçilileri Kaldır (${removeCandidateSets.size})`;
        }

        listEl.innerHTML = "";
        setIds.forEach(setId => {
          const set = loadedSets[setId];
          let know = 0, total = set.cards.length;
          set.cards.forEach(c => {
            if (assessments[cardId(c)] === 'know') know++;
          });

          const isSelected = deleteMode
            ? removeCandidateSets.has(setId)
            : selectedSets.has(setId);

          const div = document.createElement("div");
          div.className = "set-item";
          div.innerHTML = `
            <div class="set-info" onclick="toggleSetCheck('${setId}')">
              <input type="checkbox" ${isSelected ? "checked" : ""} onclick="event.stopPropagation(); toggleSetCheck('${setId}')">
              <div class="set-details">
                <div class="set-title">${set.setName}</div>
                <div class="set-stats">${total} kart — ${know}/${total} (%${total?Math.round((know/total)*100):0}) tamam</div>
              </div>
            </div>
            <div class="set-actions-row">
              <button class="btn-delete-circle" title="Seti kaldır" onclick="deleteSet('${setId}')">-</button>
            </div>
          `;
          listEl.appendChild(div);
        });
      }

      // ═══ LOCAL STORAGE ═══
      function saveState() {
        storage.setItem(ASSESSMENTS_KEY, JSON.stringify(assessments));
        
        const session = {
          currentCardIndex,
          theme: document.getElementById("theme-toggle").checked ? "dark" : "light",
          topic: document.getElementById("topic-select").value,
          activeFilter
        };
        storage.setItem(SESSION_KEY, JSON.stringify(session));
      }

      function loadState() {
        try {
          // Backward compatibility migration from legacy state
          const legacyStateRaw = storage.getItem("flashcards_state_v6");
          if (legacyStateRaw) {
            const legacyState = JSON.parse(legacyStateRaw);
            if (legacyState.assessments && Object.keys(assessments).length === 0) {
              assessments = legacyState.assessments;
              storage.setItem(ASSESSMENTS_KEY, JSON.stringify(assessments));
            }
          }

          const assRaw = storage.getItem(ASSESSMENTS_KEY);
          if (assRaw) assessments = JSON.parse(assRaw);

          const setsRaw = storage.getItem(SETS_KEY);
          if (setsRaw) {
            const setIds = JSON.parse(setsRaw);
            setIds.forEach(id => {
              const setRaw = storage.getItem("fc_set_" + id);
              if (setRaw) {
                loadedSets[id] = JSON.parse(setRaw);
              }
            });
          }
          
          const selRaw = storage.getItem("fc_selected_sets");
          if (selRaw) {
            const selIds = JSON.parse(selRaw);
            selIds.forEach(id => { if (loadedSets[id]) selectedSets.add(id); });
          } else {
            // default all to selected
            Object.keys(loadedSets).forEach(id => selectedSets.add(id));
          }

          const sessRaw = storage.getItem(SESSION_KEY);
          if (sessRaw) {
            const session = JSON.parse(sessRaw);
            if (session.theme === "dark") {
              window.ThemeManager.setThemeState(true, {
                primaryToggleId: "theme-toggle",
                managerToggleId: "theme-toggle-manager",
              });
            }
            if (session.activeFilter) activeFilter = session.activeFilter;
          }
        } catch (e) {
          console.error("State loading error:", e);
        }
      }

      // ═══ ASSESSMENT ═══
      function assessCard(level) {
        if (filteredFlashcards.length === 0) return;
        const card = filteredFlashcards[cardOrder[currentCardIndex]];
        const id = cardId(card);
        assessments[id] = level;
        updateAssessmentButtons(level);
        updateScoreDisplay();
        saveState();
        // auto-advance after a short delay
        setTimeout(() => {
          if (currentCardIndex < filteredFlashcards.length - 1) {
            nextCard();
          }
        }, 400);
      }

      function updateAssessmentButtons(level) {
        document
          .querySelectorAll(".assess-btn")
          .forEach((btn) => btn.classList.remove("selected"));
        if (level) {
          const btn = document.querySelector(`.assess-btn.${level}`);
          if (btn) btn.classList.add("selected");
        }
      }

      function showAssessmentPanel(show) {
        const panel = document.getElementById("assessment-panel");
        if (show) {
          panel.classList.add("visible");
        } else {
          panel.classList.remove("visible");
        }
      }

      // ═══ SCORE DISPLAY ═══
      function updateScoreDisplay() {
        let know = 0,
          review = 0,
          dunno = 0;
        allFlashcards.forEach((c) => {
          const status = assessments[cardId(c)];
          if (status === "know") know++;
          else if (status === "review") review++;
          else if (status === "dunno") dunno++;
        });
        const total = allFlashcards.length;
        const pct = total > 0 ? Math.round((know / total) * 100) : 0;
        document.getElementById("score-know").textContent = know;
        document.getElementById("score-review").textContent = review;
        document.getElementById("score-dunno").textContent = dunno;
        document.getElementById("score-percent").textContent =
          `${know}/${total} (%${pct})`;
        document.getElementById("progress-fill").style.width = `${pct}%`;
      }

      // ═══ FILTER ═══
      function setFilter(filter) {
        activeFilter = filter;
        applyAssessmentFilter();
        saveState();
      }

      function applyAssessmentFilter() {
        // update active button
        document
          .querySelectorAll(".filter-btn")
          .forEach((btn) => btn.classList.remove("active"));
        const labels = {
          all: "📋 Tümü",
          review: "🔄 Tekrar Göz At",
          dunno: "❌ Bilmiyorum",
          unanswered: "⬜ Değerlendirilmemiş",
        };
        document.querySelectorAll(".filter-btn").forEach((btn) => {
          if (btn.textContent.trim() === labels[activeFilter])
            btn.classList.add("active");
        });

        const selectedTopic = document.getElementById("topic-select").value;
        let base =
          selectedTopic === "hepsi"
            ? [...allFlashcards]
            : allFlashcards.filter((c) => c.subject === selectedTopic);

        if (activeFilter === "review") {
          filteredFlashcards = base.filter(
            (c) => assessments[cardId(c)] === "review",
          );
        } else if (activeFilter === "dunno") {
          filteredFlashcards = base.filter(
            (c) => assessments[cardId(c)] === "dunno",
          );
        } else if (activeFilter === "unanswered") {
          filteredFlashcards = base.filter((c) => !assessments[cardId(c)]);
        } else {
          filteredFlashcards = base;
        }

        cardOrder = [...Array(filteredFlashcards.length).keys()];
        currentCardIndex = 0;
        document
          .getElementById("jump-input")
          .setAttribute("max", filteredFlashcards.length);
        if (filteredFlashcards.length > 0) {
          displayCard();
        } else {
          document.getElementById("question-text").textContent =
            "Bu kategoride kart yok.";
          document.getElementById("answer-text").innerHTML = "";
          document.getElementById("card-counter").textContent = "0 / 0";
          document.getElementById("subject-display-front").textContent = "";
          showAssessmentPanel(false);
        }
        updateScoreDisplay();
      }

      function resetProgress() {
        if (!confirm("Tüm ilerlemeniz sıfırlanacak. Emin misiniz?")) return;
        assessments = {};
        activeFilter = "all";
        applyAssessmentFilter();
        updateScoreDisplay();
        saveState();
      }

      // ═══ TOPIC FILTER ═══
      function filterByTopic(resetFilter = true) {
        if (resetFilter) {
          activeFilter = "all";
        }
        applyAssessmentFilter();
      }

      // ═══ DISPLAY ═══
      function displayCard() {
        if (filteredFlashcards.length === 0) return;
        const card = filteredFlashcards[cardOrder[currentCardIndex]];
        document.getElementById("question-text").textContent = card.q;
        document.getElementById("answer-text").innerHTML = card.a;
        document.getElementById("card-counter").textContent =
          `${currentCardIndex + 1} / ${filteredFlashcards.length}`;
        document.getElementById("subject-display-front").textContent =
          card.subject;

        document.getElementById("prev-btn").disabled = currentCardIndex === 0;
        document.getElementById("next-btn").disabled =
          currentCardIndex === filteredFlashcards.length - 1;

        // reset flip
        if (isFlipped) {
          document.getElementById("flashcard").classList.remove("flipped");
          isFlipped = false;
        }
        // hide assessment panel when showing front
        showAssessmentPanel(false);
        // highlight current assessment if any
        const currentAssessment = assessments[cardId(card)];
        updateAssessmentButtons(currentAssessment || null);

        saveState();
      }

      // ═══ FLIP ═══
      function flipCard() {
        const card = document.getElementById("flashcard");
        card.classList.toggle("flipped");
        isFlipped = !isFlipped;
        showAssessmentPanel(isFlipped);
      }

      // ═══ NAVIGATION ═══
      function previousCard() {
        if (currentCardIndex > 0) {
          currentCardIndex--;
          displayCard();
        }
      }

      function nextCard() {
        if (currentCardIndex < filteredFlashcards.length - 1) {
          currentCardIndex++;
          displayCard();
        }
      }

      function jumpToCard() {
        const input = document.getElementById("jump-input");
        const cardNum = parseInt(input.value);
        if (cardNum >= 1 && cardNum <= filteredFlashcards.length) {
          currentCardIndex = cardNum - 1;
          displayCard();
          input.value = "";
        } else {
          alert(
            `Lütfen 1 ile ${filteredFlashcards.length} arasında bir sayı girin.`,
          );
        }
      }

      document
        .getElementById("jump-input")
        .addEventListener("keypress", function (e) {
          if (e.key === "Enter") jumpToCard();
        });

      // ═══ THEME ═══
      function toggleTheme(isChecked) {
        window.ThemeManager.toggleTheme({
          isChecked: isChecked,
          primaryToggleId: "theme-toggle",
          managerToggleId: "theme-toggle-manager",
          onAfterToggle: () => saveState(),
        });
      }

      // ═══ SHUFFLE ═══
      function shuffleCards() {
        if (filteredFlashcards.length === 0) return;
        for (let i = cardOrder.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [cardOrder[i], cardOrder[j]] = [cardOrder[j], cardOrder[i]];
        }
        currentCardIndex = 0;
        displayCard();
      }

      // ═══ PRINT ═══
      function printCards() {
        const statusIcons = { know: "✅", review: "🔄", dunno: "❌" };
        let cardsHtml = "";
        allFlashcards.forEach((card, i) => {
          const status = assessments[cardId(card)];
          const badge = status
            ? `<span style="float:right;font-size:18px">${statusIcons[status]}</span>`
            : "";
          cardsHtml += `
                <div style="page-break-inside:avoid; border:1px solid #ddd; border-radius:10px; padding:20px 24px; margin-bottom:16px;">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                        <span style="font-weight:700; color:#2f7a56; font-size:14px;">Kart ${i + 1} — ${card.subject}</span>
                        ${badge}
                    </div>
                    <div style="font-size:15px; font-weight:600; margin-bottom:12px; color:#21302a; white-space: pre-line;">${card.q}</div>
                    <div style="font-size:14px; line-height:1.7; color:#333; border-top:1px solid #eee; padding-top:12px; white-space: pre-line;">${card.a}</div>
                </div>`;
        });

        let know = 0,
          review = 0,
          dunno = 0;
        allFlashcards.forEach((c) => {
          const s = assessments[cardId(c)];
          if (s === "know") know++;
          else if (s === "review") review++;
          else if (s === "dunno") dunno++;
        });
        const total = allFlashcards.length;
        const pct = total > 0 ? Math.round((know / total) * 100) : 0;

        const html = `<!DOCTYPE html><html lang="tr"><head><meta charset="UTF-8">
            <title>Kan Transfüzyonu Flashcards — Yazdır</title>
            <style>
                body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width:800px; margin:0 auto; padding:30px 20px; color:#21302a; }
                h1 { font-size:22px; margin-bottom:4px; }
                .summary { font-size:14px; color:#5f6d66; margin-bottom:20px; padding-bottom:15px; border-bottom:2px solid #2f7a56; }
                @media print { body { padding:10px; } }
            </style></head><body>
            <h1>Kan Transfüzyonu — Flashcards</h1>
            <div class="summary">Toplam: ${total} kart &nbsp;|&nbsp; ✅ ${know} &nbsp; 🔄 ${review} &nbsp; ❌ ${dunno} &nbsp;|&nbsp; Tamamlanma: %${pct}</div>
            ${cardsHtml}
            </body></html>`;

        const w = window.open("", "_blank");
        w.document.write(html);
        w.document.close();
        w.onload = () => w.print();
      }

      // ═══ KEYBOARD ═══
      document.addEventListener("keydown", function (e) {
        // skip if typing in input
        if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT")
          return;
        if (e.key === "ArrowLeft") {
          previousCard();
        } else if (e.key === "ArrowRight") {
          nextCard();
        } else if (e.key === " ") {
          e.preventDefault();
          flipCard();
        } else if (e.key === "1" && isFlipped) {
          assessCard("know");
        } else if (e.key === "2" && isFlipped) {
          assessCard("review");
        } else if (e.key === "3" && isFlipped) {
          assessCard("dunno");
        } else if (e.key === "ArrowDown" && isFlipped) {
          e.preventDefault();
          document.querySelector(".card-back").scrollTop += 50;
        } else if (e.key === "ArrowUp" && isFlipped) {
          e.preventDefault();
          document.querySelector(".card-back").scrollTop -= 50;
        }
      });

      // ═══ INIT ═══
      function populateTopicFilter() {
        const select = document.getElementById("topic-select");
        const subjects = [...new Set(allFlashcards.map((c) => c.subject))];
        select.innerHTML = '<option value="hepsi">Tüm Başlıklar</option>';
        subjects.forEach((subject) => {
          const option = document.createElement("option");
          option.value = subject;
          option.textContent = subject;
          select.appendChild(option);
        });
      }

      // Initialization routine
      loadState();
      showSetManager();
