use crate::db;
use crate::models::{PERSONAL_WORKSPACE_ID, WebhookEvent, WebhookStatus};
use axum::body::Bytes;
use axum::extract::State;
use axum::http::{HeaderMap, Method, StatusCode, Uri};
use axum::response::Json;
use axum::routing::any;
use axum::Router;
use parking_lot::Mutex;
use rusqlite::Connection;
use serde_json::{json, Value};
use std::net::SocketAddr;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::net::TcpListener;
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

#[derive(Clone)]
struct Shared {
    app: AppHandle,
    db: Arc<Mutex<Connection>>,
}

pub struct WebhookHandle {
    pub port: u16,
    pub cancel: CancellationToken,
}

pub fn current_status(handle: Option<&WebhookHandle>) -> WebhookStatus {
    match handle {
        Some(h) => WebhookStatus {
            running: true,
            port: h.port,
            url: format!("http://127.0.0.1:{}/hook", h.port),
        },
        None => WebhookStatus {
            running: false,
            port: 0,
            url: String::new(),
        },
    }
}

pub async fn start(
    app: AppHandle,
    db: Arc<Mutex<Connection>>,
    port: u16,
) -> Result<(WebhookHandle, WebhookStatus), String> {
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let listener = TcpListener::bind(addr)
        .await
        .map_err(|e| format!("No se pudo abrir el puerto {port}: {e}"))?;
    let bound = listener
        .local_addr()
        .map_err(|e| e.to_string())?
        .port();

    let cancel = CancellationToken::new();
    let shutdown = cancel.clone();
    let shared = Shared { app, db };
    let router = Router::new()
        .route("/hook", any(capture))
        .route("/hook/{*rest}", any(capture))
        .fallback(capture)
        .with_state(shared);

    tokio::spawn(async move {
        let _ = axum::serve(listener, router)
            .with_graceful_shutdown(async move {
                shutdown.cancelled().await;
            })
            .await;
    });

    let handle = WebhookHandle {
        port: bound,
        cancel,
    };
    let status = current_status(Some(&handle));
    Ok((handle, status))
}

async fn capture(
    State(shared): State<Shared>,
    method: Method,
    uri: Uri,
    headers: HeaderMap,
    body: Bytes,
) -> (StatusCode, Json<Value>) {
    let header_pairs = headers
        .iter()
        .map(|(k, v)| (k.to_string(), v.to_str().unwrap_or("").to_string()))
        .collect::<Vec<_>>();
    let event = WebhookEvent {
        id: Uuid::new_v4().to_string(),
        workspace_id: PERSONAL_WORKSPACE_ID.into(),
        method: method.to_string(),
        path: uri.path().to_string(),
        query: uri.query().unwrap_or("").to_string(),
        headers: header_pairs,
        body: String::from_utf8_lossy(&body).to_string(),
        at: db::now(),
    };

    {
        let conn = shared.db.lock();
        let _ = db::insert_webhook(&conn, &event);
    }
    let _ = shared.app.emit("webhook:event", event.clone());

    (
        StatusCode::OK,
        Json(json!({ "ok": true, "id": event.id })),
    )
}
