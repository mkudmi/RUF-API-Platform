// Run through scripts/test-system-client-tls.mjs. Uses a temporary test identity only.
#![allow(dead_code)]
#[cfg(windows)]
#[path = "../src/commands/cert.rs"]
mod cert;
#[cfg(windows)]
#[path = "../src/commands/http.rs"]
mod http;
#[cfg(windows)]
#[path = "../src/commands/http_windows.rs"]
mod http_windows;

#[cfg(windows)]
struct TemporaryCertificate(Option<schannel::cert_context::CertContext>);
#[cfg(windows)]
impl Drop for TemporaryCertificate {
    fn drop(&mut self) {
        if let Some(cert) = self.0.take() {
            use schannel::{cert_context::PrivateKey, RawPointer};
            let key = cert.private_key().acquire().expect("open temporary test key for cleanup");
            cert.delete().expect("remove temporary test certificate");
            if let PrivateKey::NcryptKey(key) = key {
                let status = unsafe { windows_sys::Win32::Security::Cryptography::NCryptDeleteKey(key.as_ptr() as usize, 0) };
                assert_eq!(status, 0, "remove temporary test key");
                std::mem::forget(key); // NCryptDeleteKey also frees the handle.
            } else { panic!("test key must use CNG"); }
        }
    }
}

#[cfg(windows)]
#[tokio::main]
async fn main() {
    use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
    use schannel::{cert_context::HashAlgorithm, cert_store::{CertAdd, CertStore}, RawPointer};
    use windows_sys::Win32::Security::Cryptography::*;
    let argv: Vec<String> = std::env::args().collect();
    let pfx = std::fs::read(&argv[1]).unwrap();
    // A real non-exportable CNG key, removed with the certificate by the guard.
    let blob = CRYPT_INTEGER_BLOB { cbData: pfx.len() as u32, pbData: pfx.as_ptr() as *mut _ };
    let password: Vec<u16> = "test".encode_utf16().chain(Some(0)).collect();
    let raw = unsafe { PFXImportCertStore(&blob, password.as_ptr(), PKCS12_ALWAYS_CNG_KSP | CRYPT_USER_KEYSET) };
    assert!(!raw.is_null());
    let imported = unsafe { CertStore::from_ptr(raw) };
    let identity = imported.certs().next().unwrap();
    let thumbprint: String = identity.fingerprint(HashAlgorithm::sha1()).unwrap().iter().map(|b| format!("{b:02X}")).collect();
    let mut personal = CertStore::open_current_user("MY").unwrap();
    let temporary = TemporaryCertificate(Some(personal.add_cert(&identity, CertAdd::New).unwrap()));
    let mut export = CRYPT_INTEGER_BLOB::default();
    let exportable = unsafe { PFXExportCertStoreEx(imported.as_ptr(), &mut export, password.as_ptr(), std::ptr::null(), EXPORT_PRIVATE_KEYS | REPORT_NOT_ABLE_TO_EXPORT_PRIVATE_KEY) };
    assert_eq!(exportable, 0, "test key must really be non-exportable");
    cert::find_system_client_identity(&thumbprint).expect("lookup temporary certificate in CurrentUser\\MY");
    let make_args = |thumbprint: Option<String>| http::HttpRequestArgs {
        url: argv[2].clone(), method: Some("POST".into()), headers: Some(vec![("Content-Type".into(), "application/octet-stream".into())]),
        body_base64: Some(BASE64.encode([0, 1, 127, 255])), timeout_ms: Some(10_000), insecure_tls: Some(true),
        ca_certs_pem: None, client_pkcs12_base64: None, client_pkcs12_password: None, system_client_cert_thumbprint: thumbprint,
    };
    let without = http::http_request(make_args(None)).await.unwrap_err();
    assert_eq!(without, "RUF_CLIENT_CERT_REQUIRED", "server must request a client certificate before HTTP payload is sent");
    let result = http::http_request(make_args(Some(thumbprint))).await.unwrap();
    assert_eq!(result.status, 200);
    let response: serde_json::Value = serde_json::from_slice(&BASE64.decode(result.body_base64).unwrap()).unwrap();
    assert_eq!(response["authorized"], true);
    assert_eq!(response["method"], "POST");
    assert_eq!(response["body"], "AAF//w==");
    assert_eq!(response["receivedRequests"], 1, "certificate selection must not duplicate POST");
    drop(temporary);
    println!("PASS: client certificate challenge and mTLS POST using a non-exportable Windows key");
}

#[cfg(not(windows))]
fn main() { eprintln!("This probe requires Windows"); }
