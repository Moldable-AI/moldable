import { ArrowDown, Terminal, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, cn } from '@moldable-ai/ui'
import { isTauri } from '../lib/app-manager'
import { invoke } from '@tauri-apps/api/core'

interface AppLogsProps {
  appId: string
  appName: string
  isOpen: boolean
  onClose: () => void
}

export function AppLogs({ appId, appName, isOpen, onClose }: AppLogsProps) {
  const [logs, setLogs] = useState<string[]>([])
  const logsEndRef = useRef<HTMLDivElement>(null)
  const logsContainerRef = useRef<HTMLDivElement>(null)
  const [isUserScrolledUp, setIsUserScrolledUp] = useState(false)

  const fetchLogs = useCallback(async () => {
    if (!isTauri()) return

    try {
      const lines = await invoke<string[]>('get_app_logs', { appId })
      setLogs(lines)
    } catch (err) {
      console.error('Failed to fetch logs:', err)
    }
  }, [appId])

  // Fetch logs initially and poll for updates
  useEffect(() => {
    if (!isOpen) return

    fetchLogs()
    const interval = setInterval(fetchLogs, 1000)
    return () => clearInterval(interval)
  }, [isOpen, fetchLogs])

  // Track if user has scrolled away from bottom
  const handleScroll = useCallback(() => {
    const container = logsContainerRef.current
    if (!container) return

    const { scrollTop, scrollHeight, clientHeight } = container
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight
    // Consider "at bottom" if within 50px
    setIsUserScrolledUp(distanceFromBottom > 50)
  }, [])

  // Auto-scroll to bottom only if user hasn't scrolled up
  useEffect(() => {
    if (!isUserScrolledUp) {
      logsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [logs, isUserScrolledUp])

  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        className="bg-card border-border flex h-[60vh] w-full max-w-4xl flex-col rounded-b-xl border-b shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="border-border flex items-center justify-between border-b px-4 py-3">
          <div className="flex items-center gap-2">
            <Terminal className="text-muted-foreground size-4" />
            <span className="font-medium">{appName} Logs</span>
            <span className="text-muted-foreground text-xs">
              ({logs.length} lines)
            </span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="cursor-pointer"
          >
            <X className="size-4" />
          </Button>
        </div>

        {/* Logs content */}
        <div className="relative flex-1 overflow-hidden">
          <div
            ref={logsContainerRef}
            onScroll={handleScroll}
            className="h-full overflow-auto bg-black/90 p-4 font-mono text-xs"
          >
            {logs.length === 0 ? (
              <div className="text-muted-foreground flex h-full items-center justify-center">
                No logs yet. Start the app to see output.
              </div>
            ) : (
              <div className="space-y-0.5">
                {logs.map((line, i) => (
                  <div
                    key={i}
                    className={cn(
                      'whitespace-pre-wrap break-all',
                      line.startsWith('[stderr]')
                        ? 'text-red-400'
                        : line.includes('error') || line.includes('Error')
                          ? 'text-red-400'
                          : line.includes('warn') || line.includes('Warn')
                            ? 'text-yellow-400'
                            : 'text-green-400',
                    )}
                  >
                    {line}
                  </div>
                ))}
                <div ref={logsEndRef} />
              </div>
            )}
          </div>
          {/* Scroll to bottom button */}
          {isUserScrolledUp && logs.length > 0 && (
            <Button
              variant="secondary"
              size="icon"
              onClick={() => {
                setIsUserScrolledUp(false)
                logsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
              }}
              className="absolute bottom-4 right-4 size-8 cursor-pointer shadow-lg"
            >
              <ArrowDown className="size-4" />
            </Button>
          )}
        </div>

        {/* Footer */}
        <div className="border-border flex items-center justify-between border-t px-4 py-2">
          <span className="text-muted-foreground text-xs">
            Auto-refreshing every second
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={fetchLogs}
            className="cursor-pointer"
          >
            Refresh
          </Button>
        </div>
      </div>
    </div>
  )
}
