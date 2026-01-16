import {
  AlertCircle,
  Check,
  Copy,
  MessageSquare,
  RefreshCw,
  Terminal,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTheme } from '@moldable-ai/ui'
import { getAppEnvRequirements } from '@/lib/app-manager'
import { useAppStatus } from '@/hooks/use-app-status'
import type { AppConfig } from '../app'
import { AppEnvDialog } from './app-env-dialog'
import { AppLogs } from './app-logs'
import { PortConflictDialog } from './port-conflict-dialog'
import { open } from '@tauri-apps/plugin-shell'

interface AppViewProps {
  app: AppConfig
  workspaceId: string
  reloadKey?: number
  onSuggestChatInput?: (text: string) => void
}

export function AppView({
  app,
  workspaceId,
  reloadKey = 0,
  onSuggestChatInput,
}: AppViewProps) {
  const [isLoading, setIsLoading] = useState(true)
  const [showEnvDialog, setShowEnvDialog] = useState(false)
  const [showLogs, setShowLogs] = useState(false)
  const [copiedError, setCopiedError] = useState(false)
  const {
    state,
    error,
    logs,
    actualPort,
    portConflict,
    start,
    killAndStart,
    startOnAlternatePort,
    dismissPortConflict,
  } = useAppStatus(app)
  const { resolvedTheme } = useTheme()
  // Use actual port if available, otherwise configured port
  const runningPort = actualPort ?? app.port
  const appUrl = `http://127.0.0.1:${runningPort}?theme=${resolvedTheme}&workspace=${workspaceId}`
  const isRunning = state === 'running'
  const isStarting = state === 'starting'
  const isStopped = state === 'stopped'
  const isError = state === 'error'
  const isPortConflict = state === 'port_conflict'

  // Check env requirements before starting
  const checkEnvAndStart = useCallback(async () => {
    try {
      const envStatus = await getAppEnvRequirements(app.workingDir)

      // Check if there are any pending requirements (not yet configured)
      const pendingRequirements = envStatus.requirements.filter(
        (req) => !envStatus.present.includes(req.key),
      )

      if (pendingRequirements.length > 0) {
        // Show env dialog
        setShowEnvDialog(true)
      } else {
        // All set, start the app
        start()
      }
    } catch (e) {
      // If we can't check env, just start the app
      console.error('Failed to check env requirements:', e)
      start()
    }
  }, [app.workingDir, start])

  // Auto-start the app when view is opened and app is stopped
  const hasAutoStarted = useRef(false)
  useEffect(() => {
    if (isStopped && !hasAutoStarted.current && !showEnvDialog) {
      hasAutoStarted.current = true
      checkEnvAndStart()
    }
  }, [isStopped, checkEnvAndStart, showEnvDialog])

  // Reset state when app changes
  useEffect(() => {
    hasAutoStarted.current = false
    setIsLoading(true)
  }, [app.id])

  // Listen for messages from app iframes (e.g., to open external URLs)
  useEffect(() => {
    const handleMessage = async (event: MessageEvent) => {
      // Only handle messages from our app's origin
      if (
        !event.origin.startsWith('http://127.0.0.1:') &&
        !event.origin.startsWith('http://localhost:')
      )
        return

      if (event.data?.type === 'moldable:open-url' && event.data?.url) {
        try {
          await open(event.data.url)
        } catch (err) {
          console.error('Failed to open URL:', err)
        }
      }
    }

    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [])

  const handleCopyError = useCallback(async () => {
    if (!error) return
    await navigator.clipboard.writeText(error)
    setCopiedError(true)
    setTimeout(() => setCopiedError(false), 2000)
  }, [error])

  const handleFixInChat = useCallback(() => {
    if (!error || !onSuggestChatInput) return
    const message = `For the current app, we get this error on launch:
<begin error>
${error}
</end error>
Fix it, verify, and then give a concise explanation in simple terms.`
    onSuggestChatInput(message)
  }, [error, onSuggestChatInput])

  const handleEnvDialogClose = useCallback(() => {
    setShowEnvDialog(false)
  }, [])

  const handleEnvDialogComplete = useCallback(() => {
    setShowEnvDialog(false)
    // Start the app after env setup
    start()
  }, [start])

  return (
    <div className="flex h-full flex-col">
      {/* Env setup dialog */}
      {showEnvDialog && (
        <AppEnvDialog
          appName={app.name}
          appPath={app.workingDir}
          onClose={handleEnvDialogClose}
          onComplete={handleEnvDialogComplete}
        />
      )}

      {/* Port conflict dialog */}
      {isPortConflict && (
        <PortConflictDialog
          appName={app.name}
          conflict={portConflict}
          onKillAndStart={killAndStart}
          onUseAlternatePort={startOnAlternatePort}
          onDismiss={dismissPortConflict}
        />
      )}

      {/* App iframe container */}
      <div className="bg-background relative flex-1">
        {/* Loading overlay */}
        {isLoading && isRunning && (
          <div className="bg-background absolute inset-0 z-10 flex items-center justify-center">
            <div className="flex flex-col items-center gap-3">
              <RefreshCw className="text-primary size-8 animate-spin" />
              <span className="text-muted-foreground text-sm">
                Loading {app.name}...
              </span>
            </div>
          </div>
        )}

        {/* Starting state */}
        {isStarting && (
          <div className="bg-card absolute inset-0 z-10 flex flex-col items-center justify-center">
            <div className="mb-4">
              {app.iconPath ? (
                <img
                  src={app.iconPath}
                  alt={app.name}
                  className="size-24 object-contain"
                />
              ) : (
                <div className="text-6xl">{app.icon}</div>
              )}
            </div>
            <h2 className="mb-2 text-xl font-semibold">{app.name}</h2>
            <div className="text-muted-foreground flex items-center gap-3">
              <RefreshCw className="size-5 animate-spin" />
              <span>Starting app on port {runningPort}...</span>
            </div>
          </div>
        )}

        {/* Error state */}
        {isError && (
          <div className="bg-card absolute inset-0 z-10 flex flex-col items-center justify-center p-8">
            <div className="bg-status-error/10 mb-3 flex size-12 items-center justify-center rounded-full">
              <AlertCircle className="text-status-error size-6" />
            </div>
            <h2 className="mb-1 text-lg font-semibold">{app.name}</h2>
            <p className="text-muted-foreground mb-3 text-center text-sm">
              Failed to start on port {runningPort}
            </p>

            {/* Error message - scrollable with copy button */}
            {error && (
              <div className="border-status-error/30 bg-status-error/5 mb-4 w-full max-w-2xl overflow-hidden rounded-lg border">
                <div className="border-status-error/20 flex items-center justify-end border-b px-2 py-1">
                  <button
                    onClick={handleCopyError}
                    className="text-status-error/70 hover:text-status-error flex cursor-pointer items-center gap-1 rounded px-2 py-1 text-xs transition"
                  >
                    {copiedError ? (
                      <>
                        <Check className="size-3" />
                        Copied
                      </>
                    ) : (
                      <>
                        <Copy className="size-3" />
                        Copy
                      </>
                    )}
                  </button>
                </div>
                <div className="max-h-48 overflow-auto p-3">
                  <pre className="text-status-error whitespace-pre-wrap font-mono text-xs">
                    {error}
                  </pre>
                </div>
              </div>
            )}

            {/* Action buttons */}
            <div className="flex gap-2">
              {onSuggestChatInput && (
                <button
                  onClick={handleFixInChat}
                  className="bg-primary text-primary-foreground hover:bg-primary/90 flex cursor-pointer items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition"
                >
                  <MessageSquare className="size-4" />
                  Fix in chat
                </button>
              )}
              <button
                onClick={() => start()}
                className="bg-muted text-muted-foreground hover:bg-muted/80 flex cursor-pointer items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition"
              >
                <RefreshCw className="size-4" />
                Try Again
              </button>
              {logs.length > 0 && (
                <button
                  onClick={() => setShowLogs(true)}
                  className="bg-muted text-muted-foreground hover:bg-muted/80 flex cursor-pointer items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition"
                >
                  <Terminal className="size-4" />
                  View Logs
                </button>
              )}
            </div>
          </div>
        )}

        {/* Logs modal */}
        <AppLogs
          appId={app.id}
          appName={app.name}
          isOpen={showLogs}
          onClose={() => setShowLogs(false)}
        />

        {/* Stopped state - will auto-start */}
        {isStopped && (
          <div className="bg-card absolute inset-0 z-10 flex flex-col items-center justify-center">
            <div className="mb-4">
              {app.iconPath ? (
                <img
                  src={app.iconPath}
                  alt={app.name}
                  className="size-24 object-contain"
                />
              ) : (
                <div className="text-6xl">{app.icon}</div>
              )}
            </div>
            <h2 className="mb-2 text-xl font-semibold">{app.name}</h2>
            <div className="text-muted-foreground flex items-center gap-3">
              <RefreshCw className="size-5 animate-spin" />
              <span>Starting app...</span>
            </div>
          </div>
        )}

        {/* Iframe - only render when running */}
        {isRunning && (
          <iframe
            key={`${app.id}-${reloadKey}`}
            src={appUrl}
            className="absolute inset-0 size-full border-0"
            title={app.name}
            allow="microphone; camera; display-capture"
            onLoad={() => setIsLoading(false)}
            onError={() => setIsLoading(false)}
          />
        )}
      </div>
    </div>
  )
}
