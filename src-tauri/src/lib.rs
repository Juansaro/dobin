mod cookies;
mod db;
mod http;
mod models;
mod oauth;
mod webhook;

use models::{
    Collection, CookieRecord, Environment, Folder, HistoryEntry, HttpRequestRecord, HttpSendPayload,
    HttpSendResult, OauthParams, OauthTokens, Secret, WebhookEvent, WebhookStatus, Workspace,
};
use parking_lot::Mutex;
use rusqlite::Connection;
use std::collections::HashMap;
use std::sync::Arc;
use tauri::{AppHandle, Manager, State};
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

pub struct AppState {
    db: Arc<Mutex<Connection>>,
    cancels: Mutex<HashMap<String, CancellationToken>>,
    webhook: Mutex<Option<webhook::WebhookHandle>>,
}

impl AppState {
    fn init(app: &AppHandle) -> Result<Self, String> {
        let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let conn = Connection::open(dir.join("opendobin.db")).map_err(|e| e.to_string())?;
        db::init(&conn)?;
        Ok(Self {
            db: Arc::new(Mutex::new(conn)),
            cancels: Mutex::new(HashMap::new()),
            webhook: Mutex::new(None),
        })
    }
}

#[tauri::command]
fn workspace_get(state: State<AppState>) -> Result<Workspace, String> {
    db::get_workspace(&state.db.lock())
}

#[tauri::command]
fn workspace_save(state: State<AppState>, workspace: Workspace) -> Result<(), String> {
    db::save_workspace(&state.db.lock(), &workspace)
}

#[tauri::command]
fn collection_list(state: State<AppState>) -> Result<Vec<Collection>, String> {
    db::list_collections(&state.db.lock())
}

#[tauri::command]
fn collection_save(state: State<AppState>, collection: Collection) -> Result<(), String> {
    db::save_collection(&state.db.lock(), &collection)
}

#[tauri::command]
fn collection_delete(state: State<AppState>, id: String) -> Result<(), String> {
    db::delete_collection(&state.db.lock(), &id)
}

#[tauri::command]
fn folder_list(state: State<AppState>) -> Result<Vec<Folder>, String> {
    db::list_folders(&state.db.lock())
}

#[tauri::command]
fn folder_save(state: State<AppState>, folder: Folder) -> Result<(), String> {
    db::save_folder(&state.db.lock(), &folder)
}

#[tauri::command]
fn folder_delete(state: State<AppState>, id: String) -> Result<(), String> {
    db::delete_folder(&state.db.lock(), &id)
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
    db::save_request(&state.db.lock(), &request)
}

#[tauri::command]
fn request_delete(state: State<AppState>, id: String) -> Result<(), String> {
    db::delete_request(&state.db.lock(), &id)
}

#[tauri::command]
fn environment_list(state: State<AppState>) -> Result<Vec<Environment>, String> {
    db::list_environments(&state.db.lock())
}

#[tauri::command]
fn environment_save(state: State<AppState>, environment: Environment) -> Result<(), String> {
    db::save_environment(&state.db.lock(), &environment)
}

#[tauri::command]
fn environment_delete(state: State<AppState>, id: String) -> Result<(), String> {
    db::delete_environment(&state.db.lock(), &id)
}

#[tauri::command]
fn environment_set_active(state: State<AppState>, id: String) -> Result<(), String> {
    db::set_active_environment(&state.db.lock(), &id)
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
    webhook::current_status(state.webhook.lock().as_ref())
}

#[tauri::command]
async fn webhook_start(
    app: AppHandle,
    state: State<'_, AppState>,
    port: u16,
) -> Result<WebhookStatus, String> {
    if let Some(current) = state.webhook.lock().as_ref() {
        return Ok(webhook::current_status(Some(current)));
    }
    let db = state.db.clone();
    let (handle, status) = webhook::start(app, db, port).await?;
    *state.webhook.lock() = Some(handle);
    Ok(status)
}

#[tauri::command]
fn webhook_stop(state: State<AppState>) -> Result<WebhookStatus, String> {
    if let Some(handle) = state.webhook.lock().take() {
        handle.cancel.cancel();
    }
    Ok(webhook::current_status(None))
}

#[tauri::command]
fn webhook_events(state: State<AppState>) -> Result<Vec<WebhookEvent>, String> {
    db::list_webhooks(&state.db.lock())
}

#[tauri::command]
fn webhook_clear(state: State<AppState>) -> Result<(), String> {
    db::clear_webhooks(&state.db.lock())
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
            webhook_events,
            webhook_clear
        ])
        .run(tauri::generate_context!())
        .expect("error while running openDobin");
}
