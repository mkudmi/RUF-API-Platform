use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use serde::{Deserialize, Serialize};
use std::error::Error as _;
use std::time::Duration;
use thiserror::Error;

#[derive(Debug, Error)]
enum HttpError {
    #[error("invalid url")]
    InvalidUrl,

    #[error("invalid method")]
    InvalidMethod,

    #[error("invalid header: {0}")]
    InvalidHeader(String),

    #[error("request failed: {0}")]
    RequestFailed(String),
}

#[derive(Debug, Deserialize)]
pub struct HttpRequestArgs {
    pub url: String,
    pub method: Option<String>,
    pub headers: Option<Vec<(String, String)>>,
    #[serde(rename = "bodyBase64")]
    pub body_base64: Option<String>,
    #[serde(rename = "timeoutMs")]
    pub timeout_ms: Option<u64>,
    #[serde(rename = "insecureTls")]
    pub insecure_tls: Option<bool>,
    #[serde(rename = "caCertsPem")]
    pub ca_certs_pem: Option<Vec<String>>,
    #[serde(rename = "clientPkcs12Base64")]
    pub client_pkcs12_base64: Option<String>,
    #[serde(rename = "clientPkcs12Password")]
    pub client_pkcs12_password: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct HttpResponseData {
    pub ok: bool,
    pub status: u16,
    #[serde(rename = "statusText")]
    pub status_text: String,
    pub headers: Vec<(String, String)>,
    #[serde(rename = "bodyBase64")]
    pub body_base64: String,
}

fn clamp_ms(value: u64, min: u64, max: u64) -> u64 {
    value.max(min).min(max)
}

fn normalize_timeout_ms(value: Option<u64>) -> Option<u64> {
    match value {
        Some(0) => None,
        Some(ms) => Some(clamp_ms(ms, 300, 600_000)),
        None => Some(300_000),
    }
}

fn should_drop_header(name_lower: &str) -> bool {
    matches!(
        name_lower,
        "origin"
            | "referer"
            | "host"
            | "content-length"
            | "sec-fetch-mode"
            | "sec-fetch-site"
            | "access-control-request-method"
            | "access-control-request-headers"
    )
}

fn format_reqwest_error(e: &reqwest::Error) -> String {
    let mut parts: Vec<String> = Vec::new();
    if e.is_timeout() {
        parts.push("timeout".to_string());
    }
    if e.is_connect() {
        parts.push("connect".to_string());
    }
    if e.is_request() {
        parts.push("request".to_string());
    }
    if e.is_decode() {
        parts.push("decode".to_string());
    }
    if let Some(status) = e.status() {
        parts.push(format!("status={}", status));
    }

    let mut msg = e.to_string();
    if !parts.is_empty() {
        msg = format!("{} ({})", msg, parts.join(","));
    }

    let mut cur: Option<&(dyn std::error::Error + 'static)> = e.source();
    while let Some(src) = cur {
        msg.push_str(": ");
        msg.push_str(&format!("{src}"));
        cur = src.source();
    }

    msg
}

#[tauri::command]
pub async fn http_request(args: HttpRequestArgs) -> Result<HttpResponseData, String> {
    async fn inner(args: HttpRequestArgs) -> Result<HttpResponseData, HttpError> {
        let mut url = args.url.trim().to_string();
        // tolerate common typo: "http:/host/..." or "https:/host/..."
        if url.to_ascii_lowercase().starts_with("http:/")
            && !url.to_ascii_lowercase().starts_with("http://")
        {
            url = url.replacen("http:/", "http://", 1);
        } else if url.to_ascii_lowercase().starts_with("https:/")
            && !url.to_ascii_lowercase().starts_with("https://")
        {
            url = url.replacen("https:/", "https://", 1);
        }

        let url = url.trim();
        if url.is_empty() {
            return Err(HttpError::InvalidUrl);
        }
        let _ = reqwest::Url::parse(url).map_err(|_| HttpError::InvalidUrl)?;

        let method = args
            .method
            .as_deref()
            .unwrap_or("GET")
            .trim()
            .to_uppercase();
        let method =
            reqwest::Method::from_bytes(method.as_bytes()).map_err(|_| HttpError::InvalidMethod)?;

        let timeout_ms = normalize_timeout_ms(args.timeout_ms);
        let insecure_tls = args.insecure_tls.unwrap_or(false);
        let client_pkcs12_base64 = args.client_pkcs12_base64.unwrap_or_default();
        let client_pkcs12_password = args.client_pkcs12_password.unwrap_or_default();

        let mut client_builder = reqwest::Client::builder()
            .use_native_tls()
            .danger_accept_invalid_certs(insecure_tls)
            .danger_accept_invalid_hostnames(insecure_tls)
            .user_agent("ruf/0.1.0");

        if let Some(timeout_ms) = timeout_ms {
            client_builder = client_builder.timeout(Duration::from_millis(timeout_ms));
        }

        if !insecure_tls {
            if let Some(certs) = args.ca_certs_pem {
                for pem in certs {
                    let trimmed = pem.trim();
                    if trimmed.is_empty() {
                        continue;
                    }
                    let cert = reqwest::Certificate::from_pem(trimmed.as_bytes()).map_err(|e| {
                        HttpError::RequestFailed(format!("invalid CA certificate: {e}"))
                    })?;
                    client_builder = client_builder.add_root_certificate(cert);
                }
            }
        }

        if !client_pkcs12_base64.trim().is_empty() {
            let pkcs12_der = BASE64
                .decode(client_pkcs12_base64.trim())
                .map_err(|_| HttpError::RequestFailed("invalid client PKCS#12 base64".to_string()))?;
            let identity =
                reqwest::Identity::from_pkcs12_der(&pkcs12_der, &client_pkcs12_password)
                    .map_err(|e| {
                        HttpError::RequestFailed(format!("invalid client PKCS#12 identity: {e}"))
                    })?;
            client_builder = client_builder.identity(identity);
        }

        let client = client_builder
            .build()
            .map_err(|e| HttpError::RequestFailed(e.to_string()))?;

        let mut req = client.request(method, url);

        // Match Postman/Insomnia defaults a bit closer.
        req = req.header(reqwest::header::ACCEPT, "*/*");

        if let Some(headers) = args.headers {
            for (k, v) in headers {
                let key = k.trim();
                if key.is_empty() {
                    continue;
                }
                let key_lower = key.to_ascii_lowercase();
                if should_drop_header(&key_lower) {
                    continue;
                }
                let name = reqwest::header::HeaderName::from_bytes(key.as_bytes())
                    .map_err(|_| HttpError::InvalidHeader(key.to_string()))?;
                let value = reqwest::header::HeaderValue::from_str(&v)
                    .map_err(|_| HttpError::InvalidHeader(key.to_string()))?;
                req = req.header(name, value);
            }
        }

        if let Some(body_b64) = args.body_base64 {
            let bytes = BASE64
                .decode(body_b64.trim())
                .map_err(|_| HttpError::RequestFailed("invalid bodyBase64".to_string()))?;
            if !bytes.is_empty() {
                req = req.body(bytes);
            }
        }

        let resp = req
            .send()
            .await
            .map_err(|e| HttpError::RequestFailed(format_reqwest_error(&e)))?;

        let status = resp.status();
        let status_text = status.canonical_reason().unwrap_or("").to_string();

        let mut headers_out: Vec<(String, String)> = Vec::new();
        for (k, v) in resp.headers().iter() {
            let name = k.as_str().to_string();
            let value = v.to_str().unwrap_or("").to_string();
            headers_out.push((name, value));
        }

        let body = resp
            .bytes()
            .await
            .map_err(|e| HttpError::RequestFailed(format_reqwest_error(&e)))?;

        Ok(HttpResponseData {
            ok: status.is_success(),
            status: status.as_u16(),
            status_text,
            headers: headers_out,
            body_base64: BASE64.encode(body),
        })
    }

    inner(args).await.map_err(|e| e.to_string())
}
