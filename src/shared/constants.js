// src/shared/constants.js
// All application-level constants — no imports, pure data.

export const APP_NAMESPACE = "fc_v2";
export const THEME_KEY = "fc_theme";
export const THEME_CONTROL_IDS = ["theme-select-auth", "theme-select-manager", "theme-select-study", "theme-select-editor"];
export const AUTH_REMEMBER_ME_KEY = `${APP_NAMESPACE}::auth::remember_me`;
export const LEGACY_KEYS = {
  session: "fc_session",
  sets: "fc_loaded_sets",
  assessments: "fc_assessments",
  autoAdvance: "fc_auto_advance",
  selectedSets: "fc_selected_sets",
  legacyState: "flashcards_state_v6",
};
export const USER_STUDY_STATE_KEY = "study_state_sync";
export const USER_SET_SOURCE_PATHS_KEY = "set_source_paths";
export const USER_REMOVED_LOCAL_SET_MATCHES_KEY = "removed_local_set_matches";
export const WEB_FILE_SOURCE_PREFIX = "webfile://";
export const BROWSER_FILE_HANDLE_DB_NAME = `${APP_NAMESPACE}::browser-file-handles`;
export const BROWSER_FILE_HANDLE_STORE = "handles";

export const DRIVE_SCOPES = "https://www.googleapis.com/auth/drive.readonly";

export const DESKTOP_UPDATE_DEFAULT_LABEL = "Güncellemeleri Kontrol Et";

export const DEFAULT_EDITOR_FIELD_HEIGHTS = Object.freeze({ question: 170, answer: 220, preview: 240 });
export const MIN_EDITOR_FIELD_HEIGHTS = Object.freeze({ question: 136, answer: 184, preview: 220 });
export const DEFAULT_EDITOR_SPLIT_RATIO = 56;
export const MIN_EDITOR_SPLIT_RATIO = 40;
export const MAX_EDITOR_SPLIT_RATIO = 60;
export const EDITOR_SPLIT_KEYBOARD_STEP = 2;
export const MIN_EDITOR_RAW_HEIGHT = 400;
export const MAX_EDITOR_HISTORY_LENGTH = 120;

export const DEFAULT_REVIEW_PREFERENCES = Object.freeze({
  memoryTargetPercent: 85,
  intervalMultiplier: 1,
});

export const DEFAULT_CARD_CONTENT_PREFERENCES = Object.freeze({
  frontFontSize: 24,
  backFontSize: 18,
  fullscreenFrontFontSize: 28,
  fullscreenBackFontSize: 20,
  showTopicSourceName: false,
});
export const MIN_CARD_CONTENT_FONT_SIZE = 14;
export const MAX_CARD_CONTENT_FONT_SIZE = 32;

export const FLASHCARD_MEDIA_BUCKET = "flashcard-media";
export const FLASHCARD_MEDIA_HARD_LIMIT_BYTES = 400 * 1024 * 1024;
export const FLASHCARD_IMAGE_MAX_BYTES = 2 * 1024 * 1024;
export const FLASHCARD_AUDIO_MAX_BYTES = 5 * 1024 * 1024;
export const FLASHCARD_IMAGE_ACCEPT = "image/png, image/jpeg, image/webp";
export const FLASHCARD_AUDIO_ACCEPT = "audio/mpeg, audio/wav, audio/ogg";
export const FLASHCARD_MEDIA_ACCEPT = `${FLASHCARD_IMAGE_ACCEPT}, ${FLASHCARD_AUDIO_ACCEPT}`;

export const REVIEW_MEMORY_TARGET_OPTIONS = Object.freeze([75, 80, 85, 90, 95]);
export const REVIEW_INTERVAL_MULTIPLIER_OPTIONS = Object.freeze([
  0.8,
  0.85,
  0.9,
  0.95,
  1,
  1.05,
  1.1,
  1.15,
  1.2,
  1.25,
  1.3,
]);

export const primaryMarkdownActions = [
  { id: "undo", label: "Geri al", title: "Geri al", icon: "rotate-ccw", iconOnly: true },
  { id: "redo", label: "İleri al", title: "İleri al", icon: "rotate-cw", iconOnly: true },
  { id: "code", label: "Kod", title: "Kod", icon: "code", iconOnly: true },
  { id: "attachment", label: "Eklenti", title: "Görsel veya ses ekle", icon: "paperclip", iconOnly: true },
  { id: "bold", label: "B", title: "Kalın" },
  { id: "critical", label: "!!", title: "Kritik vurgu" },
  { id: "warning", label: "Uyarı", title: "Uyarı kutusu" },
  { id: "bulletList", label: "Liste", title: "Madde işaretli liste" },
  { id: "numberList", label: "1. Liste", title: "Numaralı liste" },
];

export const overflowMarkdownActions = [
  { id: "italic", label: "I", title: "İtalik" },
  { id: "strike", label: "S", title: "Üstü çizili" },
  { id: "heading", label: "H2", title: "Başlık" },
  { id: "quote", label: "Alıntı", title: "Alıntı" },
  { id: "link", label: "Link", title: "Bağlantı ekle" },
  { id: "divider", label: "Ayraç", title: "Ayraç" },
  { id: "table", label: "Tablo", title: "Tablo şablonu" },
];

export const allMarkdownActions = [...primaryMarkdownActions, ...overflowMarkdownActions];
