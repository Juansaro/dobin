use crate::models::{AuthSpec, OauthParams, OauthTokens};
use axum::extract::Query;
use axum::response::Html;
use axum::routing::get;
use axum::Router;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use rand::RngCore;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;
use tokio::sync::oneshot;
use tokio_util::sync::CancellationToken;

#[derive(Deserialize)]
struct CallbackQuery {
    code: Option<String>,
    error: Option<String>,
    error_description: Option<String>,
}

pub async fn client_credentials(params: OauthParams) -> Result<OauthTokens, String> {
    token_request(
        &params.token_url,
        &[
            ("grant_type", "client_credentials"),
            ("client_id", params.client_id.as_str()),
            ("client_secret", params.client_secret.as_str()),
            ("scope", params.scopes.as_str()),
        ],
    )
    .await
}

pub async fn refresh(params: &OauthParams, refresh_token: &str) -> Result<OauthTokens, String> {
    token_request(
        &params.token_url,
        &[
            ("grant_type", "refresh_token"),
            ("refresh_token", refresh_token),
            ("client_id", params.client_id.as_str()),
            ("client_secret", params.client_secret.as_str()),
        ],
    )
    .await
}

pub async fn authorize(app: AppHandle, params: OauthParams) -> Result<OauthTokens, String> {
    let verifier = random_verifier();
    let challenge = pkce_challenge(&verifier);
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let redirect = format!("http://127.0.0.1:{port}/oauth/callback");
    let mut auth = url::Url::parse(&params.authorize_url).map_err(|e| e.to_string())?;
    {
        let mut q = auth.query_pairs_mut();
        q.append_pair("response_type", "code");
        q.append_pair("client_id", &params.client_id);
        q.append_pair("redirect_uri", &redirect);
        q.append_pair("code_challenge", &challenge);
        q.append_pair("code_challenge_method", "S256");
        if !params.scopes.is_empty() {
            q.append_pair("scope", &params.scopes);
        }
    }

    let (tx, rx) = oneshot::channel::<Result<String, String>>();
    let tx = Arc::new(Mutex::new(Some(tx)));
    let cancel = CancellationToken::new();
    let shutdown = cancel.clone();
    let router = Router::new().route(
        "/oauth/callback",
        get({
            let tx = tx.clone();
            move |Query(query): Query<CallbackQuery>| {
                let tx = tx.clone();
                async move {
                    let result = if let Some(err) = query.error {
                        Err(query.error_description.unwrap_or(err))
                    } else {
                        query
                            .code
                            .ok_or_else(|| "El proveedor no devolvió un code".to_string())
                    };
                    if let Some(sender) = tx.lock().unwrap().take() {
                        let _ = sender.send(result);
                    }
                    Html("<html><body>openDobin: ya puedes cerrar esta pestaña.</body></html>")
                }
            }
        }),
    );

    tokio::spawn(async move {
        let _ = axum::serve(listener, router)
            .with_graceful_shutdown(async move {
                shutdown.cancelled().await;
            })
            .await;
    });

    app.opener()
        .open_url(auth.as_str(), None::<&str>)
        .map_err(|e| e.to_string())?;

    let code = tokio::time::timeout(Duration::from_secs(180), rx)
        .await
        .map_err(|_| "Tiempo de espera del login OAuth".to_string())?
        .map_err(|_| "Callback OAuth cancelado".to_string())??;
    cancel.cancel();

    token_request(
        &params.token_url,
        &[
            ("grant_type", "authorization_code"),
            ("code", code.as_str()),
            ("redirect_uri", redirect.as_str()),
            ("client_id", params.client_id.as_str()),
            ("client_secret", params.client_secret.as_str()),
            ("code_verifier", verifier.as_str()),
        ],
    )
    .await
}

async fn token_request(token_url: &str, pairs: &[(&str, &str)]) -> Result<OauthTokens, String> {
    let body = pairs
        .iter()
        .filter(|(_, v)| !v.is_empty())
        .map(|(k, v)| format!("{}={}", urlencoding(k), urlencoding(v)))
        .collect::<Vec<_>>()
        .join("&");
    let client = reqwest::Client::new();
    let res = client
        .post(token_url)
        .header("Content-Type", "application/x-www-form-urlencoded")
        .body(body)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = res.status();
    let json: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(json
            .get("error_description")
            .or(json.get("error"))
            .and_then(|v| v.as_str())
            .unwrap_or("Error al pedir el token")
            .to_string());
    }
    let access = json
        .get("access_token")
        .and_then(|v| v.as_str())
        .ok_or("La respuesta no incluye access_token")?
        .to_string();
    let refresh_token = json
        .get("refresh_token")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let expires_in = json
        .get("expires_in")
        .and_then(|v| v.as_u64())
        .unwrap_or(3600);
    let expires_at = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
        + expires_in;
    Ok(OauthTokens {
        access_token: access,
        refresh_token,
        expires_at: expires_at.to_string(),
    })
}

fn random_verifier() -> String {
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    URL_SAFE_NO_PAD.encode(bytes)
}

fn pkce_challenge(verifier: &str) -> String {
    let digest = Sha256::digest(verifier.as_bytes());
    URL_SAFE_NO_PAD.encode(digest)
}

fn urlencoding(value: &str) -> String {
    url::form_urlencoded::byte_serialize(value.as_bytes()).collect()
}

pub fn token_expired(expires_at: &str) -> bool {
    let Ok(exp) = expires_at.parse::<u64>() else {
        return expires_at.is_empty();
    };
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    now + 30 >= exp
}

pub fn params_from_auth(auth: &AuthSpec) -> OauthParams {
    OauthParams {
        grant: auth.grant.clone(),
        token_url: auth.token_url.clone(),
        authorize_url: auth.authorize_url.clone(),
        client_id: auth.client_id.clone(),
        client_secret: auth.client_secret.clone(),
        scopes: auth.scopes.clone(),
    }
}
