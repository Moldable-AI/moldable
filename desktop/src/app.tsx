import { ArrowLeft, Play, RotateCcw, Terminal } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { AppConfig } from './lib/app-manager'
import {
  addAppFromFolder,
  autoStartApp,
  discoverAppPort,
  getRegisteredApps,
  removeApp,
  warmupApp,
} from './lib/app-manager'
import { cn } from './lib/utils'
import { useAIServerHealth } from './hooks/use-ai-server-health'
import { useAppStatus } from './hooks/use-app-status'
import { useHotReloadNotification } from './hooks/use-hot-reload-notification'
import { PREFERENCE_KEYS, useMoldableConfig } from './hooks/use-moldable-config'
import { useWorkspaces } from './hooks/use-workspaces'
import { ApiKeyDialog } from './components/api-key-dialog'
import { AppLogs } from './components/app-logs'
import { AppUpdateDialog } from './components/app-update-dialog'
import { AppView } from './components/app-view'
import { Canvas } from './components/canvas'
import { ChatContainer } from './components/chat-container'
import { GlobalCommandMenu } from './components/global-command-menu'
import { Onboarding } from './components/onboarding'
import { Sidebar } from './components/sidebar'
import { UpdateNotification } from './components/update-notification'
import { WorkspaceSelector } from './components/workspace-selector'
import { listen } from '@tauri-apps/api/event'
import { homeDir } from '@tauri-apps/api/path'
import { Toaster } from 'sonner'

// Hook to load app configs from registry and auto-start them
function useAppConfigs(workspaceId: string | undefined) {
  const [apps, setApps] = useState<AppConfig[]>([])

  const loadApps = useCallback(async () => {
    const appConfigs = await getRegisteredApps()
    setApps(appConfigs)

    // Auto-start all apps on launch and collect ports for warmup
    console.log('🚀 Auto-starting registered apps...')
    const portsToWarmup: { app: AppConfig; port: number }[] = []

    for (const app of appConfigs) {
      // Check if already running (discovers actual port, not just configured)
      const runningPort = await discoverAppPort(app.id, app.workingDir)
      if (runningPort) {
        console.log(`✅ ${app.name} already running on port ${runningPort}`)
        portsToWarmup.push({ app, port: runningPort })
      } else {
        console.log(`▶️  Starting ${app.name}...`)
        try {
          const result = await autoStartApp(app)
          if (result.status === 'port_conflict') {
            console.warn(
              `⚠️  ${app.name} requires port ${result.port} but it's in use. Will prompt on open.`,
            )
          } else {
            console.log(
              `✅ ${app.name} ${result.status} on port ${result.port}`,
            )
            portsToWarmup.push({ app, port: result.port })
          }
          console.log(`✅ ${app.name} started`)
        } catch (err) {
          console.error(`❌ Failed to start ${app.name}:`, err)
        }
      }
    }

    // Warm up all apps in parallel (preload widget and main pages)
    // This triggers Next.js to compile pages so they load instantly
    if (portsToWarmup.length > 0) {
      console.log('🔥 Warming up app pages...')
      Promise.allSettled(
        portsToWarmup.map(async ({ app, port }) => {
          try {
            await warmupApp(port)
            console.log(`🔥 ${app.name} warmed up`)
          } catch (err) {
            console.warn(`⚠️ Failed to warm up ${app.name}:`, err)
          }
        }),
      )
    }
  }, [])

  // Reload apps without auto-starting (for config file changes)
  const reloadApps = useCallback(async () => {
    console.log('🔄 Reloading app configs...')
    const appConfigs = await getRegisteredApps()
    setApps(appConfigs)

    // Auto-start any new apps that aren't running
    const portsToWarmup: { app: AppConfig; port: number }[] = []

    for (const app of appConfigs) {
      const runningPort = await discoverAppPort(app.id, app.workingDir)
      if (!runningPort) {
        console.log(`▶️  Starting new app ${app.name}...`)
        try {
          const result = await autoStartApp(app)
          if (result.status !== 'port_conflict') {
            portsToWarmup.push({ app, port: result.port })
          }
          console.log(`✅ ${app.name} started`)
        } catch (err) {
          console.error(`❌ Failed to start ${app.name}:`, err)
        }
      }
    }

    // Warm up newly started apps
    if (portsToWarmup.length > 0) {
      console.log('🔥 Warming up new app pages...')
      Promise.allSettled(
        portsToWarmup.map(async ({ app, port }) => {
          try {
            await warmupApp(port)
            console.log(`🔥 ${app.name} warmed up`)
          } catch (err) {
            console.warn(`⚠️ Failed to warm up ${app.name}:`, err)
          }
        }),
      )
    }
  }, [])

  useEffect(() => {
    loadApps()
  }, [loadApps])

  // Reload apps when workspace changes
  useEffect(() => {
    if (workspaceId) {
      console.log('📂 Workspace changed, reloading apps...')
      loadApps()
    }
  }, [workspaceId, loadApps])

  // Listen for config file changes from Tauri
  useEffect(() => {
    const unlisten = listen('config-changed', () => {
      console.log('📝 Config changed, reloading apps...')
      reloadApps()
    })

    return () => {
      unlisten.then((fn) => fn())
    }
  }, [reloadApps])

  const addApp = useCallback(async () => {
    try {
      const newApp = await addAppFromFolder()
      if (newApp) {
        setApps((prev) => [...prev, newApp])
        // Auto-start the new app
        console.log(`▶️  Starting ${newApp.name}...`)
        const result = await autoStartApp(newApp)
        if (result.status === 'port_conflict') {
          console.warn(
            `⚠️  ${newApp.name} requires port ${result.port} but it's in use. Will prompt on open.`,
          )
        } else {
          // Warm up the new app in the background
          warmupApp(result.port)
            .then(() => console.log(`🔥 ${newApp.name} warmed up`))
            .catch((err) =>
              console.warn(`⚠️ Failed to warm up ${newApp.name}:`, err),
            )
        }
      }
    } catch (err) {
      console.error('Failed to add app:', err)
      alert(err instanceof Error ? err.message : 'Failed to add app')
    }
  }, [])

  const deleteApp = useCallback(async (appId: string) => {
    await removeApp(appId)
    setApps((prev) => prev.filter((a) => a.id !== appId))
  }, [])

  return { apps, addApp, deleteApp, reloadApps: loadApps }
}

export function App() {
  // Workspace management - must be first since apps depend on active workspace
  const {
    workspaces,
    activeWorkspace,
    isLoading: isLoadingWorkspaces,
    setActiveWorkspace,
    createWorkspace,
    updateWorkspace,
    deleteWorkspace,
  } = useWorkspaces()

  // Track if user has completed onboarding this session (required for WebKit iframe painting)
  const [hasCompletedOnboarding, setHasCompletedOnboarding] = useState(false)

  // Persisted preference - remember if onboarding was completed for this workspace
  const [workspaceOnboardingCompleted, setWorkspaceOnboardingCompleted] =
    useMoldableConfig(PREFERENCE_KEYS.ONBOARDING_COMPLETED, false)

  const { apps, addApp, deleteApp, reloadApps } = useAppConfigs(
    activeWorkspace?.id,
  )
  const [activeApp, setActiveApp] = useState<AppConfig | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [isChatExpanded, setIsChatExpanded] = useState(false)
  const [isChatMinimized, setIsChatMinimized] = useState(false)
  const [suggestedChatInput, setSuggestedChatInput] = useState<
    string | undefined
  >()
  const [isLogsOpen, setIsLogsOpen] = useState(false)
  const [userHomeDir, setUserHomeDir] = useState<string | null>(null)
  const [showApiKeySetup, setShowApiKeySetup] = useState(false)

  // Load user's home directory for constructing data paths
  useEffect(() => {
    homeDir().then(setUserHomeDir).catch(console.error)
  }, [])

  // Track workspace changes to handle app refresh/navigation
  const prevWorkspaceRef = useRef(activeWorkspace?.id)
  const workspaceJustChanged = useRef(false)

  // When workspace changes, mark it and refresh the iframe
  useEffect(() => {
    if (prevWorkspaceRef.current !== activeWorkspace?.id) {
      prevWorkspaceRef.current = activeWorkspace?.id
      workspaceJustChanged.current = true
      if (activeApp) {
        // Bump reload key to force iframe refresh with new workspace
        setReloadKey((k) => k + 1)
      }
    }
  }, [activeWorkspace?.id, activeApp])

  // After apps reload following workspace change, check if current app exists
  useEffect(() => {
    if (workspaceJustChanged.current && activeApp) {
      workspaceJustChanged.current = false
      // Check if the current app exists in the new workspace
      const appExistsInWorkspace = apps.some(
        (app) =>
          app.id === activeApp.id && app.workingDir === activeApp.workingDir,
      )
      if (!appExistsInWorkspace) {
        // App doesn't exist in new workspace - go back to canvas
        setActiveApp(null)
      }
    }
  }, [apps, activeApp])

  const { state, start, restart, actualPort } = useAppStatus(activeApp)
  const { health, checkHealth } = useAIServerHealth()
  const {
    updateAvailable,
    reload: reloadApp,
    dismiss: dismissUpdate,
  } = useHotReloadNotification()
  const isRunning = state === 'running'
  const isStopped = state === 'stopped'
  const isError = state === 'error'
  const isTransitioning = state === 'starting' || state === 'stopping'

  // Auto-open logs when app errors
  useEffect(() => {
    if (isError && activeApp) {
      setIsLogsOpen(true)
    }
  }, [isError, activeApp])

  const handleReload = useCallback(async () => {
    await restart()
    // Bump reload key to force iframe remount after restart
    setReloadKey((k) => k + 1)
  }, [restart])

  const handleChatToggle = useCallback(() => {
    // If minimized, bring it back first
    if (isChatMinimized) {
      setIsChatMinimized(false)
    }
    setIsChatExpanded((prev) => !prev)
  }, [isChatMinimized])

  // Cmd+M to toggle chat (M for Moldable) - handled via Tauri menu to override macOS minimize
  useEffect(() => {
    const unlisten = listen('toggle-chat', () => {
      if (isChatMinimized) {
        // Minimized -> bring it back and expand
        setIsChatMinimized(false)
        setIsChatExpanded(true)
      } else {
        // Visible -> toggle expanded state
        setIsChatExpanded((prev) => !prev)
      }
    })
    return () => {
      unlisten.then((fn) => fn())
    }
  }, [isChatMinimized])

  // Listen for apps requesting to populate chat input
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      // Only handle messages from app iframes
      if (
        !event.origin.startsWith('http://127.0.0.1:') &&
        !event.origin.startsWith('http://localhost:')
      )
        return

      if (event.data?.type === 'moldable:set-chat-input' && event.data?.text) {
        setSuggestedChatInput(event.data.text)
        // Also open the chat if it's minimized or collapsed
        setIsChatMinimized(false)
        setIsChatExpanded(true)
      }
    }

    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [])

  const handleOnboardingComplete = useCallback(
    (workspaceId: string, markOnboardingDone: boolean = true) => {
      setActiveWorkspace(workspaceId)
      setHasCompletedOnboarding(true)
      // Mark workspace onboarding as complete (persisted for future launches)
      if (markOnboardingDone) {
        // Small delay to ensure workspace is active before saving preference
        setTimeout(() => setWorkspaceOnboardingCompleted(true), 100)
      }
    },
    [setActiveWorkspace, setWorkspaceOnboardingCompleted],
  )

  // Show onboarding until complete (provides user gesture for WebKit iframe painting)
  if (
    !isLoadingWorkspaces &&
    !hasCompletedOnboarding &&
    workspaces.length > 0
  ) {
    return (
      <Onboarding
        workspaces={workspaces}
        health={health}
        onComplete={handleOnboardingComplete}
        onCreateWorkspace={createWorkspace}
        onHealthRetry={checkHealth}
        workspaceOnboardingCompleted={workspaceOnboardingCompleted}
      />
    )
  }

  return (
    <div
      className="bg-background flex h-screen w-screen flex-col overflow-hidden rounded-lg"
      style={{ '--sidebar-width': '72px' } as React.CSSProperties}
    >
      {/* Top bar - full width drag region */}
      <header
        data-tauri-drag-region
        className="border-border bg-card flex h-11 shrink-0 items-center border-b px-3"
      >
        {/* Traffic light spacer */}
        <div className="pointer-events-none w-[70px] shrink-0" />

        {/* Back button when viewing an app */}
        {activeApp && (
          <button
            onClick={() => setActiveApp(null)}
            className="text-muted-foreground hover:bg-muted hover:text-foreground -ml-1 mr-2 flex size-7 cursor-pointer items-center justify-center rounded-md transition-colors"
          >
            <ArrowLeft className="size-4" />
          </button>
        )}

        {/* Title - app name or Moldable logo */}
        <div className="pointer-events-none flex items-center gap-2">
          {activeApp ? (
            <>
              {activeApp.iconPath ? (
                <img
                  src={activeApp.iconPath}
                  alt=""
                  className="size-4 object-contain"
                />
              ) : (
                <span className="text-base">{activeApp.icon}</span>
              )}
              <span className="text-sm font-medium">{activeApp.name}</span>
            </>
          ) : (
            <img
              src="/logo-text.svg"
              alt="Moldable"
              className="h-4 dark:invert"
              style={{ transform: 'translateY(-1px)' }}
            />
          )}
        </div>

        {/* Vertical separator */}
        <div className="bg-border mx-2 h-4 w-px" />

        {/* Workspace selector */}
        <WorkspaceSelector
          workspaces={workspaces}
          activeWorkspace={activeWorkspace}
          onWorkspaceChange={setActiveWorkspace}
          onCreateWorkspace={createWorkspace}
          onUpdateWorkspace={updateWorkspace}
          onDeleteWorkspace={deleteWorkspace}
        />

        <div className="pointer-events-none flex-1" />

        {/* App controls */}
        {activeApp && (
          <div className="flex items-center gap-1">
            {/* Status indicator */}
            <div className="bg-muted text-muted-foreground flex h-6 items-center gap-1.5 rounded-md px-2 text-xs">
              <span
                className={cn(
                  'size-1.5 rounded-full',
                  isRunning
                    ? 'bg-status-running'
                    : isError
                      ? 'bg-status-error'
                      : isTransitioning
                        ? 'bg-status-pending'
                        : 'bg-status-stopped',
                )}
              />
              {/* Only show port when running or if we have the actual port */}
              {actualPort ? (
                <span>:{actualPort}</span>
              ) : isRunning || isTransitioning ? (
                <span className="animate-pulse">:...</span>
              ) : (
                <span className="text-muted-foreground/50">:–</span>
              )}
            </div>

            {/* Logs button */}
            <button
              onClick={() => setIsLogsOpen(true)}
              className={cn(
                'flex size-7 cursor-pointer items-center justify-center rounded-md transition-colors',
                isError
                  ? 'text-red-500 hover:bg-red-500/10'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
              title="View logs"
            >
              <Terminal className="size-3.5" />
            </button>

            {/* Start button (when stopped/error) or Reload/Restart */}
            {isStopped || isError ? (
              <button
                onClick={() => start()}
                disabled={isTransitioning}
                className="text-muted-foreground hover:bg-primary/10 hover:text-primary flex size-7 cursor-pointer items-center justify-center rounded-md transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                title={isError ? 'Retry' : 'Start app'}
              >
                <Play className="size-3.5" />
              </button>
            ) : (
              <button
                onClick={handleReload}
                disabled={isTransitioning}
                className="text-muted-foreground hover:bg-muted hover:text-foreground flex size-7 cursor-pointer items-center justify-center rounded-md transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                title="Restart app"
              >
                <RotateCcw
                  className={cn('size-3.5', isTransitioning && 'animate-spin')}
                />
              </button>
            )}
          </div>
        )}
      </header>

      {/* Below header: sidebar + content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <Sidebar
          apps={apps}
          activeApp={activeApp}
          onSelectApp={setActiveApp}
          onAddApp={addApp}
          onRefreshApps={reloadApps}
          onDeleteApp={deleteApp}
          onChatToggle={handleChatToggle}
          isChatActive={isChatExpanded}
        />

        {/* Main content area */}
        <main className="flex-1 overflow-hidden">
          {activeApp ? (
            <AppView
              app={activeApp}
              workspaceId={activeWorkspace?.id ?? 'personal'}
              reloadKey={reloadKey}
              onSuggestChatInput={(text) => {
                setSuggestedChatInput(text)
                setIsChatMinimized(false)
                setIsChatExpanded(true)
              }}
            />
          ) : (
            <Canvas
              apps={apps}
              workspaceId={activeWorkspace?.id ?? 'personal'}
              onOpenApp={setActiveApp}
              onAddApp={addApp}
              onRefreshApps={reloadApps}
            />
          )}
        </main>
      </div>

      {/* Floating chat panel */}
      <ChatContainer
        isExpanded={isChatExpanded}
        onExpandedChange={setIsChatExpanded}
        isMinimized={isChatMinimized}
        onMinimizedChange={setIsChatMinimized}
        workspaceId={activeWorkspace?.id}
        registeredApps={apps.map((app) => ({
          id: app.id,
          name: app.name,
          icon: app.iconPath || app.icon,
        }))}
        activeApp={
          activeApp && userHomeDir && activeWorkspace
            ? {
                id: activeApp.id,
                name: activeApp.name,
                icon: activeApp.iconPath || activeApp.icon,
                workingDir: activeApp.workingDir,
                dataDir: `${userHomeDir}/.moldable/workspaces/${activeWorkspace.id}/apps/${activeApp.id}/data`,
              }
            : null
        }
        availableKeys={{
          hasOpenRouterKey: health.hasOpenRouterKey,
          hasAnthropicKey: health.hasAnthropicKey,
          hasOpenAIKey: health.hasOpenAIKey,
        }}
        missingApiKey={health.status === 'no-keys'}
        onAddApiKey={() => setShowApiKeySetup(true)}
        suggestedInput={suggestedChatInput}
        onSuggestedInputConsumed={() => setSuggestedChatInput(undefined)}
      />

      {/* Hot reload notification (development) */}
      <UpdateNotification
        visible={updateAvailable}
        onReload={reloadApp}
        onDismiss={dismissUpdate}
      />

      {/* App update notification (production auto-updates) */}
      <AppUpdateDialog />

      {/* API key setup dialog */}
      <ApiKeyDialog
        open={showApiKeySetup}
        onOpenChange={setShowApiKeySetup}
        onSuccess={checkHealth}
      />

      {/* App logs viewer */}
      {activeApp && (
        <AppLogs
          appId={activeApp.id}
          appName={activeApp.name}
          isOpen={isLogsOpen}
          onClose={() => setIsLogsOpen(false)}
        />
      )}

      {/* Global Command Menu */}
      <GlobalCommandMenu
        apps={apps}
        activeApp={activeApp}
        activeAppPort={actualPort}
        onSelectApp={setActiveApp}
        onToggleChat={handleChatToggle}
        workspaces={workspaces}
        activeWorkspace={activeWorkspace}
        onWorkspaceChange={setActiveWorkspace}
      />

      {/* Toast notifications */}
      <Toaster position="bottom-right" />
    </div>
  )
}

export type { AppConfig }
