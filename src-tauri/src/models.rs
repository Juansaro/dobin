use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Workspace {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub updated_at: String,
    #[serde(default)]
    pub variables: Vec<KvRow>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Collection {
    pub id: String,
    pub workspace_id: String,
    pub name: String,
    pub updated_at: String,
    #[serde(default)]
    pub variables: Vec<KvRow>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Folder {
    pub id: String,
    pub workspace_id: String,
    pub collection_id: String,
    pub parent_id: Option<String>,
    pub name: String,
    pub sort_order: i64,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KvRow {
    pub id: String,
    pub key: String,
    pub value: String,
    pub enabled: bool,
    #[serde(default)]
    pub secret: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PreStep {
    pub id: String,
    #[serde(default)]
    pub kind: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default)]
    pub scope: String,
    #[serde(default)]
    pub key: String,
    #[serde(default)]
    pub value: String,
    #[serde(default)]
    pub format: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Assertion {
    pub id: String,
    #[serde(default)]
    pub kind: String,
    #[serde(default)]
    pub op: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default)]
    pub header_name: String,
    #[serde(default)]
    pub expected: String,
    #[serde(default)]
    pub min: i64,
    #[serde(default)]
    pub max: i64,
    #[serde(default)]
    pub path: String,
}

fn default_true() -> bool {
    true
}

fn default_utf8() -> String {
    "utf8".into()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RequestBody {
    #[serde(rename = "type")]
    pub kind: String,
    pub content: String,
    pub form: Vec<KvRow>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthSpec {
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(default)]
    pub token: String,
    #[serde(default)]
    pub username: String,
    #[serde(default)]
    pub password: String,
    #[serde(default)]
    pub api_key_in: String,
    #[serde(default)]
    pub key_name: String,
    #[serde(default)]
    pub grant: String,
    #[serde(default)]
    pub token_url: String,
    #[serde(default)]
    pub authorize_url: String,
    #[serde(default)]
    pub client_id: String,
    #[serde(default)]
    pub client_secret: String,
    #[serde(default)]
    pub scopes: String,
    #[serde(default)]
    pub access_token: String,
    #[serde(default)]
    pub refresh_token: String,
    #[serde(default)]
    pub expires_at: String,
}

impl Default for AuthSpec {
    fn default() -> Self {
        Self {
            kind: "none".into(),
            token: String::new(),
            username: String::new(),
            password: String::new(),
            api_key_in: "header".into(),
            key_name: String::new(),
            grant: "client_credentials".into(),
            token_url: String::new(),
            authorize_url: String::new(),
            client_id: String::new(),
            client_secret: String::new(),
            scopes: String::new(),
            access_token: String::new(),
            refresh_token: String::new(),
            expires_at: String::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpRequestRecord {
    pub id: String,
    pub workspace_id: String,
    pub collection_id: String,
    pub folder_id: Option<String>,
    pub name: String,
    pub method: String,
    pub url: String,
    pub headers: Vec<KvRow>,
    pub query: Vec<KvRow>,
    pub body: RequestBody,
    pub auth: AuthSpec,
    #[serde(default)]
    pub pre_request: Vec<PreStep>,
    #[serde(default)]
    pub tests: Vec<Assertion>,
    pub sort_order: i64,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Environment {
    pub id: String,
    pub workspace_id: String,
    pub name: String,
    pub variables: Vec<KvRow>,
    pub is_active: bool,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Secret {
    pub id: String,
    pub workspace_id: String,
    pub name: String,
    pub value: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CookieRecord {
    pub id: String,
    pub workspace_id: String,
    pub domain: String,
    pub path: String,
    pub name: String,
    pub value: String,
    pub expires_at: Option<String>,
    pub secure: bool,
    pub http_only: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryEntry {
    pub id: String,
    pub workspace_id: String,
    pub request_id: Option<String>,
    pub method: String,
    pub url: String,
    pub status: Option<u16>,
    pub duration_ms: Option<u64>,
    pub at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebhookEvent {
    pub id: String,
    pub workspace_id: String,
    pub method: String,
    pub path: String,
    pub query: String,
    pub headers: Vec<(String, String)>,
    pub body: String,
    pub at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Timings {
    pub dns_ms: Option<u64>,
    pub tcp_ms: Option<u64>,
    pub tls_ms: Option<u64>,
    pub ttfb_ms: Option<u64>,
    pub total_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpSendPayload {
    pub id: String,
    pub method: String,
    pub url: String,
    pub headers: Vec<(String, String)>,
    pub body: Option<String>,
    pub timeout_ms: u64,
    pub follow_redirects: bool,
    pub accept_invalid_certs: bool,
    pub auth: AuthSpec,
    pub workspace_id: String,
    pub request_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpSendResult {
    pub ok: bool,
    pub cancelled: bool,
    pub error: Option<String>,
    pub status: Option<u16>,
    pub status_text: Option<String>,
    pub headers: Vec<(String, String)>,
    pub body: String,
    pub truncated: bool,
    pub duration_ms: u64,
    #[serde(default)]
    pub content_type: Option<String>,
    #[serde(default = "default_utf8")]
    pub body_encoding: String,
    #[serde(default)]
    pub timings: Timings,
}

impl HttpSendResult {
    pub fn cancelled() -> Self {
        Self {
            ok: false,
            cancelled: true,
            error: Some("Cancelado".into()),
            status: None,
            status_text: None,
            headers: vec![],
            body: String::new(),
            truncated: false,
            duration_ms: 0,
            content_type: None,
            body_encoding: "utf8".into(),
            timings: Timings::default(),
        }
    }

    pub fn fail(error: impl Into<String>, duration_ms: u64) -> Self {
        Self {
            ok: false,
            cancelled: false,
            error: Some(error.into()),
            status: None,
            status_text: None,
            headers: vec![],
            body: String::new(),
            truncated: false,
            duration_ms,
            content_type: None,
            body_encoding: "utf8".into(),
            timings: Timings {
                total_ms: duration_ms,
                ..Timings::default()
            },
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebhookStatus {
    pub running: bool,
    pub port: u16,
    pub url: String,
    #[serde(default)]
    pub public_url: String,
    #[serde(default)]
    pub tunnel_running: bool,
    #[serde(default)]
    pub tunnel_error: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResponseSnapshot {
    pub request_id: String,
    pub status: u16,
    pub headers: Vec<(String, String)>,
    pub body: String,
    pub encoding: String,
    pub content_type: Option<String>,
    pub at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub plan: String,
    pub git_folder: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitSyncResult {
    pub folder: String,
    pub imported: bool,
    pub exported: bool,
    pub changed: bool,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OauthParams {
    pub grant: String,
    pub token_url: String,
    pub authorize_url: String,
    pub client_id: String,
    pub client_secret: String,
    pub scopes: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OauthTokens {
    pub access_token: String,
    pub refresh_token: String,
    pub expires_at: String,
}

pub const PERSONAL_WORKSPACE_ID: &str = "personal-local";
pub const MAX_BODY_BYTES: usize = 2_000_000;
pub const HISTORY_LIMIT: i64 = 200;
pub const WEBHOOK_LIMIT: i64 = 200;
