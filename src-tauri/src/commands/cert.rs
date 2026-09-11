use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use x509_parser::pem::parse_x509_pem;

#[cfg(target_os = "windows")]
const CLIENT_AUTH_OID: &str = "1.3.6.1.5.5.7.3.2";

#[cfg(windows)]
fn is_client_identity(cert: &schannel::cert_context::CertContext) -> bool {
    use schannel::{cert_context::ValidUses, RawPointer};
    use windows_sys::Win32::Security::Cryptography::{
        CertGetCertificateContextProperty, CERT_KEY_CONTEXT_PROP_ID, CERT_KEY_PROV_INFO_PROP_ID,
    };
    let usable = match cert.valid_uses() {
        Ok(ValidUses::All) => true,
        Ok(ValidUses::Oids(oids)) => oids.iter().any(|oid| oid == CLIENT_AUTH_OID),
        Err(_) => false,
    };
    if !usable || !cert.is_time_valid().unwrap_or(false) {
        return false;
    }
    // Check the key association without opening it: smart cards may require a PIN.
    [CERT_KEY_PROV_INFO_PROP_ID, CERT_KEY_CONTEXT_PROP_ID]
        .into_iter()
        .any(|property| {
            let mut size = 0;
            unsafe {
                CertGetCertificateContextProperty(
                    cert.as_ptr().cast(),
                    property,
                    std::ptr::null_mut(),
                    &mut size,
                ) != 0
            }
        })
}

#[derive(Debug, Deserialize)]
pub struct CertInspectArgs {
    pub pem: String,
}

#[derive(Debug, Serialize)]
pub struct CertInspectResult {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    #[serde(rename = "sha256", skip_serializing_if = "Option::is_none")]
    pub sha256_hex: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subject: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub issuer: Option<String>,
    #[serde(rename = "notBefore", skip_serializing_if = "Option::is_none")]
    pub not_before: Option<String>,
    #[serde(rename = "notAfter", skip_serializing_if = "Option::is_none")]
    pub not_after: Option<String>,
}

fn bytes_to_hex(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        out.push_str(&format!("{:02x}", b));
    }
    out
}

#[cfg(target_os = "windows")]
fn normalize_thumbprint(value: &str) -> String {
    value
        .chars()
        .filter(|ch| ch.is_ascii_hexdigit())
        .flat_map(|ch| ch.to_uppercase())
        .collect()
}

#[tauri::command]
pub async fn cert_inspect(args: CertInspectArgs) -> CertInspectResult {
    let pem = args.pem.trim();
    if pem.is_empty() {
        return CertInspectResult {
            ok: false,
            message: Some("Missing pem".to_string()),
            sha256_hex: None,
            subject: None,
            issuer: None,
            not_before: None,
            not_after: None,
        };
    }

    let parsed = match parse_x509_pem(pem.as_bytes()) {
        Ok((_, p)) => p,
        Err(e) => {
            return CertInspectResult {
                ok: false,
                message: Some(format!("Invalid PEM: {e}")),
                sha256_hex: None,
                subject: None,
                issuer: None,
                not_before: None,
                not_after: None,
            }
        }
    };

    let cert = match parsed.parse_x509() {
        Ok(c) => c,
        Err(e) => {
            return CertInspectResult {
                ok: false,
                message: Some(format!("Invalid X509: {e}")),
                sha256_hex: None,
                subject: None,
                issuer: None,
                not_before: None,
                not_after: None,
            }
        }
    };

    let mut hasher = Sha256::new();
    hasher.update(&parsed.contents);
    let sha256_hex = bytes_to_hex(&hasher.finalize());

    let subject = cert.subject().to_string();
    let issuer = cert.issuer().to_string();
    let not_before = cert.validity().not_before.to_string();
    let not_after = cert.validity().not_after.to_string();

    CertInspectResult {
        ok: true,
        message: None,
        sha256_hex: Some(sha256_hex),
        subject: Some(subject),
        issuer: Some(issuer),
        not_before: Some(not_before),
        not_after: Some(not_after),
    }
}

#[cfg(target_os = "windows")]
pub fn find_system_client_identity(
    thumbprint: &str,
) -> Result<schannel::cert_context::CertContext, String> {
    use schannel::cert_context::HashAlgorithm;
    use schannel::cert_store::CertStore;

    let wanted = normalize_thumbprint(thumbprint);
    if wanted.len() != 40 {
        return Err(
            "system client certificate thumbprint must contain 40 hexadecimal digits".to_string(),
        );
    }

    let store = CertStore::open_current_user("MY")
        .map_err(|e| format!("failed to open Windows certificate store CurrentUser\\MY: {e}"))?;

    for cert in store.certs() {
        let current = cert
            .fingerprint(HashAlgorithm::sha1())
            .map(|bytes| bytes_to_hex(&bytes))
            .map(|value| normalize_thumbprint(&value))
            .unwrap_or_default();
        if current != wanted {
            continue;
        }

        if !is_client_identity(&cert) {
            return Err("RUF_CLIENT_CERT_REQUIRED".into());
        }
        return Ok(cert);
    }

    Err("RUF_CLIENT_CERT_REQUIRED".into())
}

#[tauri::command]
pub async fn cert_select_system_client_identity(
    window: tauri::WebviewWindow,
    origin: String,
) -> Result<Option<String>, String> {
    let url = reqwest::Url::parse(&origin).map_err(|_| "Invalid certificate origin")?;
    if url.scheme() != "https" {
        return Err("Client certificates require HTTPS".into());
    }
    #[cfg(windows)]
    {
        let owner = window.hwnd().map_err(|e| e.to_string())?.0 as usize;
        tauri::async_runtime::spawn_blocking(move || {
            select_system_client_identity(&url.origin().ascii_serialization(), owner)
        })
        .await
        .map_err(|e| format!("Certificate selection failed: {e}"))?
    }
    #[cfg(not(windows))]
    {
        let _ = window;
        Err("System client certificates require Windows".into())
    }
}

#[cfg(windows)]
fn select_system_client_identity(origin: &str, owner: usize) -> Result<Option<String>, String> {
    use schannel::{
        cert_context::{CertContext, HashAlgorithm},
        cert_store::{CertAdd, CertStore, Memory},
        RawPointer,
    };
    use windows_sys::Win32::Security::Cryptography::UI::CryptUIDlgSelectCertificateFromStore;
    let store = CertStore::open_current_user("MY").map_err(|e| e.to_string())?;
    let mut candidates = Memory::new().map_err(|e| e.to_string())?.into_store();
    let mut count = 0;
    for cert in store.certs().filter(is_client_identity) {
        candidates
            .add_cert(&cert, CertAdd::Always)
            .map_err(|e| e.to_string())?;
        count += 1;
    }
    if count == 0 {
        return Err(
            "No valid client certificates with private keys were found in Windows CurrentUser\\MY"
                .into(),
        );
    }
    let title: Vec<u16> = "Ruf — Client certificate"
        .encode_utf16()
        .chain(Some(0))
        .collect();
    let message: Vec<u16> = format!(
        "Choose a certificate for {origin}. Ruf will remember this choice for this host and port."
    )
    .encode_utf16()
    .chain(Some(0))
    .collect();
    let raw = unsafe {
        CryptUIDlgSelectCertificateFromStore(
            candidates.as_ptr(),
            owner as _,
            title.as_ptr(),
            message.as_ptr(),
            0,
            0,
            std::ptr::null(),
        )
    };
    if raw.is_null() {
        return Ok(None);
    }
    let selected = unsafe { CertContext::from_ptr(raw.cast()) };
    selected
        .fingerprint(HashAlgorithm::sha1())
        .map(|hash| Some(normalize_thumbprint(&bytes_to_hex(&hash))))
        .map_err(|e| e.to_string())
}
