import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function runGit(args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim()
}

function runGitInherit(args) {
  execFileSync('git', args, { stdio: 'inherit' })
}

const rootDir = resolve(import.meta.dirname, '..')
const packageJson = JSON.parse(readFileSync(resolve(rootDir, 'package.json'), 'utf8'))
const version = String(packageJson.version || '').trim()

if (!version) {
  console.error('package.json version is empty.')
  process.exit(1)
}

const tagName = `v${version}`
const branch = runGit(['branch', '--show-current'])
const status = runGit(['status', '--porcelain'])

if (!branch) {
  console.error('Cannot determine current git branch.')
  process.exit(1)
}

if (status) {
  console.error('Working tree is not clean. Commit or stash changes before release.')
  process.exit(1)
}

try {
  runGit(['rev-parse', '--verify', tagName])
  console.error(`Tag ${tagName} already exists.`)
  process.exit(1)
} catch {
  // Tag does not exist yet.
}

console.log(`Creating tag ${tagName} from ${branch}...`)
runGitInherit(['tag', tagName])

console.log(`Pushing ${branch} and ${tagName}...`)
runGitInherit(['push', 'origin', branch, tagName])

console.log(`Done. GitHub Actions release workflow should start for ${tagName}.`)
