import { AlertCircle, Play, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  useTheme,
} from '@moldable-ai/ui'
import { cn } from '@/lib/utils'
import { type AppState, useAppStatus } from '@/hooks/use-app-status'
import type { AppConfig } from '../app'

interface WidgetCardProps {
  app: AppConfig
  workspaceId: string
  onClick: () => void
}

const WIDGET_SIZES = {
  small: 'col-span-1 row-span-1 min-h-[140px]',
  medium: 'col-span-1 row-span-1 min-h-[200px]',
  large: 'col-span-2 row-span-1 min-h-[200px]',
}

const STATUS_BG_COLORS: Record<AppState, string> = {
  running: 'bg-status-running',
  stopped: 'bg-status-stopped',
  starting: 'bg-status-pending',
  stopping: 'bg-status-pending',
  error: 'bg-status-error',
  port_conflict: 'bg-amber-500',
}

const STATUS_LABELS: Record<AppState, string> = {
  running: 'Running',
  stopped: 'Stopped',
  starting: 'Starting...',
  stopping: 'Stopping...',
  error: 'Error',
  port_conflict: 'Port in use',
}

export function WidgetCard({ app, workspaceId, onClick }: WidgetCardProps) {
  const [isLoading, setIsLoading] = useState(true)
  const { state, error, actualPort } = useAppStatus(app)
  const { resolvedTheme } = useTheme()
  // Use actual port if available, otherwise configured port
  const runningPort = actualPort ?? app.port
  const widgetUrl = `http://localhost:${runningPort}/widget?theme=${resolvedTheme}&workspace=${workspaceId}`
  const isRunning = state === 'running'
  const isStarting = state === 'starting'
  const isError = state === 'error'

  return (
    <div
      className={cn(
        'border-border bg-card hover:border-primary/50 hover:shadow-primary/5 group relative flex flex-col overflow-hidden rounded-2xl border transition-all hover:shadow-lg',
        WIDGET_SIZES[app.widgetSize],
      )}
    >
      {/* Header bar */}
      <button
        onClick={onClick}
        className="border-border bg-muted/50 hover:bg-muted/70 flex h-8 w-full shrink-0 cursor-pointer items-center justify-between border-b px-3 transition-colors"
      >
        <div className="flex items-center gap-2">
          {app.iconPath ? (
            <img
              src={app.iconPath}
              alt=""
              className="size-4 object-contain"
              onError={(e) => {
                e.currentTarget.style.display = 'none'
                e.currentTarget.nextElementSibling?.classList.remove('hidden')
              }}
            />
          ) : null}
          <span className={app.iconPath ? 'hidden text-sm' : 'text-sm'}>
            {app.icon}
          </span>
          <span className="text-muted-foreground text-xs font-medium">
            {app.name}
          </span>
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex items-center">
              <span
                className={cn('size-2 rounded-full', STATUS_BG_COLORS[state])}
              />
            </div>
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={4}>
            {STATUS_LABELS[state]}
          </TooltipContent>
        </Tooltip>
      </button>

      {/* Widget content - always navigate to app view */}
      <button
        onClick={onClick}
        className="bg-background relative flex-1 cursor-pointer overflow-hidden"
      >
        {/* Loading state */}
        {isLoading && isRunning && (
          <div className="bg-muted/50 absolute inset-0 flex items-center justify-center">
            <RefreshCw className="text-muted-foreground size-5 animate-spin" />
          </div>
        )}

        {/* Error state */}
        {isError && (
          <div className="bg-status-error/5 absolute inset-0 flex flex-col items-center justify-center p-4 text-center">
            <div className="bg-status-error/10 mb-2 flex size-10 items-center justify-center rounded-full">
              <AlertCircle className="text-status-error size-5" />
            </div>
            <div className="mb-1 text-sm font-medium">Failed to start</div>
            <div className="text-muted-foreground line-clamp-2 text-xs">
              {error || 'Click to see details'}
            </div>
          </div>
        )}

        {/* Stopped/Starting state */}
        {!isRunning && !isError && (
          <div className="bg-muted/30 absolute inset-0 flex flex-col items-center justify-center p-4 text-center">
            <div className="mb-2">
              {app.iconPath ? (
                <img
                  src={app.iconPath}
                  alt={app.name}
                  className="size-12 object-contain"
                  onError={(e) => {
                    e.currentTarget.style.display = 'none'
                    e.currentTarget.nextElementSibling?.classList.remove(
                      'hidden',
                    )
                  }}
                />
              ) : null}
              <div className={app.iconPath ? 'hidden text-3xl' : 'text-3xl'}>
                {app.icon}
              </div>
            </div>
            <div className="mb-1 text-sm font-medium">{app.name}</div>
            {isStarting ? (
              <div className="text-muted-foreground flex items-center gap-2 text-xs">
                <RefreshCw className="size-3 animate-spin" />
                Starting...
              </div>
            ) : (
              <div className="text-muted-foreground flex items-center gap-1 text-xs">
                <Play className="size-3" />
                Click to start
              </div>
            )}
          </div>
        )}

        {/* Iframe with widget view - only show when running */}
        {isRunning && (
          <iframe
            src={widgetUrl}
            className={cn(
              'absolute inset-0 size-full border-0 transition-opacity',
              isLoading ? 'opacity-0' : 'opacity-100',
            )}
            title={`${app.name} widget`}
            allow="microphone; camera; display-capture"
            onLoad={() => setIsLoading(false)}
            onError={() => setIsLoading(false)}
          />
        )}

        {/* Invisible click overlay */}
        <div className="absolute inset-0" />
      </button>
    </div>
  )
}
