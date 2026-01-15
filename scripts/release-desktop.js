#!/usr/bin/env node
/**
 * Desktop Release Script
 *
 * Usage:
 *   pnpm release:desktop patch    # 0.1.0 -> 0.1.1
 *   pnpm release:desktop minor    # 0.1.0 -> 0.2.0
 *   pnpm release:desktop major    # 0.1.0 -> 1.0.0
 *   pnpm release:desktop 0.2.0    # Set specific version
 *
 * This script:
 * 1. Bumps version in package.json, tauri.conf.json, and Cargo.toml
 * 2. Commits the version bump
 * 3. Creates a git tag (desktop-v0.x.x)
 * 4. Pushes to trigger the release workflow
 */
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')
const desktopDir = path.join(rootDir, 'desktop')

const PACKAGE_JSON = path.join(desktopDir, 'package.json')
const TAURI_CONF = path.join(desktopDir, 'src-tauri', 'tauri.conf.json')
const CARGO_TOML = path.join(desktopDir, 'src-tauri', 'Cargo.toml')

function getCurrentVersion() {
  const pkg = JSON.parse(fs.readFileSync(PACKAGE_JSON, 'utf8'))
  return pkg.version
}

function parseVersion(version) {
  const parts = version.split('.').map(Number)
  if (parts.length !== 3 || parts.some(isNaN)) {
    throw new Error(`Invalid version format: ${version}`)
  }
  return { major: parts[0], minor: parts[1], patch: parts[2] }
}

function bumpVersion(current, type) {
  const v = parseVersion(current)

  switch (type) {
    case 'major':
      return `${v.major + 1}.0.0`
    case 'minor':
      return `${v.major}.${v.minor + 1}.0`
    case 'patch':
      return `${v.major}.${v.minor}.${v.patch + 1}`
    default:
      // Assume it's a specific version
      parseVersion(type) // Validate format
      return type
  }
}

function updatePackageJson(version) {
  const pkg = JSON.parse(fs.readFileSync(PACKAGE_JSON, 'utf8'))
  pkg.version = version
  fs.writeFileSync(PACKAGE_JSON, JSON.stringify(pkg, null, 2) + '\n')
  console.log(`  Updated ${path.relative(rootDir, PACKAGE_JSON)}`)
}

function updateTauriConf(version) {
  const conf = JSON.parse(fs.readFileSync(TAURI_CONF, 'utf8'))
  conf.version = version
  fs.writeFileSync(TAURI_CONF, JSON.stringify(conf, null, 2) + '\n')
  console.log(`  Updated ${path.relative(rootDir, TAURI_CONF)}`)
}

function updateCargoToml(version) {
  let content = fs.readFileSync(CARGO_TOML, 'utf8')
  // Replace the version in [package] section
  content = content.replace(/^(version\s*=\s*")[^"]+(")/m, `$1${version}$2`)
  fs.writeFileSync(CARGO_TOML, content)
  console.log(`  Updated ${path.relative(rootDir, CARGO_TOML)}`)
}

function exec(cmd, options = {}) {
  console.log(`  $ ${cmd}`)
  return execSync(cmd, { stdio: 'inherit', cwd: rootDir, ...options })
}

function main() {
  const args = process.argv.slice(2)

  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    console.log(`
Desktop Release Script

Usage:
  pnpm release:desktop <version-type>

Arguments:
  patch    Bump patch version (0.1.0 -> 0.1.1)
  minor    Bump minor version (0.1.0 -> 0.2.0)
  major    Bump major version (0.1.0 -> 1.0.0)
  x.y.z    Set specific version

Options:
  --dry-run    Show what would happen without making changes
  --no-push    Create tag but don't push (manual push later)

Examples:
  pnpm release:desktop patch
  pnpm release:desktop 1.0.0
  pnpm release:desktop minor --dry-run
`)
    process.exit(0)
  }

  const dryRun = args.includes('--dry-run')
  const noPush = args.includes('--no-push')
  const versionArg = args.find((a) => !a.startsWith('--'))

  if (!versionArg) {
    console.error(
      'Error: Please specify a version type (patch, minor, major) or version number',
    )
    process.exit(1)
  }

  // Check for uncommitted changes
  try {
    execSync('git diff-index --quiet HEAD --', { cwd: rootDir })
  } catch {
    console.error(
      'Error: You have uncommitted changes. Please commit or stash them first.',
    )
    process.exit(1)
  }

  const currentVersion = getCurrentVersion()
  const newVersion = bumpVersion(currentVersion, versionArg)
  const tagName = `desktop-v${newVersion}`

  console.log(`\nReleasing Moldable Desktop`)
  console.log(`  Current version: ${currentVersion}`)
  console.log(`  New version: ${newVersion}`)
  console.log(`  Tag: ${tagName}`)

  if (dryRun) {
    console.log(`\n[DRY RUN] Would perform the following:`)
    console.log(
      `  1. Update version in package.json, tauri.conf.json, Cargo.toml`,
    )
    console.log(`  2. Commit: "release: desktop v${newVersion}"`)
    console.log(`  3. Create tag: ${tagName}`)
    if (!noPush) {
      console.log(`  4. Push to origin (triggers release workflow)`)
    }
    process.exit(0)
  }

  console.log(`\nUpdating version files...`)
  updatePackageJson(newVersion)
  updateTauriConf(newVersion)
  updateCargoToml(newVersion)

  console.log(`\nCommitting changes...`)
  exec(`git add ${PACKAGE_JSON} ${TAURI_CONF} ${CARGO_TOML}`)
  exec(`git commit -m "release: desktop v${newVersion}"`)

  console.log(`\nCreating tag...`)
  exec(`git tag -a ${tagName} -m "Moldable Desktop v${newVersion}"`)

  if (noPush) {
    console.log(`\nTag created locally. Push manually with:`)
    console.log(`  git push origin main ${tagName}`)
  } else {
    console.log(`\nPushing to origin...`)
    exec(`git push origin main ${tagName}`)
    console.log(`\nRelease workflow triggered! Check progress at:`)
    console.log(`  https://github.com/moldable-ai/moldable/actions`)
  }

  console.log(`\nDone! Version ${newVersion} is being released.`)
}

main()
