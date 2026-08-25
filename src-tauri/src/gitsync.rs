use crate::db;
use crate::models::{
    AuthSpec, Collection, Environment, Folder, HttpRequestRecord, KvRow, PERSONAL_WORKSPACE_ID,
    RequestBody, Workspace,
};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

const GIT_FORMAT: &str = "opendobin.git.workspace";
const GIT_VERSION: u32 = 1;

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceFile {
    format: String,
    version: u32,
    workspace: WorkspaceDoc,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceDoc {
    id: String,
    name: String,
    variables: Vec<KvRow>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CollectionFile {
    id: String,
    name: String,
    #[serde(default)]
    variables: Vec<KvRow>,
    #[serde(default)]
    sort_order: i64,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FolderFile {
    id: String,
    name: String,
    #[serde(default)]
    sort_order: i64,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RequestFile {
    id: String,
    name: String,
    method: String,
    url: String,
    #[serde(default)]
    headers: Vec<KvRow>,
    #[serde(default)]
    query: Vec<KvRow>,
    body: RequestBody,
    #[serde(default)]
    auth: AuthSpec,
    #[serde(default)]
    pre_request: Vec<crate::models::PreStep>,
    #[serde(default)]
    tests: Vec<crate::models::Assertion>,
    #[serde(default)]
    sort_order: i64,
    #[serde(default)]
    updated_at: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EnvironmentFile {
    id: String,
    name: String,
    #[serde(default)]
    variables: Vec<KvRow>,
    #[serde(default)]
    is_active: bool,
    #[serde(default)]
    updated_at: String,
}

pub fn max_mtime(root: &Path) -> u64 {
    walk_mtime(root)
}

fn walk_mtime(path: &Path) -> u64 {
    let mut max = file_mtime(path);
    if let Ok(entries) = fs::read_dir(path) {
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_dir() {
                max = max.max(walk_mtime(&p));
            } else {
                max = max.max(file_mtime(&p));
            }
        }
    }
    max
}

fn file_mtime(path: &Path) -> u64 {
    fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

pub fn export_all(conn: &rusqlite::Connection, root: &Path) -> Result<u64, String> {
    fs::create_dir_all(root).map_err(|e| e.to_string())?;
    let workspace = db::get_workspace(conn)?;
    let collections = db::list_collections(conn)?;
    let folders = db::list_folders(conn)?;
    let requests = db::list_requests(conn)?;
    let environments = db::list_environments(conn)?;

    let ws = WorkspaceFile {
        format: GIT_FORMAT.into(),
        version: GIT_VERSION,
        workspace: WorkspaceDoc {
            id: workspace.id,
            name: workspace.name,
            variables: redact_kvs(&workspace.variables),
        },
    };
    write_json(root.join("opendobin.json"), &ws)?;
    ensure_gitignore(root)?;

    let collections_root = root.join("collections");
    fs::create_dir_all(&collections_root).map_err(|e| e.to_string())?;
    let mut keep: HashSet<PathBuf> = HashSet::new();
    keep.insert(root.join("opendobin.json"));
    keep.insert(root.join(".gitignore"));

    for collection in &collections {
        let col_dir = collections_root.join(stem(&collection.name, &collection.id));
        fs::create_dir_all(&col_dir).map_err(|e| e.to_string())?;
        let col_file = CollectionFile {
            id: collection.id.clone(),
            name: collection.name.clone(),
            variables: redact_kvs(&collection.variables),
            sort_order: 0,
        };
        let col_path = col_dir.join("collection.json");
        write_json(&col_path, &col_file)?;
        keep.insert(col_path);

        let col_folders: Vec<&Folder> = folders
            .iter()
            .filter(|f| f.collection_id == collection.id)
            .collect();
        let mut folder_dirs: HashMap<String, PathBuf> = HashMap::new();
        folder_dirs.insert(String::new(), col_dir.clone());

        let mut remaining = col_folders.clone();
        let mut guard = 0;
        while !remaining.is_empty() && guard < 64 {
            guard += 1;
            let current = std::mem::take(&mut remaining);
            let start_len = current.len();
            for folder in current {
                let parent_key = folder.parent_id.clone().unwrap_or_default();
                let parent_dir = if parent_key.is_empty() {
                    Some(&col_dir)
                } else {
                    folder_dirs.get(&parent_key)
                };
                if let Some(parent) = parent_dir {
                    let dir = parent.join(stem(&folder.name, &folder.id));
                    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
                    let meta = FolderFile {
                        id: folder.id.clone(),
                        name: folder.name.clone(),
                        sort_order: folder.sort_order,
                    };
                    let meta_path = dir.join(".folder.json");
                    write_json(&meta_path, &meta)?;
                    keep.insert(meta_path);
                    folder_dirs.insert(folder.id.clone(), dir);
                } else {
                    remaining.push(folder);
                }
            }
            if remaining.len() == start_len {
                break;
            }
        }

        for request in requests.iter().filter(|r| r.collection_id == collection.id) {
            let parent = request
                .folder_id
                .as_ref()
                .and_then(|id| folder_dirs.get(id))
                .unwrap_or(&col_dir);
            let path = parent.join(format!("{}.json", stem(&request.name, &request.id)));
            let file = RequestFile {
                id: request.id.clone(),
                name: request.name.clone(),
                method: request.method.clone(),
                url: request.url.clone(),
                headers: redact_kvs(&request.headers),
                query: redact_kvs(&request.query),
                body: redact_body(&request.body),
                auth: redact_auth(&request.auth),
                pre_request: request.pre_request.clone(),
                tests: request.tests.clone(),
                sort_order: request.sort_order,
                updated_at: request.updated_at.clone(),
            };
            write_json(&path, &file)?;
            keep.insert(path);
        }
    }

    let env_root = root.join("environments");
    fs::create_dir_all(&env_root).map_err(|e| e.to_string())?;
    for env in &environments {
        let path = env_root.join(format!("{}.json", stem(&env.name, &env.id)));
        let file = EnvironmentFile {
            id: env.id.clone(),
            name: env.name.clone(),
            variables: redact_kvs(&env.variables),
            is_active: env.is_active,
            updated_at: env.updated_at.clone(),
        };
        write_json(&path, &file)?;
        keep.insert(path);
    }

    prune_json(&collections_root, &keep)?;
    prune_json(&env_root, &keep)?;
    Ok(max_mtime(root).max(now_ms()))
}

pub fn import_all(conn: &rusqlite::Connection, root: &Path) -> Result<u64, String> {
    let ws_path = root.join("opendobin.json");
    if !ws_path.exists() {
        return Err("La carpeta no tiene opendobin.json".into());
    }
    let ws: WorkspaceFile = read_json(&ws_path)?;
    let existing_ws = db::get_workspace(conn)?;
    db::save_workspace(
        conn,
        &Workspace {
            id: PERSONAL_WORKSPACE_ID.into(),
            name: ws.workspace.name,
            kind: existing_ws.kind,
            updated_at: db::now(),
            variables: merge_kvs(&existing_ws.variables, &ws.workspace.variables),
        },
    )?;

    let existing_cols = db::list_collections(conn)?;
    let existing_folders = db::list_folders(conn)?;
    let existing_reqs = db::list_requests(conn)?;
    let existing_envs = db::list_environments(conn)?;

    let mut keep_cols = HashSet::new();
    let mut keep_folders = HashSet::new();
    let mut keep_reqs = HashSet::new();
    let mut keep_envs = HashSet::new();

    let collections_root = root.join("collections");
    if collections_root.exists() {
        for entry in fs::read_dir(&collections_root).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let dir = entry.path();
            if !dir.is_dir() {
                continue;
            }
            let meta_path = dir.join("collection.json");
            if !meta_path.exists() {
                continue;
            }
            let col: CollectionFile = read_json(&meta_path)?;
            keep_cols.insert(col.id.clone());
            let prev = existing_cols.iter().find(|c| c.id == col.id);
            db::save_collection(
                conn,
                &Collection {
                    id: col.id.clone(),
                    workspace_id: PERSONAL_WORKSPACE_ID.into(),
                    name: col.name,
                    updated_at: db::now(),
                    variables: merge_kvs(
                        prev.map(|c| c.variables.as_slice()).unwrap_or(&[]),
                        &col.variables,
                    ),
                },
            )?;
            import_tree(
                conn,
                &dir,
                &col.id,
                None,
                &existing_reqs,
                &mut keep_folders,
                &mut keep_reqs,
            )?;
        }
    }

    let env_root = root.join("environments");
    if env_root.exists() {
        for entry in fs::read_dir(&env_root).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("json") {
                continue;
            }
            let env: EnvironmentFile = read_json(&path)?;
            keep_envs.insert(env.id.clone());
            let prev = existing_envs.iter().find(|e| e.id == env.id);
            db::save_environment(
                conn,
                &Environment {
                    id: env.id,
                    workspace_id: PERSONAL_WORKSPACE_ID.into(),
                    name: env.name,
                    variables: merge_kvs(
                        prev.map(|e| e.variables.as_slice()).unwrap_or(&[]),
                        &env.variables,
                    ),
                    is_active: env.is_active,
                    updated_at: if env.updated_at.is_empty() {
                        db::now()
                    } else {
                        env.updated_at
                    },
                },
            )?;
        }
    }

    for req in existing_reqs {
        if !keep_reqs.contains(&req.id) {
            db::delete_request(conn, &req.id)?;
        }
    }
    for folder in existing_folders {
        if !keep_folders.contains(&folder.id) {
            let _ = db::delete_folder(conn, &folder.id);
        }
    }
    for col in existing_cols {
        if !keep_cols.contains(&col.id) {
            db::delete_collection(conn, &col.id)?;
        }
    }
    for env in existing_envs {
        if !keep_envs.contains(&env.id) {
            db::delete_environment(conn, &env.id)?;
        }
    }

    Ok(max_mtime(root))
}

fn import_tree(
    conn: &rusqlite::Connection,
    dir: &Path,
    collection_id: &str,
    folder_id: Option<String>,
    existing_reqs: &[HttpRequestRecord],
    keep_folders: &mut HashSet<String>,
    keep_reqs: &mut HashSet<String>,
) -> Result<(), String> {
    for entry in fs::read_dir(dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if path.is_dir() {
            let meta_path = path.join(".folder.json");
            if !meta_path.exists() {
                continue;
            }
            let meta: FolderFile = read_json(&meta_path)?;
            keep_folders.insert(meta.id.clone());
            db::save_folder(
                conn,
                &Folder {
                    id: meta.id.clone(),
                    workspace_id: PERSONAL_WORKSPACE_ID.into(),
                    collection_id: collection_id.into(),
                    parent_id: folder_id.clone(),
                    name: meta.name,
                    sort_order: meta.sort_order,
                    updated_at: db::now(),
                },
            )?;
            import_tree(
                conn,
                &path,
                collection_id,
                Some(meta.id),
                existing_reqs,
                keep_folders,
                keep_reqs,
            )?;
            continue;
        }
        let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
        if name == "collection.json" || name == ".folder.json" || !name.ends_with(".json") {
            continue;
        }
        let file: RequestFile = read_json(&path)?;
        keep_reqs.insert(file.id.clone());
        let prev = existing_reqs.iter().find(|r| r.id == file.id);
        db::save_request(
            conn,
            &HttpRequestRecord {
                id: file.id,
                workspace_id: PERSONAL_WORKSPACE_ID.into(),
                collection_id: collection_id.into(),
                folder_id: folder_id.clone(),
                name: file.name,
                method: file.method,
                url: file.url,
                headers: merge_kvs(
                    prev.map(|r| r.headers.as_slice()).unwrap_or(&[]),
                    &file.headers,
                ),
                query: merge_kvs(prev.map(|r| r.query.as_slice()).unwrap_or(&[]), &file.query),
                body: merge_body(prev.map(|r| &r.body), &file.body),
                auth: merge_auth(prev.map(|r| &r.auth), &file.auth),
                pre_request: file.pre_request,
                tests: file.tests,
                sort_order: file.sort_order,
                updated_at: if file.updated_at.is_empty() {
                    db::now()
                } else {
                    file.updated_at
                },
            },
        )?;
    }
    Ok(())
}

pub fn has_workspace_file(root: &Path) -> bool {
    root.join("opendobin.json").exists()
}

fn write_json<T: Serialize>(path: impl AsRef<Path>, value: &T) -> Result<(), String> {
    let pretty = serde_json::to_string_pretty(value).map_err(|e| e.to_string())?;
    fs::write(path, pretty + "\n").map_err(|e| e.to_string())
}

fn read_json<T: for<'de> Deserialize<'de>>(path: &Path) -> Result<T, String> {
    let raw = fs::read_to_string(path).map_err(|e| e.to_string())?;
    serde_json::from_str(&raw).map_err(|e| format!("{}: {e}", path.display()))
}

fn ensure_gitignore(root: &Path) -> Result<(), String> {
    let path = root.join(".gitignore");
    let snippet = ".opendobin-secrets\n";
    if path.exists() {
        let current = fs::read_to_string(&path).unwrap_or_default();
        if !current.contains(".opendobin-secrets") {
            fs::write(&path, current + snippet).map_err(|e| e.to_string())?;
        }
    } else {
        fs::write(&path, snippet).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn prune_json(dir: &Path, keep: &HashSet<PathBuf>) -> Result<(), String> {
    if !dir.exists() {
        return Ok(());
    }
    prune_walk(dir, keep)
}

fn prune_walk(dir: &Path, keep: &HashSet<PathBuf>) -> Result<(), String> {
    let entries: Vec<_> = fs::read_dir(dir)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok())
        .collect();
    for entry in entries {
        let path = entry.path();
        if path.is_dir() {
            prune_walk(&path, keep)?;
            if fs::read_dir(&path)
                .map(|mut i| i.next().is_none())
                .unwrap_or(false)
            {
                let _ = fs::remove_dir(&path);
            }
        } else if path
            .extension()
            .and_then(|e| e.to_str())
            .is_some_and(|e| e == "json")
            && !keep.contains(&path)
        {
            let _ = fs::remove_file(&path);
        }
    }
    Ok(())
}

fn stem(name: &str, id: &str) -> String {
    let mut slug: String = name
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == ' ' {
                c
            } else {
                '_'
            }
        })
        .collect();
    slug = slug.trim().to_string();
    while slug.contains("  ") {
        slug = slug.replace("  ", " ");
    }
    if slug.is_empty() {
        slug = "item".into();
    }
    let short = if id.len() >= 8 { &id[..8] } else { id };
    format!("{slug}--{short}")
}

fn redact_kvs(rows: &[KvRow]) -> Vec<KvRow> {
    rows.iter()
        .map(|row| KvRow {
            value: if row.secret {
                String::new()
            } else {
                row.value.clone()
            },
            ..row.clone()
        })
        .collect()
}

fn redact_body(body: &RequestBody) -> RequestBody {
    RequestBody {
        kind: body.kind.clone(),
        content: body.content.clone(),
        form: redact_kvs(&body.form),
    }
}

fn redact_auth(auth: &AuthSpec) -> AuthSpec {
    AuthSpec {
        token: String::new(),
        password: String::new(),
        client_secret: String::new(),
        access_token: String::new(),
        refresh_token: String::new(),
        expires_at: String::new(),
        ..auth.clone()
    }
}

fn merge_kvs(existing: &[KvRow], incoming: &[KvRow]) -> Vec<KvRow> {
    incoming
        .iter()
        .map(|row| {
            if !row.secret {
                return row.clone();
            }
            let prev = existing.iter().find(|p| p.key == row.key);
            KvRow {
                value: prev.map(|p| p.value.clone()).unwrap_or_default(),
                ..row.clone()
            }
        })
        .collect()
}

fn merge_body(existing: Option<&RequestBody>, incoming: &RequestBody) -> RequestBody {
    RequestBody {
        kind: incoming.kind.clone(),
        content: incoming.content.clone(),
        form: merge_kvs(
            existing.map(|b| b.form.as_slice()).unwrap_or(&[]),
            &incoming.form,
        ),
    }
}

fn merge_auth(existing: Option<&AuthSpec>, incoming: &AuthSpec) -> AuthSpec {
    let mut next = incoming.clone();
    if let Some(prev) = existing {
        if next.token.is_empty() {
            next.token = prev.token.clone();
        }
        if next.password.is_empty() {
            next.password = prev.password.clone();
        }
        if next.client_secret.is_empty() {
            next.client_secret = prev.client_secret.clone();
        }
        if next.access_token.is_empty() {
            next.access_token = prev.access_token.clone();
        }
        if next.refresh_token.is_empty() {
            next.refresh_token = prev.refresh_token.clone();
        }
        if next.expires_at.is_empty() {
            next.expires_at = prev.expires_at.clone();
        }
    }
    next
}
