use crate::models::{
    AuthSpec, Collection, CookieRecord, Environment, Folder, HISTORY_LIMIT, HistoryEntry,
    HttpRequestRecord, KvRow, PERSONAL_WORKSPACE_ID, RequestBody, Secret, WEBHOOK_LIMIT,
    WebhookEvent, Workspace,
};
use rusqlite::{params, Connection, OptionalExtension};
use uuid::Uuid;

pub fn now() -> String {
    chrono::Utc::now().to_rfc3339()
}

pub fn init(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        r#"
        PRAGMA foreign_keys = ON;
        CREATE TABLE IF NOT EXISTS workspaces (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            kind TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS collections (
            id TEXT PRIMARY KEY,
            workspace_id TEXT NOT NULL,
            name TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS requests (
            id TEXT PRIMARY KEY,
            workspace_id TEXT NOT NULL,
            collection_id TEXT NOT NULL,
            folder_id TEXT,
            name TEXT NOT NULL,
            method TEXT NOT NULL,
            url TEXT NOT NULL,
            headers TEXT NOT NULL,
            query TEXT NOT NULL,
            body TEXT NOT NULL,
            auth TEXT NOT NULL,
            sort_order INTEGER NOT NULL DEFAULT 0,
            updated_at TEXT NOT NULL,
            FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
            FOREIGN KEY (collection_id) REFERENCES collections(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS environments (
            id TEXT PRIMARY KEY,
            workspace_id TEXT NOT NULL,
            name TEXT NOT NULL,
            variables TEXT NOT NULL,
            is_active INTEGER NOT NULL DEFAULT 0,
            updated_at TEXT NOT NULL,
            FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS history (
            id TEXT PRIMARY KEY,
            workspace_id TEXT NOT NULL,
            request_id TEXT,
            method TEXT NOT NULL,
            url TEXT NOT NULL,
            status INTEGER,
            duration_ms INTEGER,
            at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS webhook_events (
            id TEXT PRIMARY KEY,
            workspace_id TEXT NOT NULL,
            method TEXT NOT NULL,
            path TEXT NOT NULL,
            query TEXT,
            headers TEXT NOT NULL,
            body TEXT,
            at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS folders (
            id TEXT PRIMARY KEY,
            workspace_id TEXT NOT NULL,
            collection_id TEXT NOT NULL,
            parent_id TEXT,
            name TEXT NOT NULL,
            sort_order INTEGER NOT NULL DEFAULT 0,
            updated_at TEXT NOT NULL,
            FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
            FOREIGN KEY (collection_id) REFERENCES collections(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS secrets (
            id TEXT PRIMARY KEY,
            workspace_id TEXT NOT NULL,
            name TEXT NOT NULL,
            value TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            UNIQUE (workspace_id, name),
            FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS cookies (
            id TEXT PRIMARY KEY,
            workspace_id TEXT NOT NULL,
            domain TEXT NOT NULL,
            path TEXT NOT NULL,
            name TEXT NOT NULL,
            value TEXT NOT NULL,
            expires_at TEXT,
            secure INTEGER NOT NULL DEFAULT 0,
            http_only INTEGER NOT NULL DEFAULT 0,
            UNIQUE (workspace_id, domain, path, name),
            FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
        );
        "#,
    )
    .map_err(|e| e.to_string())?;
    add_column_if_missing(conn, "workspaces", "variables", "TEXT NOT NULL DEFAULT '[]'")?;
    add_column_if_missing(conn, "collections", "variables", "TEXT NOT NULL DEFAULT '[]'")?;
    add_column_if_missing(conn, "requests", "pre_request", "TEXT NOT NULL DEFAULT '[]'")?;
    add_column_if_missing(conn, "requests", "tests", "TEXT NOT NULL DEFAULT '[]'")?;
    seed(conn)
}

fn add_column_if_missing(
    conn: &Connection,
    table: &str,
    column: &str,
    decl: &str,
) -> Result<(), String> {
    let mut stmt = conn
        .prepare(&format!("PRAGMA table_info({table})"))
        .map_err(|e| e.to_string())?;
    let exists = stmt
        .query_map([], |r| r.get::<_, String>(1))
        .map_err(|e| e.to_string())?
        .filter_map(|name| name.ok())
        .any(|name| name == column);
    if !exists {
        conn.execute(&format!("ALTER TABLE {table} ADD COLUMN {column} {decl}"), [])
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn empty_kv() -> Vec<KvRow> {
    vec![]
}

fn seed(conn: &Connection) -> Result<(), String> {
    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM workspaces", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    if count > 0 {
        return Ok(());
    }

    let ts = now();
    conn.execute(
        "INSERT INTO workspaces (id, name, kind, updated_at) VALUES (?1, ?2, ?3, ?4)",
        params![PERSONAL_WORKSPACE_ID, "Personal", "personal", ts],
    )
    .map_err(|e| e.to_string())?;

    let collection_id = Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO collections (id, workspace_id, name, updated_at) VALUES (?1, ?2, ?3, ?4)",
        params![collection_id, PERSONAL_WORKSPACE_ID, "Ejemplos", ts],
    )
    .map_err(|e| e.to_string())?;

    let env_id = Uuid::new_v4().to_string();
    let variables = vec![KvRow {
        id: Uuid::new_v4().to_string(),
        key: "baseUrl".into(),
        value: "https://jsonplaceholder.typicode.com".into(),
        enabled: true,
        secret: false,
    }];
    conn.execute(
        "INSERT INTO environments (id, workspace_id, name, variables, is_active, updated_at)
         VALUES (?1, ?2, ?3, ?4, 1, ?5)",
        params![
            env_id,
            PERSONAL_WORKSPACE_ID,
            "Dev",
            serde_json::to_string(&variables).unwrap(),
            ts
        ],
    )
    .map_err(|e| e.to_string())?;

    let get_id = Uuid::new_v4().to_string();
    let get_req = HttpRequestRecord {
        id: get_id.clone(),
        workspace_id: PERSONAL_WORKSPACE_ID.into(),
        collection_id: collection_id.clone(),
        folder_id: None,
        name: "Listar todo".into(),
        method: "GET".into(),
        url: "{{baseUrl}}/todos/1".into(),
        headers: empty_kv(),
        query: empty_kv(),
        body: RequestBody {
            kind: "none".into(),
            content: String::new(),
            form: empty_kv(),
        },
        auth: AuthSpec {
            kind: "none".into(),
            ..AuthSpec::default()
        },
        pre_request: vec![],
        tests: vec![],
        sort_order: 0,
        updated_at: ts.clone(),
    };
    insert_request(conn, &get_req)?;

    let post_req = HttpRequestRecord {
        id: Uuid::new_v4().to_string(),
        workspace_id: PERSONAL_WORKSPACE_ID.into(),
        collection_id,
        folder_id: None,
        name: "Crear post".into(),
        method: "POST".into(),
        url: "{{baseUrl}}/posts".into(),
        headers: vec![KvRow {
            id: Uuid::new_v4().to_string(),
            key: "Content-Type".into(),
            value: "application/json".into(),
            enabled: true,
            secret: false,
        }],
        query: empty_kv(),
        body: RequestBody {
            kind: "json".into(),
            content: "{\n  \"title\": \"openDobin\",\n  \"body\": \"Hola desde el cliente HTTP\",\n  \"userId\": 1\n}".into(),
            form: empty_kv(),
        },
        auth: AuthSpec {
            kind: "none".into(),
            ..AuthSpec::default()
        },
        pre_request: vec![],
        tests: vec![],
        sort_order: 1,
        updated_at: ts,
    };
    insert_request(conn, &post_req)?;
    Ok(())
}

pub fn get_workspace(conn: &Connection) -> Result<Workspace, String> {
    conn.query_row(
        "SELECT id, name, kind, updated_at, variables FROM workspaces WHERE id = ?1",
        params![PERSONAL_WORKSPACE_ID],
        |r| {
            let variables: String = r.get(4)?;
            Ok(Workspace {
                id: r.get(0)?,
                name: r.get(1)?,
                kind: r.get(2)?,
                updated_at: r.get(3)?,
                variables: serde_json::from_str(&variables).unwrap_or_default(),
            })
        },
    )
    .map_err(|e| e.to_string())
}

pub fn save_workspace(conn: &Connection, workspace: &Workspace) -> Result<(), String> {
    conn.execute(
        "UPDATE workspaces SET name = ?1, kind = ?2, updated_at = ?3, variables = ?4 WHERE id = ?5",
        params![
            workspace.name,
            workspace.kind,
            workspace.updated_at,
            serde_json::to_string(&workspace.variables).unwrap(),
            workspace.id
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn list_collections(conn: &Connection) -> Result<Vec<Collection>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, workspace_id, name, updated_at, variables FROM collections
             WHERE workspace_id = ?1 ORDER BY name COLLATE NOCASE",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![PERSONAL_WORKSPACE_ID], |r| {
            let variables: String = r.get(4)?;
            Ok(Collection {
                id: r.get(0)?,
                workspace_id: r.get(1)?,
                name: r.get(2)?,
                updated_at: r.get(3)?,
                variables: serde_json::from_str(&variables).unwrap_or_default(),
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

pub fn save_collection(conn: &Connection, col: &Collection) -> Result<(), String> {
    conn.execute(
        "INSERT INTO collections (id, workspace_id, name, updated_at, variables)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            updated_at = excluded.updated_at,
            variables = excluded.variables",
        params![
            col.id,
            col.workspace_id,
            col.name,
            col.updated_at,
            serde_json::to_string(&col.variables).unwrap()
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn delete_collection(conn: &Connection, id: &str) -> Result<(), String> {
    conn.execute("DELETE FROM collections WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

fn parse_request(r: &rusqlite::Row<'_>) -> rusqlite::Result<HttpRequestRecord> {
    let headers: String = r.get(7)?;
    let query: String = r.get(8)?;
    let body: String = r.get(9)?;
    let auth: String = r.get(10)?;
    let pre_request: String = r.get(13).unwrap_or_else(|_| "[]".into());
    let tests: String = r.get(14).unwrap_or_else(|_| "[]".into());
    Ok(HttpRequestRecord {
        id: r.get(0)?,
        workspace_id: r.get(1)?,
        collection_id: r.get(2)?,
        folder_id: r.get(3)?,
        name: r.get(4)?,
        method: r.get(5)?,
        url: r.get(6)?,
        headers: serde_json::from_str(&headers).unwrap_or_default(),
        query: serde_json::from_str(&query).unwrap_or_default(),
        body: serde_json::from_str(&body).unwrap_or(RequestBody {
            kind: "none".into(),
            content: String::new(),
            form: vec![],
        }),
        auth: serde_json::from_str(&auth).unwrap_or_default(),
        sort_order: r.get(11)?,
        updated_at: r.get(12)?,
        pre_request: serde_json::from_str(&pre_request).unwrap_or_default(),
        tests: serde_json::from_str(&tests).unwrap_or_default(),
    })
}

pub fn list_requests(conn: &Connection) -> Result<Vec<HttpRequestRecord>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, workspace_id, collection_id, folder_id, name, method, url,
                    headers, query, body, auth, sort_order, updated_at, pre_request, tests
             FROM requests WHERE workspace_id = ?1
             ORDER BY collection_id, sort_order, name COLLATE NOCASE",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![PERSONAL_WORKSPACE_ID], parse_request)
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

pub fn get_request(conn: &Connection, id: &str) -> Result<Option<HttpRequestRecord>, String> {
    conn.query_row(
        "SELECT id, workspace_id, collection_id, folder_id, name, method, url,
                headers, query, body, auth, sort_order, updated_at, pre_request, tests
         FROM requests WHERE id = ?1",
        params![id],
        parse_request,
    )
    .optional()
    .map_err(|e| e.to_string())
}

fn insert_request(conn: &Connection, req: &HttpRequestRecord) -> Result<(), String> {
    conn.execute(
        "INSERT INTO requests (
            id, workspace_id, collection_id, folder_id, name, method, url,
            headers, query, body, auth, sort_order, updated_at, pre_request, tests
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)
         ON CONFLICT(id) DO UPDATE SET
            collection_id = excluded.collection_id,
            folder_id = excluded.folder_id,
            name = excluded.name,
            method = excluded.method,
            url = excluded.url,
            headers = excluded.headers,
            query = excluded.query,
            body = excluded.body,
            auth = excluded.auth,
            sort_order = excluded.sort_order,
            updated_at = excluded.updated_at,
            pre_request = excluded.pre_request,
            tests = excluded.tests",
        params![
            req.id,
            req.workspace_id,
            req.collection_id,
            req.folder_id,
            req.name,
            req.method,
            req.url,
            serde_json::to_string(&req.headers).unwrap(),
            serde_json::to_string(&req.query).unwrap(),
            serde_json::to_string(&req.body).unwrap(),
            serde_json::to_string(&req.auth).unwrap(),
            req.sort_order,
            req.updated_at,
            serde_json::to_string(&req.pre_request).unwrap(),
            serde_json::to_string(&req.tests).unwrap(),
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn save_request(conn: &Connection, req: &HttpRequestRecord) -> Result<(), String> {
    insert_request(conn, req)
}

pub fn delete_request(conn: &Connection, id: &str) -> Result<(), String> {
    conn.execute("DELETE FROM requests WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn list_environments(conn: &Connection) -> Result<Vec<Environment>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, workspace_id, name, variables, is_active, updated_at
             FROM environments WHERE workspace_id = ?1 ORDER BY name COLLATE NOCASE",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![PERSONAL_WORKSPACE_ID], |r| {
            let variables: String = r.get(3)?;
            let active: i64 = r.get(4)?;
            Ok(Environment {
                id: r.get(0)?,
                workspace_id: r.get(1)?,
                name: r.get(2)?,
                variables: serde_json::from_str(&variables).unwrap_or_default(),
                is_active: active != 0,
                updated_at: r.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

pub fn save_environment(conn: &Connection, env: &Environment) -> Result<(), String> {
    conn.execute(
        "INSERT INTO environments (id, workspace_id, name, variables, is_active, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            variables = excluded.variables,
            is_active = excluded.is_active,
            updated_at = excluded.updated_at",
        params![
            env.id,
            env.workspace_id,
            env.name,
            serde_json::to_string(&env.variables).unwrap(),
            if env.is_active { 1 } else { 0 },
            env.updated_at
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn delete_environment(conn: &Connection, id: &str) -> Result<(), String> {
    conn.execute("DELETE FROM environments WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn set_active_environment(conn: &Connection, id: &str) -> Result<(), String> {
    conn.execute(
        "UPDATE environments SET is_active = 0 WHERE workspace_id = ?1",
        params![PERSONAL_WORKSPACE_ID],
    )
    .map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE environments SET is_active = 1, updated_at = ?1 WHERE id = ?2",
        params![now(), id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn list_history(conn: &Connection) -> Result<Vec<HistoryEntry>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, workspace_id, request_id, method, url, status, duration_ms, at
             FROM history WHERE workspace_id = ?1 ORDER BY at DESC LIMIT ?2",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![PERSONAL_WORKSPACE_ID, HISTORY_LIMIT], |r| {
            Ok(HistoryEntry {
                id: r.get(0)?,
                workspace_id: r.get(1)?,
                request_id: r.get(2)?,
                method: r.get(3)?,
                url: r.get(4)?,
                status: r.get::<_, Option<i64>>(5)?.map(|s| s as u16),
                duration_ms: r.get::<_, Option<i64>>(6)?.map(|s| s as u64),
                at: r.get(7)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

pub fn insert_history(conn: &Connection, entry: &HistoryEntry) -> Result<(), String> {
    conn.execute(
        "INSERT INTO history (id, workspace_id, request_id, method, url, status, duration_ms, at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            entry.id,
            entry.workspace_id,
            entry.request_id,
            entry.method,
            entry.url,
            entry.status.map(|s| s as i64),
            entry.duration_ms.map(|s| s as i64),
            entry.at
        ],
    )
    .map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM history WHERE workspace_id = ?1 AND id NOT IN (
            SELECT id FROM history WHERE workspace_id = ?1 ORDER BY at DESC LIMIT ?2
         )",
        params![PERSONAL_WORKSPACE_ID, HISTORY_LIMIT],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn clear_history(conn: &Connection) -> Result<(), String> {
    conn.execute(
        "DELETE FROM history WHERE workspace_id = ?1",
        params![PERSONAL_WORKSPACE_ID],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn list_webhooks(conn: &Connection) -> Result<Vec<WebhookEvent>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, workspace_id, method, path, query, headers, body, at
             FROM webhook_events WHERE workspace_id = ?1 ORDER BY at DESC LIMIT ?2",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![PERSONAL_WORKSPACE_ID, WEBHOOK_LIMIT], |r| {
            let headers: String = r.get(5)?;
            Ok(WebhookEvent {
                id: r.get(0)?,
                workspace_id: r.get(1)?,
                method: r.get(2)?,
                path: r.get(3)?,
                query: r.get(4)?,
                headers: serde_json::from_str(&headers).unwrap_or_default(),
                body: r.get::<_, Option<String>>(6)?.unwrap_or_default(),
                at: r.get(7)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

pub fn insert_webhook(conn: &Connection, event: &WebhookEvent) -> Result<(), String> {
    conn.execute(
        "INSERT INTO webhook_events (id, workspace_id, method, path, query, headers, body, at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            event.id,
            event.workspace_id,
            event.method,
            event.path,
            event.query,
            serde_json::to_string(&event.headers).unwrap(),
            event.body,
            event.at
        ],
    )
    .map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM webhook_events WHERE workspace_id = ?1 AND id NOT IN (
            SELECT id FROM webhook_events WHERE workspace_id = ?1 ORDER BY at DESC LIMIT ?2
         )",
        params![PERSONAL_WORKSPACE_ID, WEBHOOK_LIMIT],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn clear_webhooks(conn: &Connection) -> Result<(), String> {
    conn.execute(
        "DELETE FROM webhook_events WHERE workspace_id = ?1",
        params![PERSONAL_WORKSPACE_ID],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn list_folders(conn: &Connection) -> Result<Vec<Folder>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, workspace_id, collection_id, parent_id, name, sort_order, updated_at
             FROM folders WHERE workspace_id = ?1
             ORDER BY collection_id, sort_order, name COLLATE NOCASE",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![PERSONAL_WORKSPACE_ID], |r| {
            Ok(Folder {
                id: r.get(0)?,
                workspace_id: r.get(1)?,
                collection_id: r.get(2)?,
                parent_id: r.get(3)?,
                name: r.get(4)?,
                sort_order: r.get(5)?,
                updated_at: r.get(6)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

pub fn save_folder(conn: &Connection, folder: &Folder) -> Result<(), String> {
    conn.execute(
        "INSERT INTO folders (id, workspace_id, collection_id, parent_id, name, sort_order, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT(id) DO UPDATE SET
            parent_id = excluded.parent_id,
            name = excluded.name,
            sort_order = excluded.sort_order,
            updated_at = excluded.updated_at",
        params![
            folder.id,
            folder.workspace_id,
            folder.collection_id,
            folder.parent_id,
            folder.name,
            folder.sort_order,
            folder.updated_at
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn delete_folder(conn: &Connection, id: &str) -> Result<(), String> {
    let parent: Option<String> = conn
        .query_row(
            "SELECT parent_id FROM folders WHERE id = ?1",
            params![id],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?
        .flatten();
    conn.execute(
        "UPDATE requests SET folder_id = ?1 WHERE folder_id = ?2",
        params![parent, id],
    )
    .map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE folders SET parent_id = ?1 WHERE parent_id = ?2",
        params![parent, id],
    )
    .map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM folders WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn list_secrets(conn: &Connection) -> Result<Vec<Secret>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, workspace_id, name, value, updated_at
             FROM secrets WHERE workspace_id = ?1 ORDER BY name COLLATE NOCASE",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![PERSONAL_WORKSPACE_ID], |r| {
            Ok(Secret {
                id: r.get(0)?,
                workspace_id: r.get(1)?,
                name: r.get(2)?,
                value: r.get(3)?,
                updated_at: r.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

pub fn set_secret(conn: &Connection, secret: &Secret) -> Result<(), String> {
    conn.execute(
        "INSERT INTO secrets (id, workspace_id, name, value, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(workspace_id, name) DO UPDATE SET
            value = excluded.value,
            updated_at = excluded.updated_at",
        params![
            secret.id,
            secret.workspace_id,
            secret.name,
            secret.value,
            secret.updated_at
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn delete_secret(conn: &Connection, name: &str) -> Result<(), String> {
    conn.execute(
        "DELETE FROM secrets WHERE workspace_id = ?1 AND name = ?2",
        params![PERSONAL_WORKSPACE_ID, name],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn list_cookies(conn: &Connection) -> Result<Vec<CookieRecord>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, workspace_id, domain, path, name, value, expires_at, secure, http_only
             FROM cookies WHERE workspace_id = ?1 ORDER BY domain, name",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![PERSONAL_WORKSPACE_ID], |r| {
            let secure: i64 = r.get(7)?;
            let http_only: i64 = r.get(8)?;
            Ok(CookieRecord {
                id: r.get(0)?,
                workspace_id: r.get(1)?,
                domain: r.get(2)?,
                path: r.get(3)?,
                name: r.get(4)?,
                value: r.get(5)?,
                expires_at: r.get(6)?,
                secure: secure != 0,
                http_only: http_only != 0,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

pub fn upsert_cookie(conn: &Connection, cookie: &CookieRecord) -> Result<(), String> {
    conn.execute(
        "INSERT INTO cookies (id, workspace_id, domain, path, name, value, expires_at, secure, http_only)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
         ON CONFLICT(workspace_id, domain, path, name) DO UPDATE SET
            value = excluded.value,
            expires_at = excluded.expires_at,
            secure = excluded.secure,
            http_only = excluded.http_only",
        params![
            cookie.id,
            cookie.workspace_id,
            cookie.domain,
            cookie.path,
            cookie.name,
            cookie.value,
            cookie.expires_at,
            if cookie.secure { 1 } else { 0 },
            if cookie.http_only { 1 } else { 0 }
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn delete_cookie(conn: &Connection, id: &str) -> Result<(), String> {
    conn.execute("DELETE FROM cookies WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn clear_cookies(conn: &Connection) -> Result<(), String> {
    conn.execute(
        "DELETE FROM cookies WHERE workspace_id = ?1",
        params![PERSONAL_WORKSPACE_ID],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}
