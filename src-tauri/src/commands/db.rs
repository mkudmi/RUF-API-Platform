use serde::{Deserialize, Serialize};
use sqlx::Connection;
use std::str::FromStr;
use std::time::Duration;
use tauri::Manager;
use thiserror::Error;
use tokio::time::timeout;

#[derive(Debug, Error)]
enum DbError {
    #[error("invalid db type: {0}")]
    InvalidType(String),

    #[error("connection timeout")]
    ConnectionTimeout,

    #[error("query timeout")]
    QueryTimeout,

    #[error("{0}")]
    Sqlx(String),
}

#[derive(Debug, Deserialize)]
pub struct DbTestArgs {
    #[serde(rename = "type")]
    db_type: String,
    #[serde(rename = "connectionString")]
    connection_string: String,
    #[serde(rename = "timeoutMs")]
    timeout_ms: Option<u64>,
    #[serde(rename = "caCertsPem")]
    ca_certs_pem: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
pub struct DbExecArgs {
    #[serde(rename = "type")]
    db_type: String,
    #[serde(rename = "connectionString")]
    connection_string: String,
    sql: String,
    #[serde(rename = "timeoutMs")]
    timeout_ms: Option<u64>,
    #[serde(rename = "caCertsPem")]
    ca_certs_pem: Option<Vec<String>>,
}

#[derive(Debug, Serialize)]
pub struct DbTestResult {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct DbExecResult {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    #[serde(rename = "rowsAffected", skip_serializing_if = "Option::is_none")]
    pub rows_affected: Option<u64>,
}

fn clamp_ms(value: u64, min: u64, max: u64) -> u64 {
    value.max(min).min(max)
}

fn conn_str_has_ssl_root_cert(conn_str: &str) -> bool {
    let lower = conn_str.to_ascii_lowercase();
    lower.contains("sslrootcert=") || lower.contains("ssl-root-cert=")
}

fn write_ca_bundle(
    app: &tauri::AppHandle,
    ca_pems: &[String],
) -> Result<std::path::PathBuf, DbError> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| DbError::Sqlx(e.to_string()))?;
    std::fs::create_dir_all(&dir).map_err(|e| DbError::Sqlx(e.to_string()))?;
    let path = dir.join("ruf_ca_bundle.pem");

    let mut out = String::new();
    for pem in ca_pems {
        let trimmed = pem.trim();
        if trimmed.is_empty() {
            continue;
        }
        out.push_str(trimmed);
        out.push('\n');
        out.push('\n');
    }

    std::fs::write(&path, out).map_err(|e| DbError::Sqlx(e.to_string()))?;
    Ok(path)
}

fn split_sql_statements(sql: &str) -> Vec<String> {
    let mut out = Vec::<String>::new();
    let mut buf = String::new();

    let mut chars = sql.chars().peekable();

    let mut in_single = false;
    let mut in_double = false;
    let mut in_backtick = false;
    let mut in_line_comment = false;
    let mut in_block_comment = false;

    while let Some(c) = chars.next() {
        if in_line_comment {
            buf.push(c);
            if c == '\n' {
                in_line_comment = false;
            }
            continue;
        }

        if in_block_comment {
            buf.push(c);
            if c == '*' && chars.peek() == Some(&'/') {
                buf.push('/');
                chars.next();
                in_block_comment = false;
            }
            continue;
        }

        if in_single {
            buf.push(c);
            if c == '\'' {
                if chars.peek() == Some(&'\'') {
                    buf.push('\'');
                    chars.next();
                } else {
                    in_single = false;
                }
            }
            continue;
        }

        if in_double {
            buf.push(c);
            if c == '"' {
                in_double = false;
            }
            continue;
        }

        if in_backtick {
            buf.push(c);
            if c == '`' {
                in_backtick = false;
            }
            continue;
        }

        if c == '-' && chars.peek() == Some(&'-') {
            buf.push(c);
            buf.push('-');
            chars.next();
            in_line_comment = true;
            continue;
        }

        if c == '/' && chars.peek() == Some(&'*') {
            buf.push(c);
            buf.push('*');
            chars.next();
            in_block_comment = true;
            continue;
        }

        if c == '\'' {
            buf.push(c);
            in_single = true;
            continue;
        }

        if c == '"' {
            buf.push(c);
            in_double = true;
            continue;
        }

        if c == '`' {
            buf.push(c);
            in_backtick = true;
            continue;
        }

        if c == ';' {
            let stmt = buf.trim().to_string();
            if !stmt.is_empty() {
                out.push(stmt);
            }
            buf.clear();
            continue;
        }

        buf.push(c);
    }

    let tail = buf.trim().to_string();
    if !tail.is_empty() {
        out.push(tail);
    }

    out
}

async fn db_test_postgres(
    options: sqlx::postgres::PgConnectOptions,
    timeout_ms: u64,
) -> Result<(), DbError> {
    let mut conn = timeout(
        Duration::from_millis(timeout_ms),
        sqlx::postgres::PgConnection::connect_with(&options),
    )
    .await
    .map_err(|_| DbError::ConnectionTimeout)?
    .map_err(|e| DbError::Sqlx(e.to_string()))?;

    timeout(
        Duration::from_millis(timeout_ms),
        sqlx::query("SELECT 1 as ok").execute(&mut conn),
    )
    .await
    .map_err(|_| DbError::QueryTimeout)?
    .map_err(|e| DbError::Sqlx(e.to_string()))?;

    Ok(())
}

async fn db_test_mysql(conn_str: &str, timeout_ms: u64) -> Result<(), DbError> {
    let mut conn = timeout(
        Duration::from_millis(timeout_ms),
        sqlx::mysql::MySqlConnection::connect(conn_str),
    )
    .await
    .map_err(|_| DbError::ConnectionTimeout)?
    .map_err(|e| DbError::Sqlx(e.to_string()))?;

    timeout(
        Duration::from_millis(timeout_ms),
        sqlx::query("SELECT 1 as ok").execute(&mut conn),
    )
    .await
    .map_err(|_| DbError::QueryTimeout)?
    .map_err(|e| DbError::Sqlx(e.to_string()))?;

    Ok(())
}

async fn db_exec_postgres(
    options: sqlx::postgres::PgConnectOptions,
    sql: &str,
    timeout_ms: u64,
) -> Result<u64, DbError> {
    let mut conn = timeout(
        Duration::from_millis(timeout_ms),
        sqlx::postgres::PgConnection::connect_with(&options),
    )
    .await
    .map_err(|_| DbError::ConnectionTimeout)?
    .map_err(|e| DbError::Sqlx(e.to_string()))?;

    let statements = split_sql_statements(sql);
    let mut total: u64 = 0;
    for stmt in statements {
        let done = timeout(
            Duration::from_millis(timeout_ms),
            sqlx::query(&stmt).execute(&mut conn),
        )
        .await
        .map_err(|_| DbError::QueryTimeout)?
        .map_err(|e| DbError::Sqlx(e.to_string()))?;

        total = total.saturating_add(done.rows_affected());
    }

    Ok(total)
}

async fn db_exec_mysql(conn_str: &str, sql: &str, timeout_ms: u64) -> Result<u64, DbError> {
    let mut conn = timeout(
        Duration::from_millis(timeout_ms),
        sqlx::mysql::MySqlConnection::connect(conn_str),
    )
    .await
    .map_err(|_| DbError::ConnectionTimeout)?
    .map_err(|e| DbError::Sqlx(e.to_string()))?;

    let statements = split_sql_statements(sql);
    let mut total: u64 = 0;
    for stmt in statements {
        let done = timeout(
            Duration::from_millis(timeout_ms),
            sqlx::query(&stmt).execute(&mut conn),
        )
        .await
        .map_err(|_| DbError::QueryTimeout)?
        .map_err(|e| DbError::Sqlx(e.to_string()))?;

        total = total.saturating_add(done.rows_affected());
    }

    Ok(total)
}

#[tauri::command]
pub async fn db_test(app: tauri::AppHandle, args: DbTestArgs) -> DbTestResult {
    let timeout_ms = clamp_ms(args.timeout_ms.unwrap_or(5000), 1000, 30000);

    let postgres_options = if args.db_type == "postgres" {
        let mut opts = sqlx::postgres::PgConnectOptions::from_str(&args.connection_string)
            .map_err(|e| DbError::Sqlx(e.to_string()));

        match &mut opts {
            Ok(o) => {
                if !conn_str_has_ssl_root_cert(&args.connection_string) {
                    if let Some(ca) = args.ca_certs_pem.as_ref() {
                        if !ca.is_empty() {
                            if let Ok(path) = write_ca_bundle(&app, ca) {
                                if let Ok(reparsed) = sqlx::postgres::PgConnectOptions::from_str(
                                    &args.connection_string,
                                ) {
                                    *o = reparsed.ssl_root_cert(path);
                                }
                            }
                        }
                    }
                }
            }
            Err(_) => {}
        }

        Some(opts)
    } else {
        None
    };

    let result = match args.db_type.as_str() {
        "postgres" => match postgres_options {
            Some(Ok(opts)) => db_test_postgres(opts, timeout_ms).await,
            Some(Err(e)) => Err(e),
            None => Err(DbError::Sqlx("missing postgres options".to_string())),
        },
        "mysql" => db_test_mysql(&args.connection_string, timeout_ms).await,
        other => Err(DbError::InvalidType(other.to_string())),
    };

    match result {
        Ok(()) => DbTestResult {
            ok: true,
            message: None,
        },
        Err(e) => DbTestResult {
            ok: false,
            message: Some(e.to_string()),
        },
    }
}

#[tauri::command]
pub async fn db_exec(app: tauri::AppHandle, args: DbExecArgs) -> DbExecResult {
    let timeout_ms = clamp_ms(args.timeout_ms.unwrap_or(15000), 1000, 60000);

    let postgres_options = if args.db_type == "postgres" {
        let mut opts = sqlx::postgres::PgConnectOptions::from_str(&args.connection_string)
            .map_err(|e| DbError::Sqlx(e.to_string()));

        match &mut opts {
            Ok(o) => {
                if !conn_str_has_ssl_root_cert(&args.connection_string) {
                    if let Some(ca) = args.ca_certs_pem.as_ref() {
                        if !ca.is_empty() {
                            if let Ok(path) = write_ca_bundle(&app, ca) {
                                if let Ok(reparsed) = sqlx::postgres::PgConnectOptions::from_str(
                                    &args.connection_string,
                                ) {
                                    *o = reparsed.ssl_root_cert(path);
                                }
                            }
                        }
                    }
                }
            }
            Err(_) => {}
        }

        Some(opts)
    } else {
        None
    };

    let result = match args.db_type.as_str() {
        "postgres" => match postgres_options {
            Some(Ok(opts)) => db_exec_postgres(opts, &args.sql, timeout_ms).await,
            Some(Err(e)) => Err(e),
            None => Err(DbError::Sqlx("missing postgres options".to_string())),
        },
        "mysql" => db_exec_mysql(&args.connection_string, &args.sql, timeout_ms).await,
        other => Err(DbError::InvalidType(other.to_string())),
    };

    match result {
        Ok(rows) => DbExecResult {
            ok: true,
            message: None,
            rows_affected: Some(rows),
        },
        Err(e) => DbExecResult {
            ok: false,
            message: Some(e.to_string()),
            rows_affected: None,
        },
    }
}
