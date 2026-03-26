import {
  backfillRawSource,
  normalizeSetRecord,
} from "./set-codec.js";
import { getRuntimeConfig, hasSupabaseConfig, isDesktopRuntime } from "./runtime-config.js";

const APP_NAMESPACE = "fc_v2";
const MOCK_SESSION_KEY = `${APP_NAMESPACE}::mock::session`;
const AUTH_REMEMBER_ME_KEY = `${APP_NAMESPACE}::auth::remember_me`;

function nowIso() {
  return new Date().toISOString();
}

function safeJsonParse(rawValue, fallbackValue) {
  if (!rawValue) return fallbackValue;
  try {
    return JSON.parse(rawValue);
  } catch {
    return fallbackValue;
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeUserEmail(value) {
  return String(value ?? "").trim().toLowerCase();
}

function createUserFromEmail(email, provider = "mock") {
  const normalizedEmail = normalizeUserEmail(email) || "demo@local.flashcards";
  const safeId = normalizedEmail.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return {
    id: `${provider}-${safeId || "user"}`,
    email: normalizedEmail,
    provider,
  };
}

function localSetStorageKey(userId) {
  return `${APP_NAMESPACE}::user::${userId}::set_records`;
}

function createAuthSessionStorage(storage) {
  const localApi = {
    getItem:
      typeof storage?.getLocalItem === "function"
        ? storage.getLocalItem.bind(storage)
        : storage?.getItem?.bind(storage) || (() => null),
    setItem:
      typeof storage?.setLocalItem === "function"
        ? storage.setLocalItem.bind(storage)
        : storage?.setItem?.bind(storage) || (() => {}),
    removeItem:
      typeof storage?.removeLocalItem === "function"
        ? storage.removeLocalItem.bind(storage)
        : storage?.removeItem?.bind(storage) || (() => {}),
  };
  const sessionApi = {
    getItem:
      typeof storage?.getSessionItem === "function"
        ? storage.getSessionItem.bind(storage)
        : localApi.getItem,
    setItem:
      typeof storage?.setSessionItem === "function"
        ? storage.setSessionItem.bind(storage)
        : localApi.setItem,
    removeItem:
      typeof storage?.removeSessionItem === "function"
        ? storage.removeSessionItem.bind(storage)
        : localApi.removeItem,
  };

  function readRememberMePreference() {
    const storedValue = localApi.getItem(AUTH_REMEMBER_ME_KEY);
    if (storedValue === "0") return false;
    if (storedValue === "1") return true;
    return true;
  }

  let rememberMePreference = readRememberMePreference();

  return {
    getRememberMePreference() {
      return rememberMePreference;
    },

    setRememberMePreference(nextValue) {
      rememberMePreference = nextValue !== false;
      localApi.setItem(AUTH_REMEMBER_ME_KEY, rememberMePreference ? "1" : "0");
      return rememberMePreference;
    },

    getItem(key) {
      const sessionValue = sessionApi.getItem(key);
      return sessionValue != null ? sessionValue : localApi.getItem(key);
    },

    setItem(key, value, rememberMeOverride = rememberMePreference) {
      if (rememberMeOverride) {
        localApi.setItem(key, value);
        sessionApi.removeItem(key);
        return;
      }
      sessionApi.setItem(key, value);
      localApi.removeItem(key);
    },

    removeItem(key) {
      sessionApi.removeItem(key);
      localApi.removeItem(key);
    },
  };
}

function pickNewerRecord(leftRecord, rightRecord) {
  if (!leftRecord) return rightRecord || null;
  if (!rightRecord) return leftRecord || null;

  const leftTime = Date.parse(leftRecord.updatedAt || "");
  const rightTime = Date.parse(rightRecord.updatedAt || "");

  let nextRecord = null;
  if (Number.isFinite(leftTime) && Number.isFinite(rightTime)) {
    nextRecord = leftTime >= rightTime ? leftRecord : rightRecord;
  } else if (Number.isFinite(leftTime)) {
    nextRecord = leftRecord;
  } else if (Number.isFinite(rightTime)) {
    nextRecord = rightRecord;
  } else {
    nextRecord = leftRecord;
  }

  if (!nextRecord?.sourcePath) {
    const preservedSourcePath = String(leftRecord.sourcePath || rightRecord.sourcePath || "").trim();
    if (preservedSourcePath) {
      return {
        ...nextRecord,
        sourcePath: preservedSourcePath,
      };
    }
  }

  return nextRecord;
}

function normalizeSetCollection(records) {
  return Array.isArray(records)
    ? records
        .map((record) => {
          const normalized = normalizeSetRecord(record, { previousRecord: record });
          return {
            ...normalized,
            rawSource: backfillRawSource(normalized),
          };
        })
        .sort((leftRecord, rightRecord) => {
          const leftTime = Date.parse(leftRecord.updatedAt || "");
          const rightTime = Date.parse(rightRecord.updatedAt || "");
          if (Number.isFinite(leftTime) && Number.isFinite(rightTime)) {
            return rightTime - leftTime;
          }
          return leftRecord.setName.localeCompare(rightRecord.setName, "tr");
        })
    : [];
}

function createMockAdapter(config, storage) {
  const authSessionStorage = createAuthSessionStorage(storage);
  let currentUser = safeJsonParse(authSessionStorage.getItem(MOCK_SESSION_KEY), null);
  const listeners = new Set();

  function emit(event = "mock") {
    listeners.forEach((listener) => {
      listener(currentUser ? { ...currentUser } : null, event);
    });
  }

  function persistUserSession(rememberMeOverride) {
    if (currentUser) {
      authSessionStorage.setItem(MOCK_SESSION_KEY, JSON.stringify(currentUser), rememberMeOverride);
    } else {
      authSessionStorage.removeItem(MOCK_SESSION_KEY);
    }
  }

  function readUserSets(userId) {
    return normalizeSetCollection(
      safeJsonParse(storage.getItem(localSetStorageKey(userId)), []),
    );
  }

  function writeUserSets(userId, records) {
    storage.setItem(localSetStorageKey(userId), JSON.stringify(records));
  }

  return {
    type: "mock-web",
    supportsRemoteSync: false,
    supportsDemoAuth: config.enableDemoAuth !== false,

    async getCurrentUser() {
      return currentUser ? { ...currentUser } : null;
    },

    subscribeAuthState(listener) {
      listeners.add(listener);
      listener(currentUser ? { ...currentUser } : null, "initial");
      return () => listeners.delete(listener);
    },

    async signIn(email, password, options = {}) {
      if (!normalizeUserEmail(email) || String(password ?? "").trim().length < 1) {
        throw new Error("E-posta ve parola gerekli.");
      }
      const rememberMe = authSessionStorage.setRememberMePreference(options.rememberMe);
      currentUser = createUserFromEmail(email, "mock");
      persistUserSession(rememberMe);
      emit("SIGNED_IN");
      return { ...currentUser };
    },

    async signUp(email, password, options = {}) {
      const user = await this.signIn(email, password, options);
      return { user, needsConfirmation: false };
    },

    async signInDemo(options = {}) {
      const rememberMe = authSessionStorage.setRememberMePreference(options.rememberMe);
      currentUser = createUserFromEmail("demo@local.flashcards", "demo");
      persistUserSession(rememberMe);
      emit("SIGNED_IN");
      return { ...currentUser };
    },

    async signOut() {
      currentUser = null;
      authSessionStorage.removeItem(MOCK_SESSION_KEY);
      emit("SIGNED_OUT");
    },

    async loadSets() {
      if (!currentUser) return [];
      return readUserSets(currentUser.id);
    },

    async pickNativeSetFiles() {
      return [];
    },

    async writeSetSourceFile() {
      throw new Error("Bu özellik sadece masaüstünde kullanılabilir.");
    },

    async saveSet(record) {
      if (!currentUser) {
        throw new Error("Kaydetmeden önce giriş yapmalısın.");
      }

      const normalized = normalizeSetRecord(
        {
          ...record,
          updatedAt: nowIso(),
        },
        { previousRecord: record },
      );
      normalized.rawSource = backfillRawSource(normalized);

      const currentRecords = readUserSets(currentUser.id);
      const nextRecords = currentRecords.filter((item) => item.id !== normalized.id);
      nextRecords.push(normalized);
      writeUserSets(currentUser.id, normalizeSetCollection(nextRecords));
      return clone(normalized);
    },

    async deleteSets(setIds) {
      if (!currentUser) return;
      const currentRecords = readUserSets(currentUser.id);
      const toDelete = new Set(setIds);
      const nextRecords = currentRecords.filter((item) => !toDelete.has(item.id));
      writeUserSets(currentUser.id, nextRecords);
    },
  };
}

function createSupabaseAdapter(config, storage) {
  const createClient = globalThis.supabase?.createClient;
  if (typeof createClient !== "function") {
    throw new Error("Supabase istemcisi yüklenemedi.");
  }

  const authSessionStorage = createAuthSessionStorage(storage);
  const client = createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
      storage: {
        getItem(key) {
          return authSessionStorage.getItem(key);
        },
        setItem(key, value) {
          authSessionStorage.setItem(key, value);
        },
        removeItem(key) {
          authSessionStorage.removeItem(key);
        },
      },
    },
  });

  let currentUser = null;

  function mapRowToRecord(row) {
    return {
      id: row.id,
      slug: row.slug,
      setName: row.set_name,
      fileName: row.file_name,
      sourceFormat: row.source_format,
      rawSource: row.raw_source,
      cards: Array.isArray(row.cards_json) ? row.cards_json : [],
      updatedAt: row.updated_at,
    };
  }

  function mapRecordToRow(record, userId) {
    const normalized = normalizeSetRecord(
      {
        ...record,
        updatedAt: record.updatedAt || nowIso(),
      },
      { previousRecord: record },
    );
    normalized.rawSource = backfillRawSource(normalized);

    return {
      id: normalized.id,
      user_id: userId,
      slug: normalized.slug,
      set_name: normalized.setName,
      file_name: normalized.fileName,
      source_format: normalized.sourceFormat,
      raw_source: normalized.rawSource,
      cards_json: normalized.cards,
      updated_at: normalized.updatedAt,
    };
  }

  async function refreshCurrentUser() {
    const {
      data: { user },
      error,
    } = await client.auth.getUser();

    if (error) {
      currentUser = null;
      return null;
    }

    currentUser = user || null;
    return currentUser;
  }

  return {
    type: "supabase-web",
    supportsRemoteSync: true,
    supportsDemoAuth: false,

    async getCurrentUser() {
      const {
        data: { session },
        error,
      } = await client.auth.getSession();

      if (error) {
        throw error;
      }

      currentUser = session?.user || null;
      return currentUser;
    },

    subscribeAuthState(listener) {
      const authListener = client.auth.onAuthStateChange((event, session) => {
        currentUser = session?.user || null;
        listener(currentUser, event);
      });

      void refreshCurrentUser().then((user) => listener(user, "initial"));

      return () => {
        authListener.data.subscription.unsubscribe();
      };
    },

    async signIn(email, password, options = {}) {
      authSessionStorage.setRememberMePreference(options.rememberMe);
      const { data, error } = await client.auth.signInWithPassword({
        email: normalizeUserEmail(email),
        password,
      });
      if (error) throw error;
      currentUser = data.user || null;
      return currentUser;
    },

    async signUp(email, password, options = {}) {
      authSessionStorage.setRememberMePreference(options.rememberMe);
      const { data, error } = await client.auth.signUp({
        email: normalizeUserEmail(email),
        password,
      });
      if (error) throw error;
      currentUser = data.user || null;
      return {
        user: currentUser,
        needsConfirmation: !data.session,
      };
    },

    async signInDemo(_options = {}) {
      throw new Error("Demo girişi bu yapılandırmada kapalı.");
    },

    async signOut() {
      const { error } = await client.auth.signOut();
      if (error) throw error;
      currentUser = null;
    },

    async loadSets() {
      const user = currentUser || (await refreshCurrentUser());
      if (!user) return [];

      const { data, error } = await client
        .from("flashcard_sets")
        .select("*")
        .eq("user_id", user.id)
        .order("updated_at", { ascending: false });

      if (error) throw error;
      return normalizeSetCollection((data || []).map(mapRowToRecord));
    },

    async pickNativeSetFiles() {
      return [];
    },

    async writeSetSourceFile() {
      throw new Error("Bu özellik sadece masaüstünde kullanılabilir.");
    },

    async saveSet(record) {
      const user = currentUser || (await refreshCurrentUser());
      if (!user) {
        throw new Error("Kaydetmeden önce giriş yapmalısın.");
      }

      const row = mapRecordToRow(record, user.id);
      const { data, error } = await client
        .from("flashcard_sets")
        .upsert(row, { onConflict: "id" })
        .select("*")
        .single();

      if (error) throw error;
      return normalizeSetCollection([mapRowToRecord(data)])[0];
    },

    async deleteSets(setIds) {
      const user = currentUser || (await refreshCurrentUser());
      if (!user || !Array.isArray(setIds) || setIds.length === 0) return;

      const { error } = await client
        .from("flashcard_sets")
        .delete()
        .eq("user_id", user.id)
        .in("id", setIds);

      if (error) throw error;
    },
  };
}

function createTauriBridge() {
  const invoke = globalThis.__TAURI__?.core?.invoke;
  if (typeof invoke !== "function") {
    return null;
  }

  return {
    async listLocalSets(userId) {
      return invoke("list_local_sets", { userId });
    },
    async upsertLocalSet(userId, record) {
      return invoke("upsert_local_set", { userId, record });
    },
    async deleteLocalSets(userId, setIds) {
      return invoke("delete_local_sets", { userId, setIds });
    },
    async queueSync(userId, operation) {
      return invoke("queue_sync", { userId, operation });
    },
    async flushSync(userId) {
      return invoke("flush_sync", { userId });
    },
    async pickNativeSetFiles() {
      return invoke("pick_native_set_files", {});
    },
    async writeSetSourceFile(sourcePath, rawSource) {
      return invoke("write_set_source_file", { sourcePath, rawSource });
    },
  };
}

function mergeDesktopSets(localSets, remoteSets, pendingSetIds) {
  const result = new Map();
  const remoteMap = new Map(remoteSets.map((record) => [record.id, record]));
  const localMap = new Map(localSets.map((record) => [record.id, record]));

  remoteSets.forEach((remoteRecord) => {
    const localRecord = localMap.get(remoteRecord.id);
    result.set(
      remoteRecord.id,
      pickNewerRecord(localRecord, remoteRecord),
    );
  });

  localSets.forEach((localRecord) => {
    if (result.has(localRecord.id)) return;
    if (pendingSetIds.has(localRecord.id)) {
      result.set(localRecord.id, localRecord);
    }
  });

  return normalizeSetCollection([...result.values()]);
}

function createDesktopAdapter(remoteAdapter) {
  const bridge = createTauriBridge();
  if (!bridge) {
    return remoteAdapter;
  }

  async function getUserOrThrow() {
    const user = await remoteAdapter.getCurrentUser();
    if (!user) {
      throw new Error("Masaüstü senkronizasyonu için giriş gerekli.");
    }
    return user;
  }

  async function readLocalSets(userId) {
    const records = await bridge.listLocalSets(userId);
    return normalizeSetCollection(records || []);
  }

  async function persistLocalMirror(userId, nextRecords) {
    const existing = await readLocalSets(userId);
    const nextMap = new Map(nextRecords.map((record) => [record.id, record]));
    const existingIds = new Set(existing.map((record) => record.id));

    for (const record of nextRecords) {
      await bridge.upsertLocalSet(userId, record);
    }

    const idsToDelete = [...existingIds].filter((setId) => !nextMap.has(setId));
    if (idsToDelete.length > 0) {
      await bridge.deleteLocalSets(userId, idsToDelete);
    }
  }

  async function applyQueuedOperations(userId, operations) {
    const failedOperations = [];

    for (const operation of operations) {
      try {
        if (operation.type === "upsert" && operation.record) {
          await remoteAdapter.saveSet(operation.record);
        } else if (operation.type === "delete" && Array.isArray(operation.setIds)) {
          await remoteAdapter.deleteSets(operation.setIds);
        }
      } catch (error) {
        failedOperations.push(operation);
      }
    }

    for (const operation of failedOperations) {
      await bridge.queueSync(userId, operation);
    }

    return failedOperations;
  }

  return {
    ...remoteAdapter,
    type: "desktop-sync",
    supportsRemoteSync: true,

    async loadSets() {
      const user = await getUserOrThrow();
      const userId = user.id;
      const localSets = await readLocalSets(userId);

      try {
        const queuedOperations = await bridge.flushSync(userId);
        const failedOperations = await applyQueuedOperations(userId, queuedOperations || []);
        const pendingSetIds = new Set();

        failedOperations.forEach((operation) => {
          if (operation.type === "upsert" && operation.record?.id) {
            pendingSetIds.add(operation.record.id);
          }
          if (operation.type === "delete" && Array.isArray(operation.setIds)) {
            operation.setIds.forEach((setId) => pendingSetIds.add(setId));
          }
        });

        const remoteSets = await remoteAdapter.loadSets();
        const merged = mergeDesktopSets(localSets, remoteSets, pendingSetIds);
        await persistLocalMirror(userId, merged);
        return merged;
      } catch {
        return localSets;
      }
    },

    async saveSet(record) {
      const user = await getUserOrThrow();
      const normalized = normalizeSetRecord(
        {
          ...record,
          updatedAt: nowIso(),
        },
        { previousRecord: record },
      );
      normalized.rawSource = backfillRawSource(normalized);

      await bridge.upsertLocalSet(user.id, normalized);

      try {
        const remoteRecord = await remoteAdapter.saveSet(normalized);
        const persistedRecord = normalizeSetCollection([
          {
            ...remoteRecord,
            sourcePath: normalized.sourcePath || remoteRecord?.sourcePath || "",
          },
        ])[0];
        await bridge.upsertLocalSet(user.id, persistedRecord);
        return persistedRecord;
      } catch (error) {
        await bridge.queueSync(user.id, {
          type: "upsert",
          queuedAt: nowIso(),
          record: normalized,
        });
        return normalized;
      }
    },

    async deleteSets(setIds) {
      const user = await getUserOrThrow();
      await bridge.deleteLocalSets(user.id, setIds);

      try {
        await remoteAdapter.deleteSets(setIds);
      } catch (error) {
        await bridge.queueSync(user.id, {
          type: "delete",
          queuedAt: nowIso(),
          setIds,
        });
      }
    },

    async pickNativeSetFiles() {
      return bridge.pickNativeSetFiles();
    },

    async writeSetSourceFile(sourcePath, rawSource) {
      return bridge.writeSetSourceFile(sourcePath, rawSource);
    },
  };
}

export function createPlatformAdapter(storage = globalThis.AppStorage) {
  const config = getRuntimeConfig();
  const remoteAdapter = hasSupabaseConfig()
    ? createSupabaseAdapter(config, storage)
    : createMockAdapter(config, storage);

  if (isDesktopRuntime()) {
    return createDesktopAdapter(remoteAdapter);
  }

  return remoteAdapter;
}
