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
export const WEB_FILE_SOURCE_PREFIX = "webfile://";
export const BROWSER_FILE_HANDLE_DB_NAME = `${APP_NAMESPACE}::browser-file-handles`;
export const BROWSER_FILE_HANDLE_STORE = "handles";

export const DRIVE_CLIENT_ID = "102976125468-1mq0m7ptikns377eso8gmnaaioac17fv.apps.googleusercontent.com";
export const DRIVE_API_KEY = "AIzaSyCUvy3PvFNpAVL9FYvLF22lzUPJ9xZHWrw";
export const DRIVE_APP_ID = "102976125468";
export const DRIVE_SCOPES = "https://www.googleapis.com/auth/drive.readonly";

export const DESKTOP_UPDATE_DEFAULT_LABEL = "Güncellemeleri Kontrol Et";

export const DEFAULT_EDITOR_FIELD_HEIGHTS = Object.freeze({ question: 170, answer: 220, preview: 240 });
export const MIN_EDITOR_FIELD_HEIGHTS = Object.freeze({ question: 136, answer: 184, preview: 220 });
export const DEFAULT_EDITOR_SPLIT_RATIO = 56;
export const MIN_EDITOR_SPLIT_RATIO = 40;
export const MAX_EDITOR_SPLIT_RATIO = 60;
export const EDITOR_SPLIT_KEYBOARD_STEP = 2;
export const MIN_EDITOR_RAW_HEIGHT = 240;
export const MAX_EDITOR_HISTORY_LENGTH = 120;

export const primaryMarkdownActions = [
  { id: "undo", label: "Geri", title: "Geri al" },
  { id: "redo", label: "İleri", title: "İleri al" },
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
  { id: "code", label: "</>", title: "Kod" },
  { id: "divider", label: "Ayraç", title: "Ayraç" },
  { id: "table", label: "Tablo", title: "Tablo şablonu" },
];

export const allMarkdownActions = [...primaryMarkdownActions, ...overflowMarkdownActions];
