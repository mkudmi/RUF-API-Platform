use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use x509_parser::pem::parse_x509_pem;

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
