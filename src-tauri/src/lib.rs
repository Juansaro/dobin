mod cookies;
mod db;
mod gitsync;
mod http;
mod models;
mod oauth;
mod tunnel;
mod webhook;

use models::{
    AppSettings, Collection, CookieRecord, Environment, Folder, GitSyncResult, HistoryEntry,
    HttpRequestRecord, HttpSendPayload, HttpSendResult, OauthParams, OauthTokens, ResponseSnapshot,
    Secret, WebhookEvent, WebhookStatus, Workspace,
};
use parking_lot::Mutex;
use rusqlite::Connection;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{AppHandle, Manager, State};
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

pub struct AppState {
    db: Arc<Mutex<Connection>>,
    cancels: Mutex<HashMap<String, CancellationToken>>,
    webhook: Mutex<Option<webhook::WebhookHandle>>,
    tunnel: Mutex<Option<tunnel::TunnelHandle>>,
    git_mtime: Mutex<u64>,
}

impl AppState {
    fn init(app: &AppHandle) -> Result<Self, String> {
        let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let conn = Connection::open(dir.join("opendobin.db")).map_err(|e| e.to_string())?;
        db::init(&conn)?;
        let git_mtime = {
            let folder = db::get_setting(&conn, "gitFolder", "").unwrap_or_default();
            if folder.is_empty() {
                0
            } else {
                let path = std::path::Path::new(&folder);
                if gitsync::has_workspace_file(path) {
                    gitsync::import_all(&conn, path).unwrap_or_else(|_| gitsync::max_mtime(path))
                } else {
                    gitsync::max_mtime(path)
                }
            }
        };
        Ok(Self {
            db: Arc::new(Mutex::new(conn)),
            cancels: Mutex::new(HashMap::new()),
            webhook: Mutex::new(None),
            tunnel: Mutex::new(None),
            git_mtime: Mutex::new(git_mtime),
        })
    }
}

fn merge_webhook_status(state: &AppState) -> WebhookStatus {
    let mut status = webhook::current_status(state.webhook.lock().as_ref());
    if let Some(tunnel) = state.tunnel.lock().as_ref() {
        status.public_url = tunnel.public_url.clone();
        status.tunnel_running = true;
        status.tunnel_error.clear();
    }
    status
}

fn stop_tunnel(state: &AppState) {
    if let Some(handle) = state.tunnel.lock().take() {
        handle.stop();
    }
}

fn git_folder(state: &AppState) -> String {
    db::get_setting(&state.db.lock(), "gitFolder", "").unwrap_or_default()
}

fn maybe_git_export(state: &AppState) {
    let folder = git_folder(state);
    if folder.is_empty() {
        return;
    }
    match gitsync::export_all(&state.db.lock(), std::path::Path::new(&folder)) {
        Ok(mtime) => *state.git_mtime.lock() = mtime,
        Err(err) => eprintln!("git export: {err}"),
    }
}

#[tauri::command]
fn workspace_get(state: State<AppState>) -> Result<Workspace, String> {
    db::get_workspace(&state.db.lock())
}

#[tauri::command]
fn workspace_save(state: State<AppState>, workspace: Workspace) -> Result<(), String> {
    db::save_workspace(&state.db.lock(), &workspace)?;
    maybe_git_export(&state);
    Ok(())
}

#[tauri::command]
fn collection_list(state: State<AppState>) -> Result<Vec<Collection>, String> {
    db::list_collections(&state.db.lock())
}

#[tauri::command]
fn collection_save(state: State<AppState>, collection: Collection) -> Result<(), String> {
    db::save_collection(&state.db.lock(), &collection)?;
    maybe_git_export(&state);
    Ok(())
}

#[tauri::command]
fn collection_delete(state: State<AppState>, id: String) -> Result<(), String> {
    db::delete_collection(&state.db.lock(), &id)?;
    maybe_git_export(&state);
    Ok(())
}

#[tauri::command]
fn folder_list(state: State<AppState>) -> Result<Vec<Folder>, String> {
    db::list_folders(&state.db.lock())
}

#[tauri::command]
fn folder_save(state: State<AppState>, folder: Folder) -> Result<(), String> {
    db::save_folder(&state.db.lock(), &folder)?;
    maybe_git_export(&state);
    Ok(())
}

#[tauri::command]
fn folder_delete(state: State<AppState>, id: String) -> Result<(), String> {
    db::delete_folder(&state.db.lock(), &id)?;
    maybe_git_export(&state);
    Ok(())
}

#[tauri::command]
fn request_list(state: State<AppState>) -> Result<Vec<HttpRequestRecord>, String> {
    db::list_requests(&state.db.lock())
}

#[tauri::command]
fn request_get(state: State<AppState>, id: String) -> Result<Option<HttpRequestRecord>, String> {
    db::get_request(&state.db.lock(), &id)
}

#[tauri::command]
fn request_save(state: State<AppState>, request: HttpRequestRecord) -> Result<(), String> {
    db::save_request(&state.db.lock(), &request)?;
    maybe_git_export(&state);
    Ok(())
}

#[tauri::command]
fn request_delete(state: State<AppState>, id: String) -> Result<(), String> {
    db::delete_request(&state.db.lock(), &id)?;
    maybe_git_export(&state);
    Ok(())
}

#[tauri::command]
fn environment_list(state: State<AppState>) -> Result<Vec<Environment>, String> {
    db::list_environments(&state.db.lock())
}

#[tauri::command]
fn environment_save(state: State<AppState>, environment: Environment) -> Result<(), String> {
    db::save_environment(&state.db.lock(), &environment)?;
    maybe_git_export(&state);
    Ok(())
}

#[tauri::command]
fn environment_delete(state: State<AppState>, id: String) -> Result<(), String> {
    db::delete_environment(&state.db.lock(), &id)?;
    maybe_git_export(&state);
    Ok(())
}

#[tauri::command]
fn environment_set_active(state: State<AppState>, id: String) -> Result<(), String> {
    db::set_active_environment(&state.db.lock(), &id)?;
    maybe_git_export(&state);
    Ok(())
}

#[tauri::command]
fn secret_list(state: State<AppState>) -> Result<Vec<Secret>, String> {
    db::list_secrets(&state.db.lock())
}

#[tauri::command]
fn secret_set(state: State<AppState>, secret: Secret) -> Result<(), String> {
    db::set_secret(&state.db.lock(), &secret)
}

#[tauri::command]
fn secret_delete(state: State<AppState>, name: String) -> Result<(), String> {
    db::delete_secret(&state.db.lock(), &name)
}

#[tauri::command]
fn cookie_list(state: State<AppState>) -> Result<Vec<CookieRecord>, String> {
    db::list_cookies(&state.db.lock())
}

#[tauri::command]
fn cookie_upsert(state: State<AppState>, cookie: CookieRecord) -> Result<(), String> {
    db::upsert_cookie(&state.db.lock(), &cookie)
}

#[tauri::command]
fn cookie_delete(state: State<AppState>, id: String) -> Result<(), String> {
    db::delete_cookie(&state.db.lock(), &id)
}

#[tauri::command]
fn cookie_clear(state: State<AppState>) -> Result<(), String> {
    db::clear_cookies(&state.db.lock())
}

#[tauri::command]
fn history_list(state: State<AppState>) -> Result<Vec<HistoryEntry>, String> {
    db::list_history(&state.db.lock())
}

#[tauri::command]
fn history_clear(state: State<AppState>) -> Result<(), String> {
    db::clear_history(&state.db.lock())
}

#[tauri::command]
async fn oauth_client_credentials(params: OauthParams) -> Result<OauthTokens, String> {
    oauth::client_credentials(params).await
}

#[tauri::command]
async fn oauth_authorize(app: AppHandle, params: OauthParams) -> Result<OauthTokens, String> {
    oauth::authorize(app, params).await
}

async fn maybe_refresh_oauth(payload: &mut HttpSendPayload) -> Result<(), String> {
    if payload.auth.kind != "oauth2" {
        return Ok(());
    }
    if !oauth::token_expired(&payload.auth.expires_at) && !payload.auth.access_token.is_empty()
    {
        return Ok(());
    }
    let params = oauth::params_from_auth(&payload.auth);
    let tokens = if payload.auth.grant == "authorization_code" && !payload.auth.refresh_token.is_empty()
    {
        oauth::refresh(&params, &payload.auth.refresh_token).await?
    } else if payload.auth.grant == "client_credentials" || payload.auth.grant.is_empty() {
        oauth::client_credentials(params).await?
    } else {
        return Ok(());
    };
    payload.auth.access_token = tokens.access_token;
    if !tokens.refresh_token.is_empty() {
        payload.auth.refresh_token = tokens.refresh_token;
    }
    payload.auth.expires_at = tokens.expires_at;
    Ok(())
}

fn persist_oauth_tokens(state: &AppState, payload: &HttpSendPayload) {
    let Some(id) = &payload.request_id else {
        return;
    };
    let Ok(Some(mut request)) = db::get_request(&state.db.lock(), id) else {
        return;
    };
    request.auth.access_token = payload.auth.access_token.clone();
    request.auth.refresh_token = payload.auth.refresh_token.clone();
    request.auth.expires_at = payload.auth.expires_at.clone();
    let _ = db::save_request(&state.db.lock(), &request);
}

fn attach_cookies(state: &AppState, payload: &mut HttpSendPayload) {
    let Ok(parsed) = url::Url::parse(&payload.url) else {
        return;
    };
    let host = parsed.host_str().unwrap_or("");
    let path = parsed.path();
    let secure = parsed.scheme() == "https";
    let list = db::list_cookies(&state.db.lock()).unwrap_or_default();
    if let Some(header) = cookies::cookie_header_for(host, path, secure, &list) {
        if !payload
            .headers
            .iter()
            .any(|(k, _)| k.eq_ignore_ascii_case("cookie"))
        {
            payload.headers.push(("Cookie".into(), header));
        }
    }
}

fn store_set_cookies(state: &AppState, url: &str, headers: &[(String, String)]) {
    let Ok(parsed) = url::Url::parse(url) else {
        return;
    };
    let host = parsed.host_str().unwrap_or("");
    let path = parsed.path();
    for (name, value) in headers {
        if name.eq_ignore_ascii_case("set-cookie") {
            if let Some(cookie) = cookies::parse_set_cookie(value, host, path) {
                let _ = db::upsert_cookie(&state.db.lock(), &cookie);
            }
        }
    }
}

#[tauri::command]
async fn http_send(
    state: State<'_, AppState>,
    mut payload: HttpSendPayload,
) -> Result<HttpSendResult, String> {
    let token = CancellationToken::new();
    {
        state
            .cancels
            .lock()
            .insert(payload.id.clone(), token.clone());
    }
    attach_cookies(&state, &mut payload);
    let _ = maybe_refresh_oauth(&mut payload).await;
    persist_oauth_tokens(&state, &payload);

    let send_id = payload.id.clone();
    let workspace_id = payload.workspace_id.clone();
    let request_id = payload.request_id.clone();
    let method = payload.method.clone();
    let url = payload.url.clone();

    let mut result = http::send(payload.clone(), token.clone()).await;
    if result.status == Some(401)
        && payload.auth.kind == "oauth2"
        && !payload.auth.refresh_token.is_empty()
    {
        if let Ok(tokens) = oauth::refresh(&oauth::params_from_auth(&payload.auth), &payload.auth.refresh_token)
            .await
        {
            payload.auth.access_token = tokens.access_token;
            if !tokens.refresh_token.is_empty() {
                payload.auth.refresh_token = tokens.refresh_token;
            }
            payload.auth.expires_at = tokens.expires_at;
            persist_oauth_tokens(&state, &payload);
            result = http::send(payload.clone(), token).await;
        }
    }

    state.cancels.lock().remove(&send_id);
    if result.ok {
        store_set_cookies(&state, &url, &result.headers);
    }

    if !result.cancelled {
        let entry = HistoryEntry {
            id: Uuid::new_v4().to_string(),
            workspace_id,
            request_id,
            method,
            url,
            status: result.status,
            duration_ms: Some(result.duration_ms),
            at: db::now(),
        };
        let _ = db::insert_history(&state.db.lock(), &entry);
    }
    Ok(result)
}

#[tauri::command]
fn http_cancel(state: State<AppState>, id: String) -> Result<(), String> {
    if let Some(token) = state.cancels.lock().get(&id) {
        token.cancel();
    }
    Ok(())
}

#[tauri::command]
fn webhook_status(state: State<AppState>) -> WebhookStatus {
    merge_webhook_status(&state)
}

#[tauri::command]
async fn webhook_start(
    app: AppHandle,
    state: State<'_, AppState>,
    port: u16,
) -> Result<WebhookStatus, String> {
    if state.webhook.lock().is_some() {
        return Ok(merge_webhook_status(&state));
    }
    let db = state.db.clone();
    let (handle, _status) = webhook::start(app, db, port).await?;
    *state.webhook.lock() = Some(handle);
    Ok(merge_webhook_status(&state))
}

#[tauri::command]
fn webhook_stop(state: State<AppState>) -> Result<WebhookStatus, String> {
    if let Some(handle) = state.webhook.lock().take() {
        handle.cancel.cancel();
    }
    stop_tunnel(&state);
    Ok(merge_webhook_status(&state))
}

#[tauri::command]
async fn webhook_tunnel_start(state: State<'_, AppState>) -> Result<WebhookStatus, String> {
    let settings = db::get_app_settings(&state.db.lock())?;
    if settings.plan != "pro" {
        return Err("El túnel público es una función Pro. Actívalo en Planes o Ajustes.".into());
    }
    let port = state
        .webhook
        .lock()
        .as_ref()
        .map(|h| h.port)
        .ok_or_else(|| "Arranca el inbox local antes de abrir el túnel.".to_string())?;
    if state.tunnel.lock().is_some() {
        return Ok(merge_webhook_status(&state));
    }
    match tunnel::start(port).await {
        Ok(handle) => {
            *state.tunnel.lock() = Some(handle);
            Ok(merge_webhook_status(&state))
        }
        Err(err) => {
            let mut status = merge_webhook_status(&state);
            status.tunnel_error = err.clone();
            Err(err)
        }
    }
}

#[tauri::command]
fn webhook_tunnel_stop(state: State<AppState>) -> Result<WebhookStatus, String> {
    stop_tunnel(&state);
    Ok(merge_webhook_status(&state))
}

#[tauri::command]
fn webhook_events(state: State<AppState>) -> Result<Vec<WebhookEvent>, String> {
    db::list_webhooks(&state.db.lock())
}

#[tauri::command]
fn webhook_clear(state: State<AppState>) -> Result<(), String> {
    db::clear_webhooks(&state.db.lock())
}

#[tauri::command]
fn settings_get(state: State<AppState>) -> Result<AppSettings, String> {
    db::get_app_settings(&state.db.lock())
}

#[tauri::command]
fn settings_save(state: State<AppState>, settings: AppSettings) -> Result<AppSettings, String> {
    if settings.plan != "pro" && state.tunnel.lock().is_some() {
        stop_tunnel(&state);
    }
    db::save_app_settings(&state.db.lock(), &settings)?;
    db::get_app_settings(&state.db.lock())
}

#[tauri::command]
fn snapshot_get(state: State<AppState>, id: String) -> Result<Option<ResponseSnapshot>, String> {
    db::get_snapshot(&state.db.lock(), &id)
}

#[tauri::command]
fn snapshot_put(state: State<AppState>, snapshot: ResponseSnapshot) -> Result<(), String> {
    db::upsert_snapshot(&state.db.lock(), &snapshot)
}

#[tauri::command]
async fn git_folder_pick() -> Result<Option<String>, String> {
    tokio::task::spawn_blocking(|| {
        rfd::FileDialog::new()
            .set_title("Carpeta Git de openDobin")
            .pick_folder()
            .map(|p| p.to_string_lossy().into_owned())
    })
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
fn git_folder_link(state: State<AppState>, folder: String) -> Result<GitSyncResult, String> {
    let path = PathBuf::from(&folder);
    if !path.is_dir() {
        return Err("Esa ruta no es una carpeta.".into());
    }
    let imported = gitsync::has_workspace_file(&path);
    let mtime = if imported {
        gitsync::import_all(&state.db.lock(), &path)?
    } else {
        gitsync::export_all(&state.db.lock(), &path)?
    };
    *state.git_mtime.lock() = mtime;
    let mut settings = db::get_app_settings(&state.db.lock())?;
    settings.git_folder = folder.clone();
    db::save_app_settings(&state.db.lock(), &settings)?;
    Ok(GitSyncResult {
        folder,
        imported,
        exported: !imported,
        changed: imported,
        message: if imported {
            "Carpeta vinculada. Se importaron los ficheros.".into()
        } else {
            "Carpeta vinculada. Se escribieron las colecciones actuales.".into()
        },
    })
}

#[tauri::command]
fn git_folder_unlink(state: State<AppState>) -> Result<AppSettings, String> {
    let mut settings = db::get_app_settings(&state.db.lock())?;
    settings.git_folder = String::new();
    db::save_app_settings(&state.db.lock(), &settings)?;
    *state.git_mtime.lock() = 0;
    Ok(settings)
}

#[tauri::command]
fn git_sync_now(state: State<AppState>) -> Result<GitSyncResult, String> {
    let folder = git_folder(&state);
    if folder.is_empty() {
        return Err("No hay carpeta Git vinculada.".into());
    }
    let path = PathBuf::from(&folder);
    let mtime = gitsync::export_all(&state.db.lock(), &path)?;
    *state.git_mtime.lock() = mtime;
    Ok(GitSyncResult {
        folder,
        imported: false,
        exported: true,
        changed: false,
        message: "Colecciones escritas en la carpeta Git.".into(),
    })
}

#[tauri::command]
fn git_sync_poll(state: State<AppState>) -> Result<GitSyncResult, String> {
    let folder = git_folder(&state);
    if folder.is_empty() {
        return Ok(GitSyncResult {
            folder: String::new(),
            imported: false,
            exported: false,
            changed: false,
            message: String::new(),
        });
    }
    let path = PathBuf::from(&folder);
    if !gitsync::has_workspace_file(&path) {
        return Ok(GitSyncResult {
            folder,
            imported: false,
            exported: false,
            changed: false,
            message: String::new(),
        });
    }
    let disk = gitsync::max_mtime(&path);
    let last = *state.git_mtime.lock();
    if disk <= last {
        return Ok(GitSyncResult {
            folder,
            imported: false,
            exported: false,
            changed: false,
            message: String::new(),
        });
    }
    gitsync::import_all(&state.db.lock(), &path)?;
    *state.git_mtime.lock() = disk;
    Ok(GitSyncResult {
        folder,
        imported: true,
        exported: false,
        changed: true,
        message: "La carpeta Git cambió. Se actualizó el workspace.".into(),
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let state = AppState::init(&app.handle())?;
            app.manage(state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            workspace_get,
            workspace_save,
            collection_list,
            collection_save,
            collection_delete,
            folder_list,
            folder_save,
            folder_delete,
            request_list,
            request_get,
            request_save,
            request_delete,
            environment_list,
            environment_save,
            environment_delete,
            environment_set_active,
            secret_list,
            secret_set,
            secret_delete,
            cookie_list,
            cookie_upsert,
            cookie_delete,
            cookie_clear,
            history_list,
            history_clear,
            http_send,
            http_cancel,
            oauth_client_credentials,
            oauth_authorize,
            webhook_status,
            webhook_start,
            webhook_stop,
            webhook_tunnel_start,
            webhook_tunnel_stop,
            webhook_events,
            webhook_clear,
            settings_get,
            settings_save,
            snapshot_get,
            snapshot_put,
            git_folder_pick,
            git_folder_link,
            git_folder_unlink,
            git_sync_now,
            git_sync_poll
        ])
        .run(tauri::generate_context!())
        .expect("error while running openDobin");
}
