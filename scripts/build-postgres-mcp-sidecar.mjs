import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const POSTGRES_MCP_VERSION = '0.3.0'
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

function getPythonVersion(command) {
  try {
    const raw = runQuiet(command, ['-c', 'import sys; print(f"{sys.version_info[0]}.{sys.version_info[1]}")'])
    const [majorRaw, minorRaw] = raw.split('.')
    const major = Number(majorRaw)
    const minor = Number(minorRaw)
    if (!Number.isFinite(major) || !Number.isFinite(minor)) return null
    return { major, minor }
  } catch {
    return null
  }
}

function findPython312OrNewer() {
  const candidates = [
    process.env.PYTHON_3_12_BIN,
    'python3.12',
    'python3',
    'python',
  ].filter(Boolean)

  for (const candidate of candidates) {
    const version = getPythonVersion(candidate)
    if (!version) continue
    if (version.major === 3 && version.minor >= 12) return candidate
  }

  throw new Error('Python 3.12+ is required to bundle postgres-mcp 0.3.0. Install Python 3.12 or set PYTHON_3_12_BIN.')
}

function getVenvPythonPath(venvDir) {
  return process.platform === 'win32'
    ? path.join(venvDir, 'Scripts', 'python.exe')
    : path.join(venvDir, 'bin', 'python')
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true })
}

function removeDirIfExists(dir) {
  fs.rmSync(dir, { recursive: true, force: true })
}

const targetTriple = getTargetTriple()
const outputPath = path.join(outputDir, `postgres-mcp-${targetTriple}${extension}`)

if (fs.existsSync(outputPath)) {
  console.log(`postgres-mcp sidecar already exists: ${outputPath}`)
  process.exit(0)
}

const python = findPython312OrNewer()
const workRoot = path.join(os.tmpdir(), `ruf-postgres-mcp-sidecar-${targetTriple}`)
const venvDir = path.join(workRoot, 'venv')
const buildDir = path.join(workRoot, 'build')
const distDir = path.join(workRoot, 'dist')
const specDir = path.join(workRoot, 'spec')
const entryPath = path.join(workRoot, 'postgres-mcp-entry.py')
const builtBinaryPath = path.join(distDir, `postgres-mcp${extension}`)

console.log(`Building postgres-mcp ${POSTGRES_MCP_VERSION} sidecar for ${targetTriple}`)
removeDirIfExists(workRoot)
ensureDir(workRoot)
ensureDir(outputDir)

run(python, ['-m', 'venv', venvDir])

const venvPython = getVenvPythonPath(venvDir)
run(venvPython, ['-m', 'pip', 'install', '--upgrade', 'pip'])
run(venvPython, ['-m', 'pip', 'install', `postgres-mcp==${POSTGRES_MCP_VERSION}`, 'pyinstaller'])

fs.writeFileSync(
  entryPath,
  [
    'from postgres_mcp import main',
    '',
    "if __name__ == '__main__':",
    '    main()',
    '',
  ].join('\n'),
  'utf8',
)

run(venvPython, [
  '-m',
  'PyInstaller',
  '--noconfirm',
  '--clean',
  '--onefile',
  '--name',
  'postgres-mcp',
  '--copy-metadata',
  'postgres-mcp',
  '--copy-metadata',
  'mcp',
  '--collect-submodules',
  'postgres_mcp',
  '--distpath',
  distDir,
  '--workpath',
  buildDir,
  '--specpath',
  specDir,
  entryPath,
])

if (!fs.existsSync(builtBinaryPath)) {
  throw new Error(`PyInstaller did not produce ${builtBinaryPath}`)
}

fs.copyFileSync(builtBinaryPath, outputPath)
if (process.platform !== 'win32') {
  fs.chmodSync(outputPath, 0o755)
}

console.log(`Bundled postgres-mcp sidecar: ${outputPath}`)
