import {
  backfillRawSource,
  normalizeSetRecord,
} from "./set-codec.js";
import { getRuntimeConfig, hasSupabaseConfig, isDesktopRuntime } from "./runtime-config.js";

const APP_NAMESPACE = "fc_v2";
const MOCK_SESSION_KEY = `${APP_NAMESPACE}::mock::session`;

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

function pickNewerRecord(leftRecord, rightRecord) {
  if (!leftRecord) return rightRecord || null;
  if (!rightRecord) return leftRecord || null;

  const leftTime = Date.parse(leftRecord.updatedAt || "");
  const rightTime = Date.parse(rightRecord.updatedAt || "");

  if (Number.isFinite(leftTime) && Number.isFinite(rightTime)) {
    return leftTime >= rightTime ? leftRecord : rightRecord;
  }

  if (Number.isFinite(leftTime)) return leftRecord;
  if (Number.isFinite(rightTime)) return rightRecord;
  return leftRecord;
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
  let currentUser = safeJsonParse(storage.getItem(MOCK_SESSION_KEY), null);
  const listeners = new Set();

  function emit(event = "mock") {
    listeners.forEach((listener) => {
      listener(currentUser ? { ...currentUser } : null, event);
    });
  }

  function persistUserSession() {
    if (currentUser) {
      storage.setItem(MOCK_SESSION_KEY, JSON.stringify(currentUser));
    } else {
      storage.removeItem(MOCK_SESSION_KEY);
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

    async signIn(email, password) {
      if (!normalizeUserEmail(email) || String(password ?? "").trim().length < 1) {
        throw new Error("E-posta ve parola gerekli.");
      }
      currentUser = createUserFromEmail(email, "mock");
      persistUserSession();
      emit("SIGNED_IN");
      return { ...currentUser };
    },

    async signUp(email, password) {
      const user = await this.signIn(email, password);
      return { user, needsConfirmation: false };
    },

    async signInDemo() {
      currentUser = createUserFromEmail("demo@local.flashcards", "demo");
      persistUserSession();
      emit("SIGNED_IN");
      return { ...currentUser };
    },

    async signOut() {
      currentUser = null;
      persistUserSession();
      emit("SIGNED_OUT");
    },

    async loadSets() {
      if (!currentUser) return [];
      return readUserSets(currentUser.id);
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

function createSupabaseAdapter(config) {
  const createClient = globalThis.supabase?.createClient;
  if (typeof createClient !== "function") {
    throw new Error("Supabase istemcisi yüklenemedi.");
  }

  const client = createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
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

    async signIn(email, password) {
      const { data, error } = await client.auth.signInWithPassword({
        email: normalizeUserEmail(email),
        password,
      });
      if (error) throw error;
      currentUser = data.user || null;
      return currentUser;
    },

    async signUp(email, password) {
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

    async signInDemo() {
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
        await bridge.upsertLocalSet(user.id, remoteRecord);
        return remoteRecord;
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
  };
}

export function createPlatformAdapter(storage = globalThis.AppStorage) {
  const config = getRuntimeConfig();
  const remoteAdapter = hasSupabaseConfig()
    ? createSupabaseAdapter(config)
    : createMockAdapter(config, storage);

  if (isDesktopRuntime()) {
    return createDesktopAdapter(remoteAdapter);
  }

  return remoteAdapter;
}
