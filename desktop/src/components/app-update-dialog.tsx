import { Download, RefreshCw, X } from 'lucide-react'
import { Button } from '@moldable-ai/ui'
import { cn } from '../lib/utils'
import { useAppUpdate } from '../hooks/use-app-update'
import { AnimatePresence, motion } from 'framer-motion'

/**
 * A notification dialog that appears when a new version of the app is available.
 * Allows users to download and install updates from GitHub releases.
 */
export function AppUpdateDialog() {
  const {
    available,
    update,
    downloading,
    progress,
    error,
    downloadAndInstall,
    dismiss,
  } = useAppUpdate()

  if (!available || !update) return null

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 10, scale: 0.95 }}
        transition={{ duration: 0.2, ease: 'easeOut' }}
        className={cn(
          'fixed bottom-4 left-4 z-50',
          'border-border bg-card w-80 rounded-lg border shadow-xl',
          'overflow-hidden',
        )}
      >
        {/* Header */}
        <div className="flex items-start justify-between p-4 pb-2">
          <div className="flex items-center gap-2">
            <div className="bg-primary/10 flex size-8 items-center justify-center rounded-full">
              <img src="/logo.svg" alt="" className="size-4" />
            </div>
            <div>
              <h3 className="text-foreground text-sm font-semibold">
                Update Available
              </h3>
              <p className="text-muted-foreground text-xs">
                Version {update.version}
              </p>
            </div>
          </div>
          <button
            onClick={dismiss}
            disabled={downloading}
            className={cn(
              'text-muted-foreground rounded-md p-1',
              'hover:bg-muted hover:text-foreground',
              'disabled:pointer-events-none disabled:opacity-50',
              'cursor-pointer transition-colors',
            )}
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Release notes */}
        {update.body && (
          <div className="px-4 pb-2">
            <div className="bg-muted/50 max-h-24 overflow-y-auto rounded-md p-2">
              <p className="text-muted-foreground whitespace-pre-wrap text-xs">
                {update.body}
              </p>
            </div>
          </div>
        )}

        {/* Progress bar */}
        {downloading && (
          <div className="px-4 pb-2">
            <div className="bg-muted h-1.5 w-full overflow-hidden rounded-full">
              <motion.div
                className="bg-primary h-full"
                initial={{ width: 0 }}
                animate={{ width: `${progress}%` }}
                transition={{ duration: 0.2 }}
              />
            </div>
            <p className="text-muted-foreground mt-1 text-xs">
              Downloading... {progress}%
            </p>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="px-4 pb-2">
            <p className="text-destructive text-xs">{error}</p>
          </div>
        )}

        {/* Actions */}
        <div className="border-border bg-muted/30 flex gap-2 border-t p-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={dismiss}
            disabled={downloading}
            className="flex-1"
          >
            Later
          </Button>
          <Button
            size="sm"
            onClick={downloadAndInstall}
            disabled={downloading}
            className="flex-1 gap-1.5"
          >
            {downloading ? (
              <>
                <RefreshCw className="size-3.5 animate-spin" />
                Installing...
              </>
            ) : (
              <>
                <Download className="size-3.5" />
                Update Now
              </>
            )}
          </Button>
        </div>
      </motion.div>
    </AnimatePresence>
  )
}
