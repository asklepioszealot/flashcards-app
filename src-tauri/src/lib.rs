use std::{
  fs,
  path::{Path, PathBuf},
  time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CardRecord {
  id: String,
  q: String,
  a: String,
  subject: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SetRecord {
  id: String,
  slug: String,
  set_name: String,
  file_name: String,
  source_format: String,
  #[serde(default)]
  source_path: String,
  raw_source: String,
  cards: Vec<CardRecord>,
  updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SyncOperation {
  #[serde(rename = "type")]
  operation_type: String,
  queued_at: String,
  set_ids: Option<Vec<String>>,
  record: Option<SetRecord>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct NativePickedFile {
  path: String,
  name: String,
  contents: String,
}

fn safe_segment(value: &str) -> String {
  value
    .chars()
    .map(|character| {
      if character.is_ascii_alphanumeric() || character == '-' || character == '_' {
        character
      } else {
        '_'
      }
    })
    .collect::<String>()
}

fn ensure_directory(path: &Path) -> Result<(), String> {
  fs::create_dir_all(path).map_err(|error| error.to_string())
}

fn user_root_dir(app: &tauri::AppHandle, user_id: &str) -> Result<PathBuf, String> {
  let base_dir = app.path().app_data_dir().map_err(|error| error.to_string())?;
  let root_dir = base_dir.join("users").join(safe_segment(user_id));
  ensure_directory(&root_dir)?;
  Ok(root_dir)
}

fn sets_dir(app: &tauri::AppHandle, user_id: &str) -> Result<PathBuf, String> {
  let directory = user_root_dir(app, user_id)?.join("sets");
  ensure_directory(&directory)?;
  Ok(directory)
}

fn sync_queue_path(app: &tauri::AppHandle, user_id: &str) -> Result<PathBuf, String> {
  let root_dir = user_root_dir(app, user_id)?;
  Ok(root_dir.join("sync-queue.json"))
}

fn set_path(app: &tauri::AppHandle, user_id: &str, set_id: &str) -> Result<PathBuf, String> {
  Ok(sets_dir(app, user_id)?.join(format!("{}.json", safe_segment(set_id))))
}

fn read_sync_queue(path: &Path) -> Result<Vec<SyncOperation>, String> {
  if !path.exists() {
    return Ok(Vec::new());
  }

  let raw = fs::read_to_string(path).map_err(|error| error.to_string())?;
  if raw.trim().is_empty() {
    return Ok(Vec::new());
  }

  serde_json::from_str(&raw).map_err(|error| error.to_string())
}

fn write_sync_queue(path: &Path, operations: &[SyncOperation]) -> Result<(), String> {
  let payload = serde_json::to_string_pretty(operations).map_err(|error| error.to_string())?;
  fs::write(path, payload).map_err(|error| error.to_string())
}

fn file_name_for_path(path: &Path) -> String {
  path
    .file_name()
    .and_then(|value| value.to_str())
    .map(String::from)
    .unwrap_or_else(|| path.to_string_lossy().into_owned())
}

fn read_native_file(path: &Path) -> Result<NativePickedFile, String> {
  let contents = fs::read_to_string(path).map_err(|error| error.to_string())?;
  Ok(NativePickedFile {
    path: path.to_string_lossy().into_owned(),
    name: file_name_for_path(path),
    contents,
  })
}

fn write_atomic_text_file(path: &Path, contents: &str) -> Result<(), String> {
  if !path.is_absolute() {
    return Err("sourcePath mutlak bir yol olmalı.".to_string());
  }

  let path = path
    .canonicalize()
    .map_err(|error| error.to_string())?;

  if path.is_dir() {
    return Err("sourcePath bir klasör olamaz.".to_string());
  }

  let parent = path
    .parent()
    .ok_or_else(|| "sourcePath üst dizini bulunamadı.".to_string())?;

  let unique_suffix = SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .map_err(|error| error.to_string())?
    .as_nanos();
  let temp_path = parent.join(format!(
    ".flashcards-app-{}-{}.tmp",
    safe_segment(&file_name_for_path(&path)),
    unique_suffix
  ));

  fs::write(&temp_path, contents).map_err(|error| error.to_string())?;

  let rename_result = (|| {
    if path.exists() {
      fs::remove_file(&path).map_err(|error| error.to_string())?;
    }
    fs::rename(&temp_path, &path).map_err(|error| error.to_string())
  })();

  if let Err(error) = rename_result {
    let _ = fs::remove_file(&temp_path);
    return Err(error);
  }

  Ok(())
}

#[tauri::command]
async fn pick_native_set_files(app: tauri::AppHandle) -> Result<Vec<NativePickedFile>, String> {
  let picked_files = app.dialog().file().blocking_pick_files();

  let Some(files) = picked_files else {
    return Ok(Vec::new());
  };

  files
    .into_iter()
    .map(|file_path| {
      let path = file_path
        .into_path()
        .map_err(|error| error.to_string())?;
      read_native_file(&path)
    })
    .collect()
}

#[tauri::command]
async fn write_set_source_file(source_path: String, raw_source: String) -> Result<(), String> {
  let path = PathBuf::from(source_path);
  write_atomic_text_file(&path, &raw_source)
}

#[tauri::command]
fn list_local_sets(app: tauri::AppHandle, user_id: String) -> Result<Vec<SetRecord>, String> {
  let directory = sets_dir(&app, &user_id)?;
  let entries = fs::read_dir(directory).map_err(|error| error.to_string())?;
  let mut records = Vec::new();

  for entry in entries {
    let entry = entry.map_err(|error| error.to_string())?;
    let path = entry.path();
    if path.extension().and_then(|value| value.to_str()) != Some("json") {
      continue;
    }

    let raw = fs::read_to_string(&path).map_err(|error| error.to_string())?;
    let record: SetRecord = serde_json::from_str(&raw).map_err(|error| error.to_string())?;
    records.push(record);
  }

  Ok(records)
}

#[tauri::command]
fn upsert_local_set(
  app: tauri::AppHandle,
  user_id: String,
  record: SetRecord,
) -> Result<SetRecord, String> {
  let path = set_path(&app, &user_id, &record.id)?;
  let payload = serde_json::to_string_pretty(&record).map_err(|error| error.to_string())?;
  fs::write(path, payload).map_err(|error| error.to_string())?;
  Ok(record)
}

#[tauri::command]
fn delete_local_sets(
  app: tauri::AppHandle,
  user_id: String,
  set_ids: Vec<String>,
) -> Result<(), String> {
  for set_id in set_ids {
    let path = set_path(&app, &user_id, &set_id)?;
    if path.exists() {
      fs::remove_file(path).map_err(|error| error.to_string())?;
    }
  }

  Ok(())
}

#[tauri::command]
fn queue_sync(
  app: tauri::AppHandle,
  user_id: String,
  operation: SyncOperation,
) -> Result<(), String> {
  let path = sync_queue_path(&app, &user_id)?;
  let mut operations = read_sync_queue(&path)?;
  operations.push(operation);
  write_sync_queue(&path, &operations)
}

#[tauri::command]
fn flush_sync(app: tauri::AppHandle, user_id: String) -> Result<Vec<SyncOperation>, String> {
  let path = sync_queue_path(&app, &user_id)?;
  let operations = read_sync_queue(&path)?;
  write_sync_queue(&path, &[])?;
  Ok(operations)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(
      tauri_plugin_log::Builder::default()
        .level(log::LevelFilter::Info)
        .build(),
    )
    .plugin(tauri_plugin_dialog::init())
    .invoke_handler(tauri::generate_handler![
      list_local_sets,
      upsert_local_set,
      delete_local_sets,
      queue_sync,
      flush_sync,
      pick_native_set_files,
      write_set_source_file
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
