#!/usr/bin/env node
/**
 * Lints Moldable apps to ensure they meet all requirements for running within Moldable.
 *
 * Usage:
 *   node scripts/lint-moldable-app.js apps/todo
 *   node scripts/lint-moldable-app.js apps/*
 *   pnpm lint:app apps/todo
 *   pnpm lint:apps
 */
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const COLORS = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m',
}

const ICONS = {
  pass: `${COLORS.green}✓${COLORS.reset}`,
  fail: `${COLORS.red}✗${COLORS.reset}`,
  warn: `${COLORS.yellow}⚠${COLORS.reset}`,
}

/**
 * @typedef {Object} LintResult
 * @property {string} rule - Rule name
 * @property {boolean} passed - Whether the check passed
 * @property {string} message - Human-readable message
 * @property {'error' | 'warning'} [severity] - Severity level
 */

/**
 * @typedef {Object} AppLintResult
 * @property {string} appPath - Path to the app
 * @property {string} appName - Name of the app (directory name)
 * @property {LintResult[]} results - Individual lint results
 * @property {number} errors - Count of errors
 * @property {number} warnings - Count of warnings
 */

/**
 * Check if a file exists
 * @param {string} filePath
 * @returns {Promise<boolean>}
 */
async function fileExists(filePath) {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

/**
 * Read file contents safely
 * @param {string} filePath
 * @returns {Promise<string | null>}
 */
async function readFile(filePath) {
  try {
    return await fs.readFile(filePath, 'utf8')
  } catch {
    return null
  }
}

/**
 * Parse JSON safely
 * @param {string} content
 * @returns {object | null}
 */
function parseJson(content) {
  try {
    return JSON.parse(content)
  } catch {
    return null
  }
}

/**
 * Find all .ts/.tsx source files in a directory, respecting .gitignore
 * Uses ripgrep (rg) which respects .gitignore by default
 * @param {string} dir
 * @returns {Promise<string[]>}
 */
async function findSourceFiles(dir) {
  const { execSync } = await import('child_process')

  try {
    // Use ripgrep to list files - it respects .gitignore by default
    // -t ts matches .ts and .tsx files
    // --files just lists matching files without searching content
    const output = execSync(`rg --files -t ts --glob '!*.d.ts' "${dir}"`, {
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
    })
    return output.trim().split('\n').filter(Boolean)
  } catch (error) {
    // If rg fails (not installed, no matches, etc.), fall back to manual walk
    if (error.status === 1) {
      // Exit code 1 means no matches found
      return []
    }
    console.warn(`${ICONS.warn} ripgrep failed, falling back to manual walk`)
    return findSourceFilesManual(dir)
  }
}

/**
 * Fallback: manually walk directory (less accurate, doesn't respect .gitignore)
 * @param {string} dir
 * @returns {Promise<string[]>}
 */
async function findSourceFilesManual(dir) {
  const files = []

  async function walk(currentDir) {
    try {
      const entries = await fs.readdir(currentDir, { withFileTypes: true })
      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name)

        // Skip common ignored directories
        if (
          entry.isDirectory() &&
          !['node_modules', '.next', 'dist', '.turbo', '.git'].includes(
            entry.name,
          )
        ) {
          await walk(fullPath)
        } else if (
          entry.isFile() &&
          (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) &&
          !entry.name.endsWith('.d.ts')
        ) {
          files.push(fullPath)
        }
      }
    } catch {
      // Ignore permission errors, etc.
    }
  }

  await walk(dir)
  return files
}

/**
 * Get the active workspace config path (workspace-aware)
 * @returns {Promise<string>}
 */
async function getActiveWorkspaceConfigPath() {
  const homeDir = os.homedir()
  const workspacesJsonPath = path.join(homeDir, '.moldable', 'workspaces.json')

  try {
    const workspacesContent = await readFile(workspacesJsonPath)
    if (workspacesContent) {
      const workspacesConfig = parseJson(workspacesContent)
      if (workspacesConfig && workspacesConfig.activeWorkspace) {
        return path.join(
          homeDir,
          '.moldable',
          'workspaces',
          workspacesConfig.activeWorkspace,
          'config.json',
        )
      }
    }
  } catch {
    // Fall through to legacy path
  }

  // Fall back to legacy config path
  return path.join(homeDir, '.moldable', 'config.json')
}

/**
 * Check if the app is registered in the Moldable config (workspace-aware)
 * @param {string} appPath
 * @returns {Promise<boolean>}
 */
async function isAppRegistered(appPath) {
  const configPath = await getActiveWorkspaceConfigPath()

  try {
    const configContent = await readFile(configPath)
    if (!configContent) return false

    const config = parseJson(configContent)
    if (!config || !Array.isArray(config.apps)) return false

    // An app is registered if its path matches one in the config
    const absAppPath = path.resolve(appPath)
    return config.apps.some((app) => {
      if (!app.path) return false
      return path.resolve(app.path) === absAppPath
    })
  } catch {
    return false
  }
}

/**
 * Find files that use localStorage
 * @param {string} appPath
 * @returns {Promise<string[]>} - List of relative file paths with localStorage usage
 */
async function findLocalStorageUsage(appPath) {
  const srcDir = path.join(appPath, 'src')
  if (!(await fileExists(srcDir))) {
    return []
  }

  const files = await findSourceFiles(srcDir)
  const filesWithLocalStorage = []

  // Patterns that indicate localStorage usage
  const localStoragePatterns = [
    /localStorage\./,
    /localStorage\[/,
    /window\.localStorage/,
    /sessionStorage\./, // Also warn about sessionStorage
  ]

  for (const file of files) {
    const content = await readFile(file)
    if (!content) continue

    // Skip files that are explicitly server-only
    if (
      content.includes("import 'server-only'") ||
      content.includes('import "server-only"')
    ) {
      continue
    }

    const hasLocalStorage = localStoragePatterns.some((pattern) =>
      pattern.test(content),
    )

    if (hasLocalStorage) {
      // Return relative path from app root
      filesWithLocalStorage.push(path.relative(appPath, file))
    }
  }

  return filesWithLocalStorage
}

/**
 * Lint a single Moldable app
 * @param {string} appPath - Path to the app directory
 * @returns {Promise<AppLintResult>}
 */
async function lintApp(appPath) {
  const appName = path.basename(appPath)
  /** @type {LintResult[]} */
  const results = []

  // ============================================
  // 1. Check moldable.json exists and is valid
  // ============================================
  const moldableJsonPath = path.join(appPath, 'moldable.json')
  const moldableJsonContent = await readFile(moldableJsonPath)

  if (!moldableJsonContent) {
    results.push({
      rule: 'moldable-json-exists',
      passed: false,
      message: 'Missing moldable.json manifest file',
      severity: 'error',
    })
  } else {
    results.push({
      rule: 'moldable-json-exists',
      passed: true,
      message: 'moldable.json exists',
    })

    const manifest = parseJson(moldableJsonContent)
    if (!manifest) {
      results.push({
        rule: 'moldable-json-valid',
        passed: false,
        message: 'moldable.json is not valid JSON',
        severity: 'error',
      })
    } else {
      results.push({
        rule: 'moldable-json-valid',
        passed: true,
        message: 'moldable.json is valid JSON',
      })

      // Check required fields
      const requiredFields = ['name', 'icon', 'description', 'widgetSize']
      const missingFields = requiredFields.filter((field) => !manifest[field])

      if (missingFields.length > 0) {
        results.push({
          rule: 'moldable-json-fields',
          passed: false,
          message: `moldable.json missing required fields: ${missingFields.join(', ')}`,
          severity: 'error',
        })
      } else {
        results.push({
          rule: 'moldable-json-fields',
          passed: true,
          message: 'moldable.json has all required fields',
        })
      }

      // Validate widgetSize
      const validSizes = ['small', 'medium', 'large']
      if (manifest.widgetSize && !validSizes.includes(manifest.widgetSize)) {
        results.push({
          rule: 'moldable-json-widget-size',
          passed: false,
          message: `Invalid widgetSize "${manifest.widgetSize}" - must be one of: ${validSizes.join(', ')}`,
          severity: 'error',
        })
      }

      // Validate env array if present
      if (manifest.env !== undefined) {
        if (!Array.isArray(manifest.env)) {
          results.push({
            rule: 'moldable-json-env',
            passed: false,
            message: 'env must be an array',
            severity: 'error',
          })
        } else {
          const invalidEnvs = manifest.env.filter(
            (e) => !e.key || !e.name || !e.description,
          )
          if (invalidEnvs.length > 0) {
            results.push({
              rule: 'moldable-json-env',
              passed: false,
              message:
                'Each env entry must have key, name, and description fields',
              severity: 'error',
            })
          }
        }
      }
    }
  }

  // ============================================
  // 2. Check next.config.ts has devIndicators: false
  // ============================================
  const nextConfigPath = path.join(appPath, 'next.config.ts')
  const nextConfigContent = await readFile(nextConfigPath)

  if (!nextConfigContent) {
    results.push({
      rule: 'next-config-exists',
      passed: false,
      message: 'Missing next.config.ts',
      severity: 'error',
    })
  } else {
    results.push({
      rule: 'next-config-exists',
      passed: true,
      message: 'next.config.ts exists',
    })

    // Check for devIndicators: false
    const hasDevIndicatorsFalse = /devIndicators\s*:\s*false/.test(
      nextConfigContent,
    )
    if (!hasDevIndicatorsFalse) {
      results.push({
        rule: 'next-config-dev-indicators',
        passed: false,
        message:
          'next.config.ts must have devIndicators: false to hide dev UI in Moldable',
        severity: 'error',
      })
    } else {
      results.push({
        rule: 'next-config-dev-indicators',
        passed: true,
        message: 'next.config.ts has devIndicators: false',
      })
    }
  }

  // ============================================
  // 3. Check moldable-dev.mjs exists
  // ============================================
  const moldableDevPath = path.join(appPath, 'scripts', 'moldable-dev.mjs')
  if (!(await fileExists(moldableDevPath))) {
    results.push({
      rule: 'moldable-dev-script',
      passed: false,
      message: 'Missing scripts/moldable-dev.mjs startup script',
      severity: 'error',
    })
  } else {
    results.push({
      rule: 'moldable-dev-script',
      passed: true,
      message: 'scripts/moldable-dev.mjs exists',
    })

    // Check for correct pnpm filter syntax in moldable-dev.mjs
    const moldableDevContent = await readFile(moldableDevPath)
    if (moldableDevContent) {
      const usesNext =
        moldableDevContent.includes("'next'") ||
        moldableDevContent.includes('"next"')
      const hasDev =
        moldableDevContent.includes("'dev'") ||
        moldableDevContent.includes('"dev"')
      const hasInstanceTracking = moldableDevContent.includes(
        '.moldable.instances.json',
      )

      if (!usesNext || !hasDev || !hasInstanceTracking) {
        results.push({
          rule: 'moldable-dev-syntax',
          passed: false,
          message: `scripts/moldable-dev.mjs should use the standard Moldable template (like Scribo) including instance tracking and direct 'next' execution`,
          severity: 'error',
        })
      } else {
        results.push({
          rule: 'moldable-dev-syntax',
          passed: true,
          message:
            'scripts/moldable-dev.mjs follows the standard Moldable template',
        })
      }
    }
  }

  // ============================================
  // 3b. Check package.json dev script uses moldable-dev.mjs
  // ============================================
  const packageJsonPath = path.join(appPath, 'package.json')
  const packageJsonContent = await readFile(packageJsonPath)

  if (packageJsonContent) {
    const packageJson = parseJson(packageJsonContent)
    if (packageJson && packageJson.scripts && packageJson.scripts.dev) {
      const devScript = packageJson.scripts.dev
      const usesMoldableDev = devScript.includes('moldable-dev.mjs')

      if (!usesMoldableDev) {
        results.push({
          rule: 'package-json-dev-script',
          passed: false,
          message: `package.json dev script must use moldable-dev.mjs (found: "${devScript}"). Change to: "node ./scripts/moldable-dev.mjs"`,
          severity: 'error',
        })
      } else {
        results.push({
          rule: 'package-json-dev-script',
          passed: true,
          message: 'package.json dev script uses moldable-dev.mjs',
        })
      }
    } else {
      results.push({
        rule: 'package-json-dev-script',
        passed: false,
        message: 'package.json must have a dev script',
        severity: 'error',
      })
    }
  }

  // ============================================
  // 4. Check widget directory and files
  // ============================================
  const widgetDir = path.join(appPath, 'src', 'app', 'widget')
  const widgetLayoutPath = path.join(widgetDir, 'layout.tsx')
  const widgetPagePath = path.join(widgetDir, 'page.tsx')

  if (!(await fileExists(widgetDir))) {
    results.push({
      rule: 'widget-dir',
      passed: false,
      message:
        'Missing src/app/widget/ directory - apps must have a widget view',
      severity: 'error',
    })
  } else {
    results.push({
      rule: 'widget-dir',
      passed: true,
      message: 'src/app/widget/ directory exists',
    })

    // Check widget/layout.tsx
    if (!(await fileExists(widgetLayoutPath))) {
      results.push({
        rule: 'widget-layout',
        passed: false,
        message: 'Missing src/app/widget/layout.tsx',
        severity: 'error',
      })
    } else {
      results.push({
        rule: 'widget-layout',
        passed: true,
        message: 'src/app/widget/layout.tsx exists',
      })

      // Check that layout uses WidgetLayout from @moldable-ai/ui
      const widgetLayoutContent = await readFile(widgetLayoutPath)
      if (widgetLayoutContent) {
        const importsWidgetLayout =
          /import\s+\{[^}]*WidgetLayout[^}]*\}\s+from\s+['"]@moldable-ai\/ui['"]/.test(
            widgetLayoutContent,
          )
        const usesWidgetLayout = /<WidgetLayout[^>]*>/.test(widgetLayoutContent)

        if (!importsWidgetLayout || !usesWidgetLayout) {
          results.push({
            rule: 'widget-layout-wrapper',
            passed: false,
            message:
              'Widget layout must import and use <WidgetLayout> from @moldable-ai/ui',
            severity: 'error',
          })
        } else {
          results.push({
            rule: 'widget-layout-wrapper',
            passed: true,
            message: 'Widget layout uses <WidgetLayout> from @moldable-ai/ui',
          })
        }
      }
    }

    // Check widget/page.tsx
    if (!(await fileExists(widgetPagePath))) {
      results.push({
        rule: 'widget-page',
        passed: false,
        message: 'Missing src/app/widget/page.tsx',
        severity: 'error',
      })
    } else {
      results.push({
        rule: 'widget-page',
        passed: true,
        message: 'src/app/widget/page.tsx exists',
      })

      // Check for ghost-style empty state (GHOST_EXAMPLES)
      const widgetPageContent = await readFile(widgetPagePath)
      if (widgetPageContent) {
        const hasGhostExamples = widgetPageContent.includes('GHOST_EXAMPLES')
        if (!hasGhostExamples) {
          results.push({
            rule: 'widget-ghost-state',
            passed: false,
            message:
              'Widget page should include GHOST_EXAMPLES for a ghost-style empty state consistency',
            severity: 'warning',
          })
        } else {
          results.push({
            rule: 'widget-ghost-state',
            passed: true,
            message: 'Widget page includes ghost-style empty state',
          })
        }
      }
    }
  }

  // ============================================
  // 5. Check health route exists
  // ============================================
  const healthRoutePath = path.join(
    appPath,
    'src',
    'app',
    'api',
    'moldable',
    'health',
    'route.ts',
  )
  if (!(await fileExists(healthRoutePath))) {
    results.push({
      rule: 'health-route',
      passed: false,
      message:
        'Missing src/app/api/moldable/health/route.ts - required for Moldable to check app status',
      severity: 'error',
    })
  } else {
    results.push({
      rule: 'health-route',
      passed: true,
      message: 'src/app/api/moldable/health/route.ts exists',
    })
  }

  // ============================================
  // 6. Check for .gitignore
  // ============================================
  const gitignorePath = path.join(appPath, '.gitignore')
  const gitignoreContent = await readFile(gitignorePath)
  if (!gitignoreContent) {
    results.push({
      rule: 'gitignore-exists',
      passed: false,
      message: 'Missing .gitignore file',
      severity: 'error',
    })
  } else {
    const hasNext = gitignoreContent.includes('.next')
    const hasModules = gitignoreContent.includes('node_modules')
    if (!hasNext || !hasModules) {
      results.push({
        rule: 'gitignore-content',
        passed: false,
        message: '.gitignore must ignore .next and node_modules',
        severity: 'error',
      })
    } else {
      results.push({
        rule: 'gitignore-valid',
        passed: true,
        message: '.gitignore exists and is valid',
      })
    }
  }

  // ============================================
  // 7. Check for .eslintrc.json
  // ============================================
  const eslintrcPath = path.join(appPath, '.eslintrc.json')
  if (!(await fileExists(eslintrcPath))) {
    results.push({
      rule: 'eslint-config-exists',
      passed: false,
      message: 'Missing .eslintrc.json (required for monorepo linting)',
      severity: 'error',
    })
  } else {
    results.push({
      rule: 'eslint-config-exists',
      passed: true,
      message: '.eslintrc.json exists',
    })
  }

  // ============================================
  // 8. Check for localStorage usage (warning)
  // ============================================
  const localStorageUsage = await findLocalStorageUsage(appPath)
  if (localStorageUsage.length > 0) {
    results.push({
      rule: 'no-localstorage',
      passed: false,
      message: `Found localStorage usage in ${localStorageUsage.length} file(s): ${localStorageUsage.slice(0, 3).join(', ')}${localStorageUsage.length > 3 ? '...' : ''}. Use @moldable-ai/storage for filesystem persistence instead.`,
      severity: 'warning',
    })
  } else {
    results.push({
      rule: 'no-localstorage',
      passed: true,
      message:
        'No localStorage usage found (good - use @moldable-ai/storage instead)',
    })
  }

  // ============================================
  // 7b. Check for WorkspaceProvider usage
  // ============================================
  const mainLayoutPath = path.join(appPath, 'src', 'app', 'layout.tsx')
  const mainLayoutContent = await readFile(mainLayoutPath)

  if (mainLayoutContent) {
    const importsWorkspaceProvider =
      /import\s+\{[^}]*WorkspaceProvider[^}]*\}\s+from\s+['"]@moldable-ai\/ui['"]/.test(
        mainLayoutContent,
      )
    const usesWorkspaceProvider = /<WorkspaceProvider[^>]*>/.test(
      mainLayoutContent,
    )

    // Also check if there's a providers.tsx that might wrap things
    const providersPath = path.join(
      appPath,
      'src',
      'components',
      'providers.tsx',
    )
    const providersContent = await readFile(providersPath)
    const providersHasWorkspace = providersContent
      ? /WorkspaceProvider/.test(providersContent)
      : false

    if (
      !importsWorkspaceProvider &&
      !usesWorkspaceProvider &&
      !providersHasWorkspace
    ) {
      results.push({
        rule: 'workspace-provider',
        passed: false,
        message:
          'App layout must use <WorkspaceProvider> from @moldable-ai/ui for workspace-aware data isolation',
        severity: 'error',
      })
    } else {
      results.push({
        rule: 'workspace-provider',
        passed: true,
        message:
          'App uses WorkspaceProvider for workspace-aware data isolation',
      })
    }
  }

  // ============================================
  // 9. Check if app is registered in config.json
  // ============================================
  const registered = await isAppRegistered(appPath)
  if (!registered) {
    results.push({
      rule: 'app-registered',
      passed: false,
      message:
        'App is not registered in workspace config.json. Add it to the apps array so it appears in the UI.',
      severity: 'error',
    })
  } else {
    results.push({
      rule: 'app-registered',
      passed: true,
      message: 'App is registered in workspace config.json',
    })
  }

  // Calculate totals
  const errors = results.filter(
    (r) => !r.passed && r.severity === 'error',
  ).length
  const warnings = results.filter(
    (r) => !r.passed && r.severity === 'warning',
  ).length

  return { appPath, appName, results, errors, warnings }
}

/**
 * Print results for a single app
 * @param {AppLintResult} result
 */
function printAppResult(result) {
  const statusIcon =
    result.errors > 0
      ? ICONS.fail
      : result.warnings > 0
        ? ICONS.warn
        : ICONS.pass
  console.log(`\n${statusIcon} ${COLORS.cyan}${result.appName}${COLORS.reset}`)
  console.log(`  ${COLORS.dim}${result.appPath}${COLORS.reset}`)

  for (const check of result.results) {
    if (check.passed) {
      console.log(`  ${ICONS.pass} ${check.message}`)
    } else {
      const icon = check.severity === 'warning' ? ICONS.warn : ICONS.fail
      console.log(`  ${icon} ${check.message}`)
    }
  }

  if (result.errors > 0 || result.warnings > 0) {
    const parts = []
    if (result.errors > 0)
      parts.push(`${COLORS.red}${result.errors} error(s)${COLORS.reset}`)
    if (result.warnings > 0)
      parts.push(`${COLORS.yellow}${result.warnings} warning(s)${COLORS.reset}`)
    console.log(`\n  ${parts.join(', ')}`)
  }
}

/**
 * Main entry point
 */
async function main() {
  const args = process.argv.slice(2)

  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    console.log(`
${COLORS.cyan}lint-moldable-app${COLORS.reset} - Lint Moldable apps for compliance

${COLORS.yellow}Usage:${COLORS.reset}
  pnpm lint:app <app-path>     Lint a single app
  pnpm lint:apps               Lint all apps in apps/

${COLORS.yellow}Examples:${COLORS.reset}
  pnpm lint:app apps/todo
  pnpm lint:app apps/scribo
  pnpm lint:apps

${COLORS.yellow}Checks:${COLORS.reset}
  • moldable.json exists with required fields (name, icon, description, widgetSize)
  • next.config.ts has devIndicators: false
  • scripts/moldable-dev.mjs exists
  • package.json dev script uses moldable-dev.mjs (not "next dev" directly)
  • src/app/widget/ exists with layout.tsx and page.tsx
  • Widget layout uses <WidgetLayout> from @moldable-ai/ui
  • src/app/api/moldable/health/route.ts exists
  • scripts/moldable-dev.mjs follows the standard Moldable template
  • .gitignore exists and ignores .next and node_modules
  • .eslintrc.json exists (required for workspace linting)
  • App is registered in config.json
  • No localStorage usage (warning) - use @moldable-ai/storage instead
  • Uses <WorkspaceProvider> for workspace-aware data isolation
`)
    process.exit(0)
  }

  // Resolve app paths
  let appPaths = []

  for (const arg of args) {
    if (arg.endsWith('/*') || arg.endsWith('\\*')) {
      // Directory wildcard - list all subdirectories
      const dir = arg.slice(0, -2)
      const absDir = path.resolve(process.cwd(), dir)
      try {
        const entries = await fs.readdir(absDir, { withFileTypes: true })
        for (const entry of entries) {
          if (entry.isDirectory()) {
            appPaths.push(path.join(absDir, entry.name))
          }
        }
      } catch {
        console.warn(`${ICONS.warn} Could not read directory: ${dir}`)
      }
    } else {
      appPaths.push(arg)
    }
  }

  // Filter to only directories that look like apps (have package.json)
  const validAppPaths = []
  for (const p of appPaths) {
    const absPath = path.resolve(process.cwd(), p)
    if (await fileExists(path.join(absPath, 'package.json'))) {
      validAppPaths.push(absPath)
    }
  }

  if (validAppPaths.length === 0) {
    console.error(
      `${ICONS.fail} No valid Moldable apps found in: ${args.join(', ')}`,
    )
    process.exit(1)
  }

  console.log(
    `${COLORS.cyan}Linting ${validAppPaths.length} Moldable app(s)...${COLORS.reset}`,
  )

  // Lint all apps
  const results = await Promise.all(validAppPaths.map(lintApp))

  // Print results
  for (const result of results) {
    printAppResult(result)
  }

  // Summary
  const totalErrors = results.reduce((sum, r) => sum + r.errors, 0)
  const totalWarnings = results.reduce((sum, r) => sum + r.warnings, 0)

  console.log('\n' + '─'.repeat(50))

  if (totalErrors === 0 && totalWarnings === 0) {
    console.log(
      `${ICONS.pass} All ${results.length} app(s) passed lint checks!`,
    )
    process.exit(0)
  } else {
    const parts = []
    if (totalErrors > 0)
      parts.push(`${COLORS.red}${totalErrors} error(s)${COLORS.reset}`)
    if (totalWarnings > 0)
      parts.push(`${COLORS.yellow}${totalWarnings} warning(s)${COLORS.reset}`)
    console.log(
      `${ICONS.fail} ${parts.join(', ')} across ${results.length} app(s)`,
    )
    process.exit(1)
  }
}

main().catch((err) => {
  console.error(`${ICONS.fail} Fatal error:`, err)
  process.exit(1)
})
