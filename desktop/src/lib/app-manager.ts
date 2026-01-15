import { invoke } from '@tauri-apps/api/core'
import { convertFileSrc } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'

export interface AppStatus {
  running: boolean
  pid: number | null
  exit_code: number | null
  recent_output: string[]
  /** The actual port the app is running on (may differ from configured port) */
  actual_port: number | null
}

export interface PortInfo {
  port: number
  pid: number | null
  process_name: string | null
  command: string | null
}

export type AutoStartResult =
  | { status: 'already_running'; port: number }
  | { status: 'started'; port: number }
  | {
      status: 'port_conflict'
      port: number
      info: PortInfo | null
      suggestedPort: number
    }

export interface AppConfig {
  id: string
  name: string
  icon: string
  iconPath?: string
  port: number
  workingDir: string
  command: string
  args: string[]
  widgetSize: 'small' | 'medium' | 'large'
  /** If true, app requires this specific port (show kill dialog on conflict) */
  requiresPort: boolean
}

// Registered app from config (Rust format)
interface RegisteredApp {
  id: string
  name: string
  icon: string
  icon_path?: string
  port: number
  path: string
  command: string
  args: string[]
  widget_size: string
  requires_port: boolean
}

// Check if running in Tauri
export const isTauri = () => {
  return typeof window !== 'undefined' && '__TAURI__' in window
}

// Convert RegisteredApp to AppConfig
function toAppConfig(app: RegisteredApp): AppConfig {
  // Convert file path to asset URL for Tauri webview
  let iconPath = app.icon_path
  if (iconPath && isTauri()) {
    // Remove asset: prefix if present (added by Rust backend)
    if (iconPath.startsWith('asset:')) {
      iconPath = iconPath.replace('asset:', '')
    }
    // Convert to Tauri asset URL
    iconPath = convertFileSrc(iconPath)
  }

  return {
    id: app.id,
    name: app.name,
    icon: app.icon,
    iconPath,
    port: app.port,
    workingDir: app.path,
    command: app.command,
    args: app.args,
    widgetSize: app.widget_size as 'small' | 'medium' | 'large',
    requiresPort: app.requires_port,
  }
}

export async function startApp(
  app: AppConfig,
  overridePort?: number,
): Promise<AppStatus> {
  if (!isTauri()) {
    // Fallback for browser dev - just check if port is accessible
    const running = await checkPort(app.port)
    return {
      running,
      pid: null,
      exit_code: null,
      recent_output: [],
      actual_port: null,
    }
  }

  // If overriding port, update the args to use new port
  let args = app.args
  const port = overridePort ?? app.port
  if (overridePort) {
    // Replace -p <port> or --port <port> in args
    args = args.map((arg, i, arr) => {
      if (
        (arr[i - 1] === '-p' || arr[i - 1] === '--port') &&
        /^\d+$/.test(arg)
      ) {
        return port.toString()
      }
      return arg
    })
  }

  return invoke<AppStatus>('start_app', {
    appId: app.id,
    workingDir: app.workingDir,
    command: app.command,
    args,
    port,
  })
}

/**
 * Start an app in a "bulletproof" way:
 * - If already running somewhere (process/port discovery), return that port.
 * - If requiresPort=false (default), auto-pick a free port if the preferred port is busy.
 * - If requiresPort=true, return a conflict descriptor (callers can show kill dialog).
 */
export async function autoStartApp(app: AppConfig): Promise<AutoStartResult> {
  // If already running, use the discovered port
  const runningPort = await discoverAppPort(app.id, app.workingDir)
  if (runningPort) {
    return { status: 'already_running', port: runningPort }
  }

  const preferred = app.port
  const available = await isPortAvailable(preferred)
  if (!available) {
    if (app.requiresPort) {
      const [info, suggestedPort] = await Promise.all([
        getPortInfo(preferred),
        findFreePort(preferred + 1),
      ])
      return { status: 'port_conflict', port: preferred, info, suggestedPort }
    }

    const free = await findFreePort(preferred)
    await startApp(app, free === preferred ? undefined : free)
    return { status: 'started', port: free }
  }

  await startApp(app)
  return { status: 'started', port: preferred }
}

// Get all registered apps from config
export async function getRegisteredApps(): Promise<AppConfig[]> {
  if (!isTauri()) {
    return []
  }

  const apps = await invoke<RegisteredApp[]>('get_registered_apps')
  return apps.map(toAppConfig)
}

// Open folder picker and detect app
export async function addAppFromFolder(): Promise<AppConfig | null> {
  if (!isTauri()) {
    return null
  }

  const selected = await open({
    directory: true,
    multiple: false,
    title: 'Select App Folder',
  })

  if (!selected) {
    return null
  }

  const path = typeof selected === 'string' ? selected : selected[0]
  if (!path) {
    return null
  }

  // Detect app type
  const detected = await invoke<RegisteredApp | null>('detect_app_in_folder', {
    path,
  })

  if (!detected) {
    throw new Error(
      'Could not detect app in folder. Make sure it has a package.json with a dev script.',
    )
  }

  // Register it
  await invoke<RegisteredApp[]>('register_app', { app: detected })

  return toAppConfig(detected)
}

// Remove an app from the registry
export async function removeApp(appId: string): Promise<void> {
  if (!isTauri()) {
    return
  }

  await invoke<RegisteredApp[]>('unregister_app', { appId })
}

// Available app info for installation (local workspace apps)
export interface AvailableApp {
  id: string
  name: string
  icon: string
  iconPath?: string
  description?: string
  path: string
  widgetSize: 'small' | 'medium' | 'large'
}

// Rust format for AvailableApp
interface AvailableAppRust {
  id: string
  name: string
  icon: string
  icon_path?: string
  description?: string
  path: string
  widget_size: string
}

// Convert Rust AvailableApp to TypeScript format
function toAvailableApp(app: AvailableAppRust): AvailableApp {
  let iconPath = app.icon_path
  if (iconPath && isTauri()) {
    if (iconPath.startsWith('asset:')) {
      iconPath = iconPath.replace('asset:', '')
    }
    iconPath = convertFileSrc(iconPath)
  }

  return {
    id: app.id,
    name: app.name,
    icon: app.icon,
    iconPath,
    description: app.description,
    path: app.path,
    widgetSize: app.widget_size as 'small' | 'medium' | 'large',
  }
}

// List available apps from the workspace that aren't yet installed
export async function getAvailableApps(): Promise<AvailableApp[]> {
  if (!isTauri()) {
    return []
  }

  const apps = await invoke<AvailableAppRust[]>('list_available_apps')
  return apps.map(toAvailableApp)
}

// Install an available app by path
export async function installAvailableApp(path: string): Promise<AppConfig> {
  if (!isTauri()) {
    throw new Error('Not running in Tauri')
  }

  const app = await invoke<RegisteredApp>('install_available_app', { path })
  return toAppConfig(app)
}

// ==================== App Registry (GitHub) ====================

// Entry for an app in the remote registry manifest
export interface AppRegistryEntry {
  id: string
  name: string
  version: string
  description?: string
  icon: string
  iconUrl?: string
  widgetSize: string
  category?: string
  tags?: string[]
  path: string
  requiredEnv?: string[]
  moldableDependencies?: Record<string, string>
  /** Commit SHA to install from */
  commit: string
}

// Category in the registry
export interface Category {
  id: string
  name: string
  icon: string
}

// The full app registry manifest from GitHub
export interface AppRegistry {
  version: string
  generatedAt?: string
  registry: string
  apps: AppRegistryEntry[]
  categories?: Category[]
}

// Fetch the app registry from GitHub (cached for 1 hour)
export async function fetchAppRegistry(
  forceRefresh = false,
): Promise<AppRegistry> {
  if (!isTauri()) {
    // Return empty registry for non-Tauri env
    return {
      version: '1',
      registry: 'moldable-ai/apps',
      apps: [],
      categories: [],
    }
  }

  return invoke<AppRegistry>('fetch_app_registry', { forceRefresh })
}

// Install an app from the registry (downloads from GitHub)
export async function installAppFromRegistry(
  appId: string,
  appPath: string,
  commit: string,
  version: string,
): Promise<AppConfig> {
  if (!isTauri()) {
    throw new Error('Not running in Tauri')
  }

  const app = await invoke<RegisteredApp>('install_app_from_registry', {
    appId,
    appPath,
    commit,
    version,
  })
  return toAppConfig(app)
}

// Uninstall an app from the shared directory
export async function uninstallAppFromShared(appId: string): Promise<void> {
  if (!isTauri()) {
    return
  }

  await invoke('uninstall_app_from_shared', { appId })
}

// Get the configured workspace path
export async function getWorkspacePath(): Promise<string | null> {
  if (!isTauri()) {
    return null
  }

  return invoke<string | null>('get_workspace_path')
}

// Set the workspace path (where Moldable repo lives)
export async function setWorkspacePath(path: string | null): Promise<void> {
  if (!isTauri()) {
    return
  }

  await invoke<void>('set_workspace_path', { path })
}

// Open folder picker to select workspace
export async function selectWorkspaceFolder(): Promise<string | null> {
  if (!isTauri()) {
    return null
  }

  const selected = await open({
    directory: true,
    multiple: false,
    title: 'Select Moldable Workspace',
  })

  if (!selected) {
    return null
  }

  const path = typeof selected === 'string' ? selected : selected[0]
  if (path) {
    await setWorkspacePath(path)
  }

  return path || null
}

export async function stopApp(appId: string): Promise<AppStatus> {
  if (!isTauri()) {
    return {
      running: false,
      pid: null,
      exit_code: null,
      recent_output: [],
      actual_port: null,
    }
  }

  return invoke<AppStatus>('stop_app', { appId })
}

export async function getAppStatus(appId: string): Promise<AppStatus> {
  if (!isTauri()) {
    return {
      running: false,
      pid: null,
      exit_code: null,
      recent_output: [],
      actual_port: null,
    }
  }

  return invoke<AppStatus>('get_app_status', { appId })
}

export async function getAppLogs(appId: string): Promise<string[]> {
  if (!isTauri()) {
    return []
  }

  return invoke<string[]>('get_app_logs', { appId })
}

export async function checkPort(port: number): Promise<boolean> {
  if (isTauri()) {
    return invoke<boolean>('check_port', { port })
  }

  // Browser fallback: try to fetch from the port
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 1000)

    await fetch(`http://localhost:${port}`, {
      method: 'HEAD',
      signal: controller.signal,
    })

    clearTimeout(timeout)
    return true
  } catch {
    return false
  }
}

// Check if a port is available for binding (not in use by anything)
export async function isPortAvailable(port: number): Promise<boolean> {
  if (!isTauri()) {
    // Browser fallback - can't really check
    return true
  }
  return invoke<boolean>('is_port_available', { port })
}

// Find an available port starting from the given port
export async function findFreePort(startPort: number): Promise<number> {
  if (!isTauri()) {
    return startPort
  }
  return invoke<number>('find_free_port', { startPort })
}

// Get information about what process is using a port
export async function getPortInfo(port: number): Promise<PortInfo | null> {
  if (!isTauri()) {
    return null
  }
  return invoke<PortInfo | null>('get_port_info', { port })
}

// Kill the process using a specific port
export async function killPort(port: number): Promise<boolean> {
  if (!isTauri()) {
    return false
  }
  return invoke<boolean>('kill_port', { port })
}

// Update the actual port for a running app
export async function setAppActualPort(
  appId: string,
  port: number,
): Promise<void> {
  if (!isTauri()) {
    return
  }
  await invoke('set_app_actual_port', { appId, port })
}

// Discover the actual port an app is running on (checks process state, port file, stdout)
export async function discoverAppPort(
  appId: string,
  workingDir: string,
): Promise<number | null> {
  if (!isTauri()) {
    return null
  }

  const candidate = await invoke<number | null>('discover_app_port', {
    appId,
    workingDir,
  })
  if (!candidate) return null

  // Verify we’re talking to the correct app (not some random process on that port)
  const ok = await verifyMoldableHealth(appId, candidate)
  return ok ? candidate : null
}

async function verifyMoldableHealth(
  expectedAppId: string,
  port: number,
): Promise<boolean> {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 500)

    const res = await fetch(`http://127.0.0.1:${port}/api/moldable/health`, {
      method: 'GET',
      signal: controller.signal,
      cache: 'no-store',
    })

    clearTimeout(timeout)

    if (!res.ok) return false
    const data = (await res.json()) as unknown
    if (!data || typeof data !== 'object') return false

    const appId = (data as { appId?: unknown }).appId
    return appId === expectedAppId
  } catch {
    return false
  }
}

// Cache the root directory
let cachedRoot: string | null = null

export async function getMoldableRoot(): Promise<string> {
  if (cachedRoot) return cachedRoot

  if (isTauri()) {
    cachedRoot = await invoke<string>('get_moldable_root')
    return cachedRoot
  }

  // Browser fallback
  cachedRoot = '/Users/rob/moldable'
  return cachedRoot
}

// Env requirements for an app
export interface EnvRequirement {
  key: string
  name: string
  description?: string
  url?: string
  required: boolean
}

export interface AppEnvStatus {
  requirements: EnvRequirement[]
  missing: string[]
  present: string[]
}

// Get env requirements for an app
export async function getAppEnvRequirements(
  appPath: string,
): Promise<AppEnvStatus> {
  if (!isTauri()) {
    return { requirements: [], missing: [], present: [] }
  }

  return invoke<AppEnvStatus>('get_app_env_requirements', { appPath })
}

// Set an env var for an app
export async function setAppEnvVar(key: string, value: string): Promise<void> {
  if (!isTauri()) {
    return
  }

  await invoke('set_app_env_var', { key, value })
}
