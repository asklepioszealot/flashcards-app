import {
  FLASHCARD_AUDIO_ACCEPT,
  FLASHCARD_AUDIO_MAX_BYTES,
  FLASHCARD_IMAGE_ACCEPT,
  FLASHCARD_IMAGE_MAX_BYTES,
} from "../../shared/constants.js";

const IMAGE_COMPRESSION_TRIGGER_BYTES = 1536 * 1024;
const IMAGE_COMPRESSION_QUALITY_STEPS = [0.86, 0.78, 0.7, 0.62];
const MAX_IMAGE_DIMENSION = 1600;

const MEDIA_MIME_CONFIG = Object.freeze({
  "image/jpeg": { kind: "image", extension: "jpg", maxBytes: FLASHCARD_IMAGE_MAX_BYTES },
  "image/png": { kind: "image", extension: "png", maxBytes: FLASHCARD_IMAGE_MAX_BYTES },
  "image/webp": { kind: "image", extension: "webp", maxBytes: FLASHCARD_IMAGE_MAX_BYTES },
  "audio/mpeg": { kind: "audio", extension: "mp3", maxBytes: FLASHCARD_AUDIO_MAX_BYTES },
  "audio/ogg": { kind: "audio", extension: "ogg", maxBytes: FLASHCARD_AUDIO_MAX_BYTES },
  "audio/wav": { kind: "audio", extension: "wav", maxBytes: FLASHCARD_AUDIO_MAX_BYTES },
});

function createMediaUploadError(message, code = "MEDIA_UPLOAD_ERROR") {
  const error = new Error(message);
  error.code = code;
  return error;
}

function getMediaConfig(fileOrMimeType) {
  const mimeType = typeof fileOrMimeType === "string"
    ? fileOrMimeType
    : String(fileOrMimeType?.type || "");
  return MEDIA_MIME_CONFIG[mimeType.toLowerCase()] || null;
}

function stripExtension(fileName) {
  return String(fileName || "")
    .replace(/\.[^.]+$/, "")
    .trim();
}

function generateUploadUuid() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function shouldCompressImage(file) {
  return Number(file?.size || 0) > IMAGE_COMPRESSION_TRIGGER_BYTES;
}

function getScaledImageSize(width, height) {
  const safeWidth = Math.max(Number(width) || 0, 1);
  const safeHeight = Math.max(Number(height) || 0, 1);
  const largestSide = Math.max(safeWidth, safeHeight);

  if (largestSide <= MAX_IMAGE_DIMENSION) {
    return { width: safeWidth, height: safeHeight };
  }

  const scale = MAX_IMAGE_DIMENSION / largestSide;
  return {
    width: Math.max(Math.round(safeWidth * scale), 1),
    height: Math.max(Math.round(safeHeight * scale), 1),
  };
}

function canvasToBlob(canvas, type, quality) {
  if (!canvas || typeof canvas.toBlob !== "function") {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    canvas.toBlob(resolve, type, quality);
  });
}

async function loadImageElement(file) {
  if (
    !file
    || typeof Image === "undefined"
    || typeof URL === "undefined"
    || typeof URL.createObjectURL !== "function"
  ) {
    return null;
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise((resolve, reject) => {
      const nextImage = new Image();
      nextImage.onload = () => resolve(nextImage);
      nextImage.onerror = () => reject(new Error("Image could not be loaded for compression."));
      nextImage.src = objectUrl;
    });
    return image;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export function resolveMediaKind(fileOrMimeType) {
  return getMediaConfig(fileOrMimeType)?.kind || null;
}

export function validateMediaUpload(file, options = {}) {
  const mediaConfig = getMediaConfig(file);
  if (!mediaConfig) {
    throw createMediaUploadError(
      `Desteklenen dosya tipleri: ${FLASHCARD_IMAGE_ACCEPT}, ${FLASHCARD_AUDIO_ACCEPT}.`,
      "MEDIA_UPLOAD_VALIDATION_ERROR",
    );
  }

  if (options.intendedKind && options.intendedKind !== mediaConfig.kind) {
    throw createMediaUploadError(
      options.intendedKind === "image"
        ? "Lutfen yalnizca gorsel dosyasi sec."
        : "Lutfen yalnizca ses dosyasi sec.",
      "MEDIA_UPLOAD_VALIDATION_ERROR",
    );
  }

  const sizeBytes = Number(file?.size || 0);
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    throw createMediaUploadError("Bos medya dosyasi yuklenemez.", "MEDIA_UPLOAD_VALIDATION_ERROR");
  }

  if (sizeBytes > mediaConfig.maxBytes) {
    throw createMediaUploadError(
      mediaConfig.kind === "image"
        ? "Gorseller 2 MB veya daha kucuk olmali."
        : "Ses dosyalari 5 MB veya daha kucuk olmali.",
      "MEDIA_UPLOAD_VALIDATION_ERROR",
    );
  }

  return {
    ...mediaConfig,
    mimeType: String(file.type || "").toLowerCase(),
    sizeBytes,
  };
}

export async function compressImageForUpload(file) {
  if (
    resolveMediaKind(file) !== "image"
    || !shouldCompressImage(file)
    || typeof document === "undefined"
  ) {
    return file;
  }

  try {
    const image = await loadImageElement(file);
    if (!image) return file;

    const { width, height } = getScaledImageSize(image.naturalWidth, image.naturalHeight);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext("2d");
    if (!context) return file;

    context.drawImage(image, 0, 0, width, height);

    let smallestBlob = null;
    for (const quality of IMAGE_COMPRESSION_QUALITY_STEPS) {
      const candidateBlob = await canvasToBlob(canvas, "image/webp", quality);
      if (!candidateBlob) continue;
      if (!smallestBlob || candidateBlob.size < smallestBlob.size) {
        smallestBlob = candidateBlob;
      }
      if (candidateBlob.size <= FLASHCARD_IMAGE_MAX_BYTES) {
        break;
      }
    }

    if (!smallestBlob || smallestBlob.size >= file.size || typeof File !== "function") {
      return file;
    }

    const nextName = `${stripExtension(file.name) || "image"}.webp`;
    return new File([smallestBlob], nextName, {
      type: "image/webp",
      lastModified: Date.now(),
    });
  } catch {
    return file;
  }
}

export function buildMediaObjectPath(extension) {
  const safeExtension = String(extension || "bin").replace(/[^a-z0-9]+/gi, "").toLowerCase() || "bin";
  return `media/${generateUploadUuid()}.${safeExtension}`;
}

export function buildMediaMarkdownSnippet(kind, publicUrl) {
  return kind === "audio"
    ? `<audio controls src="${publicUrl}"></audio>`
    : `![Image](${publicUrl})`;
}

export async function prepareMediaUpload(file, options = {}) {
  const intendedKind = options.intendedKind || null;
  const initialKind = resolveMediaKind(file);
  if (!initialKind) {
    validateMediaUpload(file, { intendedKind });
  }

  const preparedFile = initialKind === "image"
    ? await compressImageForUpload(file)
    : file;
  const validated = validateMediaUpload(preparedFile, { intendedKind });

  return {
    extension: validated.extension,
    file: preparedFile,
    kind: validated.kind,
    mimeType: validated.mimeType,
    objectPath: buildMediaObjectPath(validated.extension),
    sizeBytes: validated.sizeBytes,
  };
}

export function resolveMediaUploadErrorMessage(error) {
  if (error?.code === "MEDIA_STORAGE_LIMIT_REACHED") {
    return "Storage limit (400 MB) reached. Please delete old media to upload new files.";
  }
  if (error?.code === "MEDIA_UPLOAD_NOT_SUPPORTED") {
    return "Medya yuklemek icin Supabase Storage yapilandirmasi gerekli.";
  }
  if (error?.code === "MEDIA_UPLOAD_SETUP_REQUIRED") {
    return "Supabase medya kurulumu eksik. docs/SUPABASE_MEDIA_STORAGE_SETUP.sql dosyasini calistirin.";
  }
  if (error?.code === "MEDIA_UPLOAD_VALIDATION_ERROR") {
    return error.message;
  }
  return error?.message || "Medya yuklenemedi.";
}
