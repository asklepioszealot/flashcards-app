// src/features/editor/editor-save.js
// Editor save and export: draft persistence, conflict resolution, file writing.

import {
  editorState,
  loadedSets,
  platformAdapter,
} from "../../app/state.js";
import { nowIso } from "../../shared/utils.js";
import { backfillRawSource, normalizeSetRecord, slugify } from "../../core/set-codec.js";
import { isDesktopRuntime } from "../../core/runtime-config.js";
import {
  getCurrentEditorDraft,
  resolveEditorDraftRecord,
  createEditorDraft,
  resolveEditorConflictDraft,
} from "./editor-state.js";
import { persistCurrentEditorUiState } from "./editor-events.js";
import { renderEditor } from "./editor-render.js";
import { showEditorStatus } from "../auth/auth.js";
import { renderSetList } from "../set-manager/set-manager.js";
import { isBrowserRelinkableSourcePath, writeBrowserLinkedSourceFile, prepareBrowserSaveTargets } from "../set-manager/set-manager.js";
import { cleanupAssessmentsForSet } from "../study/assessment.js";
import { saveStudyState } from "../study-state/study-state.js";
import { formatEditorConflictTimestamp } from "./editor-render.js";

export async function saveEditorDrafts() {
  if (!editorState.draftOrder.length) return;
  try {
    persistCurrentEditorUiState(getCurrentEditorDraft());
    showEditorStatus("Değişiklikler kaydediliyor...");
    const savePlan = editorState.draftOrder.map((setId) => {
      const draft = editorState.drafts[setId];
      return {
        setId,
        draft,
        previousRecord: loadedSets[setId],
        nextRecord: {
          ...resolveEditorDraftRecord(draft),
          baseUpdatedAt: draft.baseUpdatedAt,
        },
      };
    });
    const browserLinkPreparation = await prepareBrowserSaveTargets(savePlan);
    if (!browserLinkPreparation.ready) {
      showEditorStatus("Kaydetme iptal edildi. Bağlı dosyayı seçmeden aynı dosyaya yazılamaz.", "error");
      return;
    }
    let sourceWriteCount = 0;
    let browserRelinkCount = 0;
    for (const planEntry of savePlan) {
      const { setId, draft, previousRecord, nextRecord } = planEntry;
      let savedRecord = null;

      try {
        savedRecord = await platformAdapter.saveSet(nextRecord);
      } catch (error) {
        if (error?.code !== "REMOTE_CONFLICT" || !error.remoteRecord) {
          throw error;
        }

        const remoteRecord = normalizeSetRecord(error.remoteRecord, { previousRecord: error.remoteRecord });
        remoteRecord.rawSource = backfillRawSource(remoteRecord);
        const shouldLoadRemote = confirm(
          `"${remoteRecord.setName}" setinin bulutta ${formatEditorConflictTimestamp(remoteRecord.updatedAt)} tarihinde kaydedilmiş daha yeni bir sürümü var.\n\nTamam: Buluttaki sürümü yükle\nİptal: Benim değişikliklerimle üzerine yaz`,
        );

        if (shouldLoadRemote) {
          resolveEditorConflictDraft(draft, remoteRecord);
          renderSetList();
          renderEditor();
          showEditorStatus("Buluttaki daha yeni sürüm yüklendi. İstersen bu sürüm üzerinde devam edebilirsin.", "success");
          return;
        }

        savedRecord = await platformAdapter.saveSet({
          ...nextRecord,
          baseUpdatedAt: null,
          forceOverwrite: true,
        });
      }

      cleanupAssessmentsForSet(savedRecord, previousRecord);
      if (savedRecord?.sourcePath) {
        if (
          isDesktopRuntime() &&
          typeof platformAdapter.writeSetSourceFile === "function"
        ) {
          await platformAdapter.writeSetSourceFile(savedRecord.sourcePath, savedRecord.rawSource);
          sourceWriteCount += 1;
        } else if (isBrowserRelinkableSourcePath(savedRecord.sourcePath)) {
          const browserWriteResult = await writeBrowserLinkedSourceFile(
            savedRecord.sourcePath,
            savedRecord.rawSource,
          );
          if (browserWriteResult.wrote) {
            sourceWriteCount += 1;
          } else if (browserWriteResult.relinkRequired) {
            browserRelinkCount += 1;
          }
        }
      }
      loadedSets[savedRecord.id] = savedRecord;
      const refreshedDraft = createEditorDraft(savedRecord, draft);
      refreshedDraft.viewMode = draft.viewMode;
      if (refreshedDraft.viewMode === "raw") refreshedDraft.rawSource = savedRecord.rawSource;
      editorState.drafts[setId] = refreshedDraft;
    }
    const { syncPersistedSetSourcePaths } = await import("../set-manager/set-manager.js");
    syncPersistedSetSourcePaths();
    saveStudyState();
    renderSetList();
    renderEditor();
    showEditorStatus(
      browserRelinkCount > 0
        ? "Değişiklikler kaydedildi. Dış dosyaya yeniden bağlanmak için dosyayı seçmelisin."
        : sourceWriteCount > 0
        ? "Değişiklikler kaydedildi ve bağlı yerel dosyalara yazıldı."
        : "Değişiklikler kaydedildi.",
      "success",
    );
  } catch (error) {
    console.error(error);
    showEditorStatus(error.message || "Kaydetme sırasında hata oluştu.", "error");
  }
}

export function exportActiveEditorDraft() {
  const draft = getCurrentEditorDraft();
  if (!draft) return;

  try {
    const nextRecord = resolveEditorDraftRecord(draft);
    const fileName =
      nextRecord.fileName ||
      `${slugify(nextRecord.setName)}.${nextRecord.sourceFormat === "markdown" ? "md" : "json"}`;
    const mimeType =
      nextRecord.sourceFormat === "markdown"
        ? "text/markdown;charset=utf-8"
        : "application/json;charset=utf-8";
    const downloadUrl = URL.createObjectURL(new Blob([nextRecord.rawSource], { type: mimeType }));
    const link = document.createElement("a");
    link.href = downloadUrl;
    link.download = fileName;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(downloadUrl), 0);
    showEditorStatus(`Dosya dışa aktarıldı: ${fileName}`, "success");
  } catch (error) {
    console.error(error);
    showEditorStatus(error.message || "Dosya dışa aktarılamadı.", "error");
  }
}
