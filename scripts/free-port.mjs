#!/usr/bin/env node
import { execSync } from 'node:child_process'

const portRaw = process.argv[2] || '5174'
const port = Number(portRaw)
if (!Number.isFinite(port) || port <= 0) {
  console.error(`Invalid port: ${portRaw}`)
  process.exit(1)
}

function run(cmd) {
  return execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'] }).toString('utf8').trim()
}

function killPid(pid) {
  const platform = process.platform
  if (platform === 'win32') {
    execSync(`taskkill /PID ${pid} /F`, { stdio: 'ignore' })
    return
  }
  execSync(`kill -9 ${pid}`, { stdio: 'ignore' })
}

try {
  let pids = []
  if (process.platform === 'win32') {
    const out = run(`powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort ${port} -State Listen | Select-Object -ExpandProperty OwningProcess"`)
    pids = out.split(/\r?\n/).map(s => s.trim()).filter(Boolean)
  } else {
    const out = run(`lsof -ti tcp:${port}`)
    pids = out.split(/\r?\n/).map(s => s.trim()).filter(Boolean)
  }

  if (!pids.length) {
    console.log(`port ${port}: free`)
    process.exit(0)
  }

  for (const pid of pids) {
    try {
      killPid(pid)
      console.log(`port ${port}: killed pid ${pid}`)
    } catch {
      console.warn(`port ${port}: failed to kill pid ${pid}`)
    }
  }
} catch {
  console.log(`port ${port}: free`)
}
