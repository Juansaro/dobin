use std::process::Stdio;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};
use tokio::time::{timeout, Duration};
use tokio_util::sync::CancellationToken;

pub struct TunnelHandle {
    pub public_url: String,
    cancel: CancellationToken,
    child: parking_lot::Mutex<Option<Child>>,
}

impl TunnelHandle {
    pub fn stop(&self) {
        self.cancel.cancel();
        if let Some(mut child) = self.child.lock().take() {
            let _ = child.start_kill();
            tokio::spawn(async move {
                let _ = child.wait().await;
            });
        }
    }
}

pub async fn start(local_port: u16) -> Result<TunnelHandle, String> {
    let mut cmd = Command::new("cloudflared");
    cmd.arg("tunnel")
        .arg("--url")
        .arg(format!("http://127.0.0.1:{local_port}"))
        .arg("--no-autoupdate")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    #[cfg(windows)]
    {
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let mut child = cmd.spawn().map_err(|err| {
        if err.kind() == std::io::ErrorKind::NotFound {
            "No está cloudflared en PATH. Instálalo desde https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/ y vuelve a intentar.".into()
        } else {
            format!("No se pudo arrancar cloudflared: {err}")
        }
    })?;

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let (tx, rx) = tokio::sync::oneshot::channel::<Result<String, String>>();
    let tx = std::sync::Arc::new(tokio::sync::Mutex::new(Some(tx)));
    let cancel = CancellationToken::new();

    if let Some(out) = stdout {
        spawn_reader(BufReader::new(out), tx.clone(), cancel.clone());
    }
    if let Some(err) = stderr {
        spawn_reader(BufReader::new(err), tx.clone(), cancel.clone());
    }

    let found = timeout(Duration::from_secs(25), rx).await;
    let public_url = match found {
        Ok(Ok(Ok(url))) => url,
        Ok(Ok(Err(err))) => {
            let _ = child.start_kill();
            return Err(err);
        }
        _ => {
            let _ = child.start_kill();
            return Err(
                "cloudflared no publicó una URL trycloudflare.com a tiempo.".into(),
            );
        }
    };

    Ok(TunnelHandle {
        public_url,
        cancel,
        child: parking_lot::Mutex::new(Some(child)),
    })
}

fn spawn_reader<R: tokio::io::AsyncRead + Unpin + Send + 'static>(
    reader: BufReader<R>,
    tx: std::sync::Arc<tokio::sync::Mutex<Option<tokio::sync::oneshot::Sender<Result<String, String>>>>>,
    cancel: CancellationToken,
) {
    tokio::spawn(async move {
        let mut lines = reader.lines();
        loop {
            tokio::select! {
                _ = cancel.cancelled() => break,
                line = lines.next_line() => {
                    let Ok(Some(line)) = line else { break };
                    if let Some(url) = parse_public_url(&line) {
                        if let Some(sender) = tx.lock().await.take() {
                            let _ = sender.send(Ok(url));
                        }
                    }
                    let lower = line.to_lowercase();
                    if lower.contains("failed") && lower.contains("login") {
                        if let Some(sender) = tx.lock().await.take() {
                            let _ = sender.send(Err(
                                "cloudflared pidió login. En Fase 3 usamos Quick Tunnel, sin cuenta.".into(),
                            ));
                        }
                    }
                }
            }
        }
    });
}

fn parse_public_url(text: &str) -> Option<String> {
    let marker = ".trycloudflare.com";
    let idx = text.find(marker)?;
    let start = text[..idx].rfind("https://").or_else(|| text[..idx].rfind("http://"))?;
    Some(text[start..idx + marker.len()].to_string())
}

#[cfg(test)]
mod tests {
    use super::parse_public_url;

    #[test]
    fn extracts_trycloudflare_url() {
        let line = "INF |  Your quick Tunnel has been created! Visit it at: https://abc-123.trycloudflare.com           |";
        assert_eq!(
            parse_public_url(line).as_deref(),
            Some("https://abc-123.trycloudflare.com")
        );
    }
}
