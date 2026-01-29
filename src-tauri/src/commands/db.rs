use serde::{Deserialize, Serialize};
use sqlx::Connection;
use std::time::Duration;
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

async fn db_test_postgres(conn_str: &str, timeout_ms: u64) -> Result<(), DbError> {
  let mut conn = timeout(
    Duration::from_millis(timeout_ms),
    sqlx::postgres::PgConnection::connect(conn_str),
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

async fn db_exec_postgres(conn_str: &str, sql: &str, timeout_ms: u64) -> Result<u64, DbError> {
  let mut conn = timeout(
    Duration::from_millis(timeout_ms),
    sqlx::postgres::PgConnection::connect(conn_str),
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
pub async fn db_test(args: DbTestArgs) -> DbTestResult {
  let timeout_ms = clamp_ms(args.timeout_ms.unwrap_or(5000), 1000, 30000);

  let result = match args.db_type.as_str() {
    "postgres" => db_test_postgres(&args.connection_string, timeout_ms).await,
    "mysql" => db_test_mysql(&args.connection_string, timeout_ms).await,
    other => Err(DbError::InvalidType(other.to_string())),
  };

  match result {
    Ok(()) => DbTestResult { ok: true, message: None },
    Err(e) => DbTestResult { ok: false, message: Some(e.to_string()) },
  }
}

#[tauri::command]
pub async fn db_exec(args: DbExecArgs) -> DbExecResult {
  let timeout_ms = clamp_ms(args.timeout_ms.unwrap_or(15000), 1000, 60000);

  let result = match args.db_type.as_str() {
    "postgres" => db_exec_postgres(&args.connection_string, &args.sql, timeout_ms).await,
    "mysql" => db_exec_mysql(&args.connection_string, &args.sql, timeout_ms).await,
    other => Err(DbError::InvalidType(other.to_string())),
  };

  match result {
    Ok(rows) => DbExecResult { ok: true, message: None, rows_affected: Some(rows) },
    Err(e) => DbExecResult { ok: false, message: Some(e.to_string()), rows_affected: None },
  }
}
