use crate::models::{CookieRecord, PERSONAL_WORKSPACE_ID};
use uuid::Uuid;

pub fn parse_set_cookie(header: &str, request_host: &str, _request_path: &str) -> Option<CookieRecord> {
    let mut parts = header.split(';');
    let nv = parts.next()?.trim();
    let (name, value) = nv.split_once('=')?;
    if name.trim().is_empty() {
        return None;
    }
    let mut domain = request_host.to_string();
    let mut path = "/".to_string();
    let mut expires_at: Option<String> = None;
    let mut secure = false;
    let mut http_only = false;
    for part in parts {
        let part = part.trim();
        if part.eq_ignore_ascii_case("secure") {
            secure = true;
            continue;
        }
        if part.eq_ignore_ascii_case("httponly") {
            http_only = true;
            continue;
        }
        if let Some((k, v)) = part.split_once('=') {
            match k.trim().to_ascii_lowercase().as_str() {
                "domain" => domain = v.trim().trim_start_matches('.').to_string(),
                "path" => {
                    let p = v.trim();
                    path = if p.is_empty() { "/".into() } else { p.to_string() };
                }
                "expires" | "max-age" => expires_at = Some(v.trim().to_string()),
                _ => {}
            }
        }
    }
    Some(CookieRecord {
        id: Uuid::new_v4().to_string(),
        workspace_id: PERSONAL_WORKSPACE_ID.into(),
        domain,
        path,
        name: name.trim().to_string(),
        value: value.trim().to_string(),
        expires_at,
        secure,
        http_only,
    })
}

pub fn cookie_header_for(host: &str, path: &str, secure_url: bool, cookies: &[CookieRecord]) -> Option<String> {
    let mut pairs = Vec::new();
    for cookie in cookies {
        if cookie.secure && !secure_url {
            continue;
        }
        if !domain_matches(&cookie.domain, host) {
            continue;
        }
        if !path.starts_with(&cookie.path) && cookie.path != "/" {
            continue;
        }
        pairs.push(format!("{}={}", cookie.name, cookie.value));
    }
    if pairs.is_empty() {
        None
    } else {
        Some(pairs.join("; "))
    }
}

fn domain_matches(cookie_domain: &str, host: &str) -> bool {
    let domain = cookie_domain.trim_start_matches('.').to_ascii_lowercase();
    let host = host.to_ascii_lowercase();
    host == domain || host.ends_with(&format!(".{domain}"))
}
