use super::http::{normalize_timeout_ms, should_drop_header, HttpRequestArgs, HttpResponseData};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use schannel::RawPointer;
use std::io::Read;
use std::{ffi::c_void, mem::size_of, ptr, time::Instant};
use windows_sys::Win32::{
    Foundation::{GetLastError, ERROR_INVALID_PARAMETER},
    Networking::WinHttp::*,
};

struct Handle(*mut c_void);

impl Handle {
    fn new(raw: *mut c_void, operation: &str) -> Result<Self, String> {
        if raw.is_null() {
            Err(last_error(operation))
        } else {
            Ok(Self(raw))
        }
    }

    fn option(&self, option: u32, value: u32) -> Result<(), String> {
        self.option_raw(option, value).map_err(|code| {
            format_windows_error(code, &format!("WinHttpSetOption(option={option})"))
        })
    }

    fn option_raw(&self, option: u32, value: u32) -> Result<(), u32> {
        let result = unsafe {
            WinHttpSetOption(
                self.0,
                option,
                (&value as *const u32).cast(),
                size_of::<u32>() as u32,
            )
        };
        if result == 0 {
            Err(unsafe { GetLastError() })
        } else {
            Ok(())
        }
    }
}

impl Drop for Handle {
    fn drop(&mut self) {
        unsafe {
            WinHttpCloseHandle(self.0);
        }
    }
}

fn wide(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(Some(0)).collect()
}

fn last_error(operation: &str) -> String {
    format_windows_error(unsafe { GetLastError() }, operation)
}

fn format_windows_error(code: u32, operation: &str) -> String {
    if matches!(
        code,
        ERROR_WINHTTP_CLIENT_AUTH_CERT_NEEDED
            | ERROR_WINHTTP_CLIENT_CERT_NO_PRIVATE_KEY
            | ERROR_WINHTTP_CLIENT_CERT_NO_ACCESS_PRIVATE_KEY
    ) {
        return "RUF_CLIENT_CERT_REQUIRED".into();
    }
    format!(
        "Windows HTTP error {code} at {operation}: {}",
        std::io::Error::from_raw_os_error(code as i32)
    )
}

fn check(result: i32, operation: &str) -> Result<(), String> {
    if result == 0 {
        Err(last_error(operation))
    } else {
        Ok(())
    }
}

fn configure_tls_protocols(mut set: impl FnMut(u32) -> Result<(), u32>) -> Result<(), u32> {
    match set(WINHTTP_FLAG_SECURE_PROTOCOL_TLS1_2 | WINHTTP_FLAG_SECURE_PROTOCOL_TLS1_3) {
        // Windows 10 rejects the TLS 1.3 bit before any connection is made.
        Err(ERROR_INVALID_PARAMETER) => set(WINHTTP_FLAG_SECURE_PROTOCOL_TLS1_2),
        result => result,
    }
}

fn query_header(handle: &Handle, query: u32) -> Result<String, String> {
    let mut size = 0;
    unsafe {
        WinHttpQueryHeaders(
            handle.0,
            query,
            ptr::null(),
            ptr::null_mut(),
            &mut size,
            ptr::null_mut(),
        );
    }
    if size == 0 {
        return Err(last_error(&format!(
            "WinHttpQueryHeaders(query={query}, size)"
        )));
    }
    let mut buffer = vec![0u16; size as usize / 2 + 1];
    check(
        unsafe {
            WinHttpQueryHeaders(
                handle.0,
                query,
                ptr::null(),
                buffer.as_mut_ptr().cast(),
                &mut size,
                ptr::null_mut(),
            )
        },
        &format!("WinHttpQueryHeaders(query={query})"),
    )?;
    Ok(String::from_utf16_lossy(&buffer[..size as usize / 2])
        .trim_end_matches('\0')
        .to_string())
}

pub(super) fn request(args: HttpRequestArgs) -> Result<HttpResponseData, String> {
    let url = reqwest::Url::parse(args.url.trim()).map_err(|e| format!("invalid URL: {e}"))?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err("Only HTTP and HTTPS are supported".into());
    }
    let secure = url.scheme() == "https";
    let host = url.host_str().ok_or("URL has no host")?;
    let method = args
        .method
        .as_deref()
        .unwrap_or("GET")
        .trim()
        .to_uppercase();
    reqwest::Method::from_bytes(method.as_bytes()).map_err(|_| "invalid method")?;
    let body = BASE64
        .decode(args.body_base64.as_deref().unwrap_or("").trim())
        .map_err(|_| "invalid bodyBase64")?;
    let body_len = u32::try_from(body.len()).map_err(|_| "Request body is too large")?;
    let insecure = args.insecure_tls.unwrap_or(false);
    if secure
        && !insecure
        && args
            .ca_certs_pem
            .as_ref()
            .is_some_and(|certs| certs.iter().any(|c| !c.trim().is_empty()))
    {
        return Err("System client TLS uses Windows server trust. Install the API's CA in the Windows trusted certificate store and remove its app-only CA override.".into());
    }

    let session = Handle::new(
        unsafe {
            WinHttpOpen(
                wide("ruf/0.1.0").as_ptr(),
                WINHTTP_ACCESS_TYPE_AUTOMATIC_PROXY,
                ptr::null(),
                ptr::null(),
                0,
            )
        },
        "WinHttpOpen",
    )?;
    if secure {
        configure_tls_protocols(|protocols| {
            session.option_raw(WINHTTP_OPTION_SECURE_PROTOCOLS, protocols)
        })
        .map_err(|code| format_windows_error(code, "WinHttpSetOption(SECURE_PROTOCOLS)"))?;
    }
    let started = Instant::now();
    let timeout = normalize_timeout_ms(args.timeout_ms);
    let update_timeout = |handle: &Handle| -> Result<(), String> {
        let remaining = match timeout {
            Some(ms) => {
                let elapsed = started.elapsed().as_millis() as u64;
                if elapsed >= ms {
                    return Err("Request timed out".into());
                }
                (ms - elapsed).min(i32::MAX as u64) as i32
            }
            None => 0,
        };
        check(
            unsafe { WinHttpSetTimeouts(handle.0, remaining, remaining, remaining, remaining) },
            "WinHttpSetTimeouts",
        )
    };
    update_timeout(&session)?;
    let connection = Handle::new(
        unsafe {
            WinHttpConnect(
                session.0,
                wide(host.trim_matches(['[', ']'])).as_ptr(),
                url.port_or_known_default().ok_or("URL has no port")?,
                0,
            )
        },
        "WinHttpConnect",
    )?;
    let mut path = url.path().to_string();
    if let Some(query) = url.query() {
        path.push('?');
        path.push_str(query);
    }
    let request = Handle::new(
        unsafe {
            WinHttpOpenRequest(
                connection.0,
                wide(&method).as_ptr(),
                wide(&path).as_ptr(),
                ptr::null(),
                ptr::null(),
                ptr::null(),
                if secure { WINHTTP_FLAG_SECURE } else { 0 },
            )
        },
        "WinHttpOpenRequest",
    )?;
    // Each redirect is handled by the frontend so an identity never crosses origins.
    request.option(
        WINHTTP_OPTION_REDIRECT_POLICY,
        WINHTTP_OPTION_REDIRECT_POLICY_NEVER,
    )?;
    request.option(WINHTTP_OPTION_DISABLE_FEATURE, WINHTTP_DISABLE_COOKIES)?;
    request.option(
        WINHTTP_OPTION_AUTOLOGON_POLICY,
        WINHTTP_AUTOLOGON_SECURITY_LEVEL_HIGH,
    )?;
    request.option(
        WINHTTP_OPTION_DECOMPRESSION,
        WINHTTP_DECOMPRESSION_FLAG_GZIP | WINHTTP_DECOMPRESSION_FLAG_DEFLATE,
    )?;
    if secure && insecure {
        request.option(
            WINHTTP_OPTION_SECURITY_FLAGS,
            SECURITY_FLAG_IGNORE_UNKNOWN_CA
                | SECURITY_FLAG_IGNORE_CERT_CN_INVALID
                | SECURITY_FLAG_IGNORE_CERT_DATE_INVALID
                | SECURITY_FLAG_IGNORE_CERT_WRONG_USAGE,
        )?;
    }
    let identity = if secure {
        args.system_client_cert_thumbprint
            .as_deref()
            .filter(|s| !s.is_empty())
            .map(super::cert::find_system_client_identity)
            .transpose()?
    } else {
        None
    };
    if let Some(cert) = &identity {
        check(
            unsafe {
                WinHttpSetOption(
                    request.0,
                    WINHTTP_OPTION_CLIENT_CERT_CONTEXT,
                    cert.as_ptr().cast(),
                    size_of::<windows_sys::Win32::Security::Cryptography::CERT_CONTEXT>() as u32,
                )
            },
            "WinHttpSetOption(CLIENT_CERT_CONTEXT)",
        )?;
    }

    let mut headers = String::new();
    let mut has_accept = false;
    let mut has_auth = false;
    for (name, value) in args.headers.unwrap_or_default() {
        let name = name.trim();
        let lower = name.to_ascii_lowercase();
        if name.is_empty() || should_drop_header(&lower) {
            continue;
        }
        reqwest::header::HeaderName::from_bytes(name.as_bytes())
            .map_err(|_| format!("invalid header: {name}"))?;
        reqwest::header::HeaderValue::from_str(&value)
            .map_err(|_| format!("invalid header: {name}"))?;
        has_accept |= lower == "accept";
        has_auth |= lower == "authorization";
        headers.push_str(&format!("{name}: {value}\r\n"));
    }
    if !has_accept {
        headers.push_str("Accept: */*\r\n");
    }
    if !has_auth && (!url.username().is_empty() || url.password().is_some()) {
        // Reuse reqwest's URL credential decoding and Basic auth construction.
        let prepared = reqwest::Client::new()
            .get(url.clone())
            .build()
            .map_err(|e| e.to_string())?;
        if let Some(auth) = prepared.headers().get(reqwest::header::AUTHORIZATION) {
            headers.push_str(&format!(
                "Authorization: {}\r\n",
                auth.to_str().map_err(|e| e.to_string())?
            ));
        }
    }
    let headers = wide(&headers);
    update_timeout(&request)?;
    check(
        unsafe {
            WinHttpSendRequest(
                request.0,
                headers.as_ptr(),
                (headers.len() - 1) as u32,
                if body.is_empty() {
                    ptr::null()
                } else {
                    body.as_ptr().cast()
                },
                body_len,
                body_len,
                0,
            )
        },
        "WinHttpSendRequest",
    )?;
    update_timeout(&request)?;
    check(
        unsafe { WinHttpReceiveResponse(request.0, ptr::null_mut()) },
        "WinHttpReceiveResponse",
    )?;
    let status: u16 = query_header(&request, WINHTTP_QUERY_STATUS_CODE)?
        .parse()
        .map_err(|_| "invalid response status")?;
    let status_text = query_header(&request, WINHTTP_QUERY_STATUS_TEXT)?;
    let raw_headers = query_header(&request, WINHTTP_QUERY_RAW_HEADERS_CRLF)?;
    let mut headers: Vec<(String, String)> = raw_headers
        .lines()
        .skip(1)
        .filter_map(|line| line.split_once(':'))
        .map(|(name, value)| (name.trim().to_string(), value.trim().to_string()))
        .collect();
    let mut response_body = Vec::new();
    let mut buffer = [0u8; 32 * 1024];
    loop {
        update_timeout(&request)?;
        let mut read = 0;
        check(
            unsafe {
                WinHttpReadData(
                    request.0,
                    buffer.as_mut_ptr().cast(),
                    buffer.len() as u32,
                    &mut read,
                )
            },
            "WinHttpReadData",
        )?;
        if read == 0 {
            break;
        }
        response_body.extend_from_slice(&buffer[..read as usize]);
    }
    // WinHTTP handles gzip/deflate; preserve reqwest's Brotli behavior for copied browser headers.
    if headers.iter().any(|(name, value)| {
        name.eq_ignore_ascii_case("content-encoding") && value.eq_ignore_ascii_case("br")
    }) && method != "HEAD"
    {
        let mut decoded = Vec::new();
        brotli::Decompressor::new(response_body.as_slice(), 4096)
            .read_to_end(&mut decoded)
            .map_err(|e| format!("Brotli response decoding failed: {e}"))?;
        response_body = decoded;
        headers.retain(|(name, _)| {
            !name.eq_ignore_ascii_case("content-encoding")
                && !name.eq_ignore_ascii_case("content-length")
        });
    }
    Ok(HttpResponseData {
        manual_redirects: true,
        ok: (200..300).contains(&status),
        status,
        status_text,
        headers,
        body_base64: BASE64.encode(response_body),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn windows_10_rejecting_tls13_retries_with_tls12_only() {
        let mut attempts = Vec::new();
        configure_tls_protocols(|protocols| {
            attempts.push(protocols);
            if protocols & WINHTTP_FLAG_SECURE_PROTOCOL_TLS1_3 != 0 {
                Err(ERROR_INVALID_PARAMETER)
            } else {
                Ok(())
            }
        })
        .unwrap();
        assert_eq!(
            attempts,
            [
                WINHTTP_FLAG_SECURE_PROTOCOL_TLS1_2 | WINHTTP_FLAG_SECURE_PROTOCOL_TLS1_3,
                WINHTTP_FLAG_SECURE_PROTOCOL_TLS1_2,
            ]
        );
    }

    #[test]
    fn supported_tls13_is_kept_without_retry() {
        let mut attempts = Vec::new();
        configure_tls_protocols(|protocols| {
            attempts.push(protocols);
            Ok(())
        })
        .unwrap();
        assert_eq!(
            attempts,
            [WINHTTP_FLAG_SECURE_PROTOCOL_TLS1_2 | WINHTTP_FLAG_SECURE_PROTOCOL_TLS1_3]
        );
    }

    #[test]
    fn unrelated_errors_are_not_hidden_by_protocol_fallback() {
        let mut attempts = 0;
        let result = configure_tls_protocols(|_| {
            attempts += 1;
            Err(5)
        });
        assert_eq!(result, Err(5));
        assert_eq!(attempts, 1);
        let result = configure_tls_protocols(|protocols| {
            if protocols & WINHTTP_FLAG_SECURE_PROTOCOL_TLS1_3 != 0 {
                Err(ERROR_INVALID_PARAMETER)
            } else {
                Err(5)
            }
        });
        assert_eq!(result, Err(5));
    }

    #[test]
    fn diagnostics_include_operation_without_breaking_certificate_selection() {
        let error = format_windows_error(
            ERROR_INVALID_PARAMETER,
            "WinHttpSetOption(SECURE_PROTOCOLS)",
        );
        assert!(error.contains("87"));
        assert!(error.contains("WinHttpSetOption(SECURE_PROTOCOLS)"));
        assert_eq!(
            format_windows_error(ERROR_WINHTTP_CLIENT_AUTH_CERT_NEEDED, "WinHttpSendRequest"),
            "RUF_CLIENT_CERT_REQUIRED"
        );
    }
}
