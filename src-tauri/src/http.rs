use crate::models::{HttpSendPayload, HttpSendResult, MAX_BODY_BYTES, Timings};
use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use bytes::Bytes;
use http_body_util::{BodyExt, Full};
use hyper::client::conn::http1;
use hyper::Request;
use hyper_util::rt::TokioIo;
use std::time::{Duration, Instant};
use tokio::net::TcpStream;
use tokio_native_tls::TlsConnector;
use tokio_util::sync::CancellationToken;

pub async fn send(payload: HttpSendPayload, cancel: CancellationToken) -> HttpSendResult {
    tokio::select! {
        _ = cancel.cancelled() => HttpSendResult::cancelled(),
        res = send_inner(payload) => res,
    }
}

async fn send_inner(mut payload: HttpSendPayload) -> HttpSendResult {
    let started = Instant::now();
    let timeout = Duration::from_millis(payload.timeout_ms.clamp(1, 120_000));
    match tokio::time::timeout(timeout, send_with_redirects(&mut payload, started)).await {
        Ok(result) => result,
        Err(_) => HttpSendResult::fail("Tiempo de espera agotado", started.elapsed().as_millis() as u64),
    }
}

async fn send_with_redirects(
    payload: &mut HttpSendPayload,
    started: Instant,
) -> HttpSendResult {
    let mut hops = 0u8;
    let mut first_timings = None::<(Option<u64>, Option<u64>, Option<u64>)>;
    let mut method = payload.method.clone();
    let mut url = payload.url.clone();
    apply_auth(payload, &mut url);

    loop {
        let parsed = match url::Url::parse(&url) {
            Ok(u) => u,
            Err(e) => {
                return HttpSendResult::fail(
                    format!("URL inválida: {e}"),
                    started.elapsed().as_millis() as u64,
                )
            }
        };
        if parsed.scheme() != "http" && parsed.scheme() != "https" {
            return HttpSendResult::fail(
                "Solo se permiten http y https",
                started.elapsed().as_millis() as u64,
            );
        }

        let hop = match timed_hop(payload, &parsed, &method, &url).await {
            Ok(h) => h,
            Err(e) => {
                return HttpSendResult::fail(e, started.elapsed().as_millis() as u64)
            }
        };
        if first_timings.is_none() {
            first_timings = Some((hop.dns_ms, hop.tcp_ms, hop.tls_ms));
        }

        let redirect = payload.follow_redirects
            && hops < 10
            && matches!(hop.status, 301 | 302 | 303 | 307 | 308);
        if let Some(location) = hop.location.as_ref() {
            if redirect {
                hops += 1;
                let next = parsed.join(location).unwrap_or_else(|_| parsed.clone());
                url = next.to_string();
                if hop.status == 303 || hop.status == 302 {
                    method = "GET".into();
                    payload.body = None;
                }
                continue;
            }
        }

        let total_ms = started.elapsed().as_millis() as u64;
        let (dns_ms, tcp_ms, tls_ms) = first_timings.unwrap_or((None, None, None));
        return HttpSendResult {
            ok: true,
            cancelled: false,
            error: None,
            status: Some(hop.status),
            status_text: Some(hop.status_text),
            headers: hop.headers,
            body: hop.body,
            truncated: hop.truncated,
            duration_ms: total_ms,
            content_type: hop.content_type,
            body_encoding: hop.body_encoding,
            timings: Timings {
                dns_ms,
                tcp_ms,
                tls_ms,
                ttfb_ms: hop.ttfb_ms,
                total_ms,
            },
        };
    }
}

struct HopResult {
    status: u16,
    status_text: String,
    headers: Vec<(String, String)>,
    body: String,
    truncated: bool,
    content_type: Option<String>,
    body_encoding: String,
    dns_ms: Option<u64>,
    tcp_ms: Option<u64>,
    tls_ms: Option<u64>,
    ttfb_ms: Option<u64>,
    location: Option<String>,
}

async fn timed_hop(
    payload: &HttpSendPayload,
    parsed: &url::Url,
    method: &str,
    full_url: &str,
) -> Result<HopResult, String> {
    let host = parsed.host_str().ok_or("La URL no tiene host")?.to_string();
    let port = parsed.port_or_known_default().unwrap_or(80);
    let https = parsed.scheme() == "https";

    let dns_start = Instant::now();
    let mut addrs = tokio::net::lookup_host((host.as_str(), port))
        .await
        .map_err(|e| format!("DNS: {e}"))?;
    let addr = addrs.next().ok_or_else(|| "DNS no devolvió direcciones".to_string())?;
    let dns_ms = dns_start.elapsed().as_millis() as u64;

    let tcp_start = Instant::now();
    let tcp = TcpStream::connect(addr)
        .await
        .map_err(|e| format!("TCP: {e}"))?;
    let _ = tcp.set_nodelay(true);
    let tcp_ms = tcp_start.elapsed().as_millis() as u64;

    if https {
        let tls_start = Instant::now();
        let builder = native_tls::TlsConnector::builder()
            .danger_accept_invalid_certs(payload.accept_invalid_certs)
            .danger_accept_invalid_hostnames(payload.accept_invalid_certs)
            .build()
            .map_err(|e| e.to_string())?;
        let connector = TlsConnector::from(builder);
        let tls = connector
            .connect(&host, tcp)
            .await
            .map_err(|e| format!("TLS: {e}"))?;
        let tls_ms = tls_start.elapsed().as_millis() as u64;
        http1_exchange(payload, parsed, method, full_url, &host, port, tls, dns_ms, tcp_ms, Some(tls_ms)).await
    } else {
        http1_exchange(payload, parsed, method, full_url, &host, port, tcp, dns_ms, tcp_ms, None).await
    }
}

async fn http1_exchange<S>(
    payload: &HttpSendPayload,
    parsed: &url::Url,
    method: &str,
    _full_url: &str,
    host: &str,
    port: u16,
    stream: S,
    dns_ms: u64,
    tcp_ms: u64,
    tls_ms: Option<u64>,
) -> Result<HopResult, String>
where
    S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin + Send + 'static,
{
    let io = TokioIo::new(stream);
    let (mut sender, conn) = http1::handshake(io).await.map_err(|e| e.to_string())?;
    tokio::spawn(async move {
        let _ = conn.await;
    });

    let mut path = parsed.path().to_string();
    if path.is_empty() {
        path = "/".into();
    }
    if let Some(query) = parsed.query() {
        path.push('?');
        path.push_str(query);
    }

    let http_method = method
        .parse::<hyper::Method>()
        .map_err(|e| format!("Método inválido: {e}"))?;
    let mut builder = Request::builder().method(http_method).uri(path);
    let host_header = if parsed.port().is_some() {
        format!("{host}:{port}")
    } else {
        host.to_string()
    };
    builder = builder.header("Host", host_header);
    for (key, value) in &payload.headers {
        if key.trim().is_empty() || key.eq_ignore_ascii_case("host") {
            continue;
        }
        builder = builder.header(key, value);
    }

    let body_bytes = payload.body.clone().unwrap_or_default();
    let request = builder
        .body(Full::new(Bytes::from(body_bytes)))
        .map_err(|e| e.to_string())?;

    let ttfb_start = Instant::now();
    let response = sender.send_request(request).await.map_err(|e| e.to_string())?;
    let ttfb_ms = ttfb_start.elapsed().as_millis() as u64;

    let status = response.status();
    let status_text = status.canonical_reason().unwrap_or("").to_string();
    let mut content_type = None;
    let mut location = None;
    let headers = response
        .headers()
        .iter()
        .map(|(k, v)| {
            let value = v.to_str().unwrap_or("").to_string();
            if k.as_str().eq_ignore_ascii_case("content-type") {
                content_type = Some(value.clone());
            }
            if k.as_str().eq_ignore_ascii_case("location") {
                location = Some(value.clone());
            }
            (k.to_string(), value)
        })
        .collect::<Vec<_>>();

    let collected = response
        .into_body()
        .collect()
        .await
        .map_err(|e| e.to_string())?
        .to_bytes();
    let truncated = collected.len() > MAX_BODY_BYTES;
    let slice = if truncated {
        &collected[..MAX_BODY_BYTES]
    } else {
        &collected
    };
    let ct = content_type.clone().unwrap_or_default();
    let (body, body_encoding) = encode_body(slice, &ct);

    Ok(HopResult {
        status: status.as_u16(),
        status_text,
        headers,
        body,
        truncated,
        content_type,
        body_encoding,
        dns_ms: Some(dns_ms),
        tcp_ms: Some(tcp_ms),
        tls_ms,
        ttfb_ms: Some(ttfb_ms),
        location,
    })
}

fn encode_body(bytes: &[u8], content_type: &str) -> (String, String) {
    let ct = content_type.to_ascii_lowercase();
    let force_bin = ct.starts_with("image/") || ct.contains("octet-stream");
    if !force_bin {
        if let Ok(text) = std::str::from_utf8(bytes) {
            return (text.to_string(), "utf8".into());
        }
    }
    (STANDARD.encode(bytes), "base64".into())
}

fn apply_auth(payload: &mut HttpSendPayload, url: &mut String) {
    match payload.auth.kind.as_str() {
        "bearer" if !payload.auth.token.is_empty() => {
            push_header(&mut payload.headers, "Authorization", &format!("Bearer {}", payload.auth.token));
        }
        "basic" if !payload.auth.username.is_empty() => {
            let raw = format!("{}:{}", payload.auth.username, payload.auth.password);
            push_header(
                &mut payload.headers,
                "Authorization",
                &format!("Basic {}", STANDARD.encode(raw)),
            );
        }
        "apikey" => {
            let name = if payload.auth.key_name.is_empty() {
                "X-Api-Key"
            } else {
                payload.auth.key_name.as_str()
            };
            let value = if payload.auth.token.is_empty() {
                payload.auth.password.as_str()
            } else {
                payload.auth.token.as_str()
            };
            if payload.auth.api_key_in == "query" {
                let sep = if url.contains('?') { "&" } else { "?" };
                *url = format!(
                    "{url}{sep}{}={}",
                    urlencoding(name),
                    urlencoding(value)
                );
            } else if !value.is_empty() {
                push_header(&mut payload.headers, name, value);
            }
        }
        "oauth2" => {
            let token = if payload.auth.access_token.is_empty() {
                payload.auth.token.as_str()
            } else {
                payload.auth.access_token.as_str()
            };
            if !token.is_empty() {
                push_header(&mut payload.headers, "Authorization", &format!("Bearer {token}"));
            }
        }
        _ => {}
    }
}

fn push_header(headers: &mut Vec<(String, String)>, name: &str, value: &str) {
    if !headers.iter().any(|(k, _)| k.eq_ignore_ascii_case(name)) {
        headers.push((name.into(), value.into()));
    }
}

fn urlencoding(value: &str) -> String {
    url::form_urlencoded::byte_serialize(value.as_bytes()).collect()
}
