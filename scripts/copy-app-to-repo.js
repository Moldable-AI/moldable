#!/usr/bin/env node
/**
 * Copy apps from ~/.moldable/shared/apps to ~/moldable-apps
 *
 * Usage:
 *   pnpm app:copy scribo          # Copy single app
 *   pnpm app:copy scribo notes    # Copy multiple apps
 *   pnpm app:copy --all           # Copy all apps
 *
 * This lets you develop apps locally in ~/.moldable/shared/apps
 * and then copy them to the public moldable-apps repo for sharing.
 */
import {
  cpSync,
  existsSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from 'fs'
import { homedir } from 'os'
import { basename, join, relative } from 'path'

const SOURCE_DIR = join(homedir(), '.moldable', 'shared', 'apps')
const TARGET_DIR = join(homedir(), 'moldable-apps')

// Moldable runtime files to always exclude (not typically in .gitignore)
const ALWAYS_EXCLUDE = ['.moldable.port', '.moldable.instances.json']

/**
 * Parse a .gitignore file and return patterns to exclude
 */
function parseGitignore(gitignorePath) {
  if (!existsSync(gitignorePath)) {
    return []
  }

  const content = readFileSync(gitignorePath, 'utf-8')
  return content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#')) // Remove comments and empty lines
    .map((pattern) => pattern.replace(/\/$/, '')) // Remove trailing slashes
}

/**
 * Check if a path matches any of the exclude patterns
 */
function shouldExclude(filePath, sourceRoot, patterns) {
  const name = basename(filePath)
  const relativePath = relative(sourceRoot, filePath)

  // Always exclude Moldable runtime files
  if (ALWAYS_EXCLUDE.includes(name)) {
    return true
  }

  // Check against gitignore patterns
  for (const pattern of patterns) {
    // Simple pattern matching (handles most common cases)
    if (pattern === name) return true
    if (pattern === relativePath) return true
    if (relativePath.startsWith(pattern + '/')) return true
    if (relativePath.includes('/' + pattern + '/')) return true
    if (relativePath.endsWith('/' + pattern)) return true
  }

  return false
}

function copyApp(appId) {
  const sourceApp = join(SOURCE_DIR, appId)
  const targetApp = join(TARGET_DIR, appId)

  if (!existsSync(sourceApp)) {
    console.error(`❌ App '${appId}' not found in ${SOURCE_DIR}`)
    return false
  }

  // Parse the app's .gitignore for exclusion patterns
  const gitignorePath = join(sourceApp, '.gitignore')
  const excludePatterns = parseGitignore(gitignorePath)

  console.log(`📦 Copying ${appId}...`)
  console.log(`   From: ${sourceApp}`)
  console.log(`   To:   ${targetApp}`)
  if (excludePatterns.length > 0) {
    console.log(
      `   Excluding: ${excludePatterns.slice(0, 5).join(', ')}${excludePatterns.length > 5 ? '...' : ''}`,
    )
  }

  // Remove existing target if it exists
  if (existsSync(targetApp)) {
    console.log(`   Removing existing ${appId}...`)
    rmSync(targetApp, { recursive: true, force: true })
  }

  // Copy with filter based on .gitignore patterns
  cpSync(sourceApp, targetApp, {
    recursive: true,
    filter: (src) => {
      return !shouldExclude(src, sourceApp, excludePatterns)
    },
  })

  console.log(`   ✅ Done`)
  return true
}

function listAvailableApps() {
  if (!existsSync(SOURCE_DIR)) {
    console.error(`❌ Source directory not found: ${SOURCE_DIR}`)
    return []
  }

  return readdirSync(SOURCE_DIR).filter((name) => {
    const fullPath = join(SOURCE_DIR, name)
    return statSync(fullPath).isDirectory() && !name.startsWith('.')
  })
}

function main() {
  const args = process.argv.slice(2)

  if (args.length === 0) {
    const apps = listAvailableApps()
    console.log('Usage: pnpm app:copy <app-id> [app-id...] | --all')
    console.log('')
    console.log('Available apps:')
    if (apps.length === 0) {
      console.log('  (none found)')
    } else {
      apps.forEach((app) => console.log(`  - ${app}`))
    }
    process.exit(1)
  }

  if (!existsSync(TARGET_DIR)) {
    console.error(`❌ Target directory not found: ${TARGET_DIR}`)
    console.error('   Make sure you have the moldable-apps repo cloned there.')
    process.exit(1)
  }

  let appsToCopy = args

  if (args.includes('--all')) {
    appsToCopy = listAvailableApps()
    if (appsToCopy.length === 0) {
      console.log('No apps found to copy.')
      process.exit(0)
    }
    console.log(`Copying all ${appsToCopy.length} apps...\n`)
  }

  let success = 0
  let failed = 0

  for (const appId of appsToCopy) {
    if (appId.startsWith('--')) continue // Skip flags
    if (copyApp(appId)) {
      success++
    } else {
      failed++
    }
  }

  console.log('')
  console.log(
    `✨ Copied ${success} app(s)${failed > 0 ? `, ${failed} failed` : ''}`,
  )

  if (success > 0) {
    console.log('')
    console.log('Next steps:')
    console.log(`  cd ${TARGET_DIR}`)
    console.log('  node scripts/generate-manifest.js')
    console.log('  git add . && git commit -m "Update apps"')
    console.log('  git push')
  }
}

main()
