import {
  ArrowDown,
  Check,
  Copy,
  FileText,
  FolderOpen,
  Terminal,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, cn } from '@moldable-ai/ui'
import { isTauri } from '../lib/app-manager'
import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-shell'

interface SystemLogsProps {
  isOpen: boolean
  onClose: () => void
}

export function SystemLogs({ isOpen, onClose }: SystemLogsProps) {
  const [logs, setLogs] = useState<string[]>([])
  const [logPath, setLogPath] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const logsEndRef = useRef<HTMLDivElement>(null)
  const logsContainerRef = useRef<HTMLDivElement>(null)
  const [isUserScrolledUp, setIsUserScrolledUp] = useState(false)

  const fetchLogs = useCallback(async () => {
    if (!isTauri()) return

    try {
      const [lines, path] = await Promise.all([
        invoke<string[]>('get_system_logs', { maxLines: 2000 }),
        invoke<string>('get_system_log_path'),
      ])
      setLogs(lines)
      setLogPath(path)
    } catch (err) {
      console.error('Failed to fetch system logs:', err)
      setLogs([`Error loading logs: ${err}`])
    }
  }, [])

  // Fetch logs initially and poll for updates
  useEffect(() => {
    if (!isOpen) return

    fetchLogs()
    const interval = setInterval(fetchLogs, 2000)
    return () => clearInterval(interval)
  }, [isOpen, fetchLogs])

  // Track if user has scrolled away from bottom
  const handleScroll = useCallback(() => {
    const container = logsContainerRef.current
    if (!container) return

    const { scrollTop, scrollHeight, clientHeight } = container
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight
    setIsUserScrolledUp(distanceFromBottom > 50)
  }, [])

  // Auto-scroll to bottom only if user hasn't scrolled up
  useEffect(() => {
    if (!isUserScrolledUp) {
      logsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [logs, isUserScrolledUp])

  const handleCopyLogs = useCallback(async () => {
    const text = logs.join('\n')
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [logs])

  const handleRevealInFinder = useCallback(async () => {
    if (!logPath) return
    try {
      // Get the directory containing the log file
      const logDir = logPath.substring(0, logPath.lastIndexOf('/'))
      await open(logDir)
    } catch (err) {
      console.error('Failed to reveal log file:', err)
    }
  }, [logPath])

  if (!isOpen) return null

  // Parse log level from line for coloring
  const getLogLevel = (line: string): 'error' | 'warn' | 'info' | 'debug' => {
    if (line.includes(' ERROR ') || line.includes('[ERROR]')) return 'error'
    if (line.includes(' WARN ') || line.includes('[WARN]')) return 'warn'
    if (line.includes(' DEBUG ') || line.includes('[DEBUG]')) return 'debug'
    return 'info'
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-card border-border flex h-[80vh] w-full max-w-5xl flex-col rounded-xl border shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="border-border flex items-center justify-between border-b px-4 py-3">
          <div className="flex items-center gap-2">
            <Terminal className="text-muted-foreground size-4" />
            <span className="font-medium">System Logs</span>
            <span className="text-muted-foreground text-xs">
              ({logs.length} lines)
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleRevealInFinder}
              className="cursor-pointer gap-1.5"
              disabled={!logPath}
            >
              <FolderOpen className="size-3.5" />
              Show in Finder
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleCopyLogs}
              className="cursor-pointer gap-1.5"
            >
              {copied ? (
                <>
                  <Check className="size-3.5" />
                  Copied!
                </>
              ) : (
                <>
                  <Copy className="size-3.5" />
                  Copy All
                </>
              )}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={onClose}
              className="cursor-pointer"
            >
              <X className="size-4" />
            </Button>
          </div>
        </div>

        {/* Info banner */}
        <div className="border-border bg-muted/50 flex items-center gap-2 border-b px-4 py-2 text-xs">
          <FileText className="text-muted-foreground size-3.5" />
          <span className="text-muted-foreground">
            These logs can help diagnose issues. Copy and share them when
            reporting bugs.
          </span>
          {logPath && (
            <span className="text-muted-foreground/70 ml-auto font-mono text-[10px]">
              {logPath}
            </span>
          )}
        </div>

        {/* Logs content */}
        <div className="relative flex-1 overflow-hidden">
          <div
            ref={logsContainerRef}
            onScroll={handleScroll}
            className="h-full overflow-auto bg-black/95 p-4 font-mono text-xs"
          >
            {logs.length === 0 ? (
              <div className="text-muted-foreground flex h-full items-center justify-center">
                No logs yet. Logs will appear here as you use the app.
              </div>
            ) : (
              <div className="space-y-0.5">
                {logs.map((line, i) => {
                  const level = getLogLevel(line)
                  return (
                    <div
                      key={i}
                      className={cn(
                        'whitespace-pre-wrap break-all',
                        level === 'error' && 'text-red-400',
                        level === 'warn' && 'text-yellow-400',
                        level === 'debug' && 'text-gray-500',
                        level === 'info' && 'text-green-400',
                      )}
                    >
                      {line}
                    </div>
                  )
                })}
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
            Auto-refreshing every 2 seconds
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
