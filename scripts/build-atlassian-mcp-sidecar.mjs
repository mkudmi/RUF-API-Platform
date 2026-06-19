import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const MCP_REMOTE_VERSION = '0.1.38'
const PKG_VERSION = '6.20.0'
const SIDE_CAR_NAME = 'atlassian-mcp'
const DEFAULT_ATLASSIAN_URL = 'https://mcp.atlassian.com/v1/mcp/authv2'
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outputDir = path.join(repoRoot, 'src-tauri', 'binaries')
const extension = process.platform === 'win32' ? '.exe' : ''

function run(command, args, options = {}) {
  execFileSync(command, args, {
    cwd: repoRoot,
    stdio: 'inherit',
    ...options,
  })
}

function runQuiet(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  }).trim()
}

function getTargetTriple() {
  try {
    return runQuiet('rustc', ['--print', 'host-tuple'])
  } catch {
    const verbose = runQuiet('rustc', ['-Vv'])
    const hostLine = verbose.split(/\r?\n/).find(line => line.startsWith('host: '))
    if (!hostLine) throw new Error('Failed to determine Rust target triple.')
    return hostLine.slice('host: '.length).trim()
  }
}

function mapRustTargetToPkgTarget(targetTriple) {
  const map = {
    'aarch64-apple-darwin': 'node20-macos-arm64',
    'x86_64-apple-darwin': 'node20-macos-x64',
    'x86_64-unknown-linux-gnu': 'node20-linux-x64',
    'aarch64-unknown-linux-gnu': 'node20-linux-arm64',
    'x86_64-pc-windows-msvc': 'node20-win-x64',
    'aarch64-pc-windows-msvc': 'node20-win-arm64',
  }
  const target = map[targetTriple]
  if (!target) throw new Error(`Unsupported target triple for Atlassian sidecar packaging: ${targetTriple}`)
  return target
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true })
}

function removeDirIfExists(dir) {
  fs.rmSync(dir, { recursive: true, force: true })
}

const targetTriple = getTargetTriple()
const pkgTarget = mapRustTargetToPkgTarget(targetTriple)
const outputPath = path.join(outputDir, `${SIDE_CAR_NAME}-${targetTriple}${extension}`)

if (fs.existsSync(outputPath)) {
  console.log(`Atlassian MCP sidecar already exists: ${outputPath}`)
  process.exit(0)
}

const workRoot = path.join(os.tmpdir(), `ruf-atlassian-mcp-sidecar-${targetTriple}`)
const entryPath = path.join(workRoot, 'entry.cjs')
const packageJsonPath = path.join(workRoot, 'package.json')

console.log(`Building Atlassian MCP sidecar using mcp-remote ${MCP_REMOTE_VERSION} for ${targetTriple}`)
removeDirIfExists(workRoot)
ensureDir(workRoot)
ensureDir(outputDir)

fs.writeFileSync(
  packageJsonPath,
  JSON.stringify({
    private: true,
    type: 'commonjs',
    dependencies: {
      'mcp-remote': MCP_REMOTE_VERSION,
      '@yao-pkg/pkg': PKG_VERSION,
    },
  }, null, 2),
  'utf8',
)

fs.writeFileSync(
  entryPath,
  [
    "const path = require('node:path')",
    `const defaultUrl = ${JSON.stringify(DEFAULT_ATLASSIAN_URL)}`,
    '',
    'const rawArgs = process.argv.slice(2)',
    "const normalizedArgs = rawArgs.length ? rawArgs : [defaultUrl]",
    'process.argv = [process.argv[0], path.join(process.cwd(), "mcp-remote"), ...normalizedArgs]',
    "require('mcp-remote/dist/proxy.js')",
    '',
  ].join('\n'),
  'utf8',
)

run('npm', ['install', '--no-package-lock', '--no-save'], { cwd: workRoot })
run(path.join(workRoot, 'node_modules', '.bin', process.platform === 'win32' ? 'pkg.cmd' : 'pkg'), [
  entryPath,
  '--targets',
  pkgTarget,
  '--output',
  outputPath,
], { cwd: workRoot })

if (!fs.existsSync(outputPath)) {
  throw new Error(`pkg did not produce ${outputPath}`)
}

if (process.platform !== 'win32') {
  fs.chmodSync(outputPath, 0o755)
}

console.log(`Bundled Atlassian MCP sidecar: ${outputPath}`)
