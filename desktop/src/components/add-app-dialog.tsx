import { Cloud, FolderOpen, Loader2, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@moldable-ai/ui'
import type { AppRegistryEntry } from '../lib/app-manager'
import {
  fetchAppRegistry,
  getRegisteredApps,
  installAppFromRegistry,
} from '../lib/app-manager'
import { cn } from '../lib/utils'

interface AddAppDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onAddFromFolder: () => void
  onAppInstalled: () => void
}

export function AddAppDialog({
  open,
  onOpenChange,
  onAddFromFolder,
  onAppInstalled,
}: AddAppDialogProps) {
  const [registryApps, setRegistryApps] = useState<AppRegistryEntry[]>([])
  const [installedIds, setInstalledIds] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [installing, setInstalling] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Load registry and installed apps when dialog opens
  const loadApps = useCallback(async (forceRefresh = false) => {
    setLoading(true)
    setError(null)
    try {
      const [registry, registered] = await Promise.all([
        fetchAppRegistry(forceRefresh),
        getRegisteredApps(),
      ])

      setRegistryApps(registry.apps)
      setInstalledIds(new Set(registered.map((a) => a.id)))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load apps')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (open) {
      loadApps()
    }
  }, [open, loadApps])

  const handleInstallApp = async (app: AppRegistryEntry) => {
    setInstalling(app.id)
    setError(null)
    try {
      await installAppFromRegistry(app.id, app.path, app.commit, app.version)
      onAppInstalled()
      // Update installed IDs
      setInstalledIds((prev) => new Set([...prev, app.id]))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to install app')
    } finally {
      setInstalling(null)
    }
  }

  const handleAddFromFolder = () => {
    onOpenChange(false)
    onAddFromFolder()
  }

  const handleRefresh = () => {
    loadApps(true)
  }

  // Filter out already installed apps
  const availableApps = registryApps.filter((app) => !installedIds.has(app.id))
  const installedApps = registryApps.filter((app) => installedIds.has(app.id))

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col overflow-hidden sm:max-w-[550px]">
        <DialogHeader className="space-y-1">
          <DialogTitle>Add App</DialogTitle>
          <DialogDescription>
            Install apps from the Moldable registry or add from a folder
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-4 py-4">
          {/* Registry apps section */}
          {loading ? (
            <div className="text-muted-foreground flex items-center justify-center py-8">
              <Loader2 className="mr-2 size-4 animate-spin" />
              Loading apps from registry...
            </div>
          ) : error ? (
            <div className="flex flex-col items-center gap-2 py-8 text-center">
              <p className="text-destructive text-sm">{error}</p>
              <Button variant="outline" size="sm" onClick={handleRefresh}>
                Try Again
              </Button>
            </div>
          ) : (
            <>
              {/* Available apps */}
              {availableApps.length > 0 && (
                <div className="flex min-h-0 flex-1 flex-col">
                  <div className="mb-2 flex shrink-0 items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Cloud className="text-muted-foreground size-3.5" />
                      <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
                        Available from Registry
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={handleRefresh}
                      disabled={loading}
                      className="size-6"
                      title="Refresh registry"
                    >
                      <RefreshCw
                        className={cn('size-3.5', loading && 'animate-spin')}
                      />
                    </Button>
                  </div>
                  <div className="-mr-2 min-h-0 flex-1 overflow-y-auto pr-2">
                    <div className="grid gap-2">
                      {availableApps.map((app) => (
                        <AppCard
                          key={app.id}
                          app={app}
                          installed={false}
                          installing={installing === app.id}
                          disabled={installing !== null}
                          onInstall={() => handleInstallApp(app)}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Already installed apps (collapsed by default) */}
              {installedApps.length > 0 && availableApps.length > 0 && (
                <div className="shrink-0">
                  <p className="text-muted-foreground mb-2 text-xs">
                    {installedApps.length} app
                    {installedApps.length === 1 ? '' : 's'} already installed
                  </p>
                </div>
              )}

              {/* No apps available message */}
              {availableApps.length === 0 && installedApps.length > 0 && (
                <div className="flex flex-col items-center gap-2 py-4 text-center">
                  <p className="text-muted-foreground text-sm">
                    All registry apps are already installed!
                  </p>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleRefresh}
                    disabled={loading}
                  >
                    <RefreshCw
                      className={cn(
                        'mr-1.5 size-3.5',
                        loading && 'animate-spin',
                      )}
                    />
                    Refresh
                  </Button>
                </div>
              )}

              {/* No apps at all */}
              {registryApps.length === 0 && (
                <div className="flex flex-col items-center gap-2 py-4 text-center">
                  <p className="text-muted-foreground text-sm">
                    No apps found in the registry.
                  </p>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleRefresh}
                    disabled={loading}
                  >
                    <RefreshCw
                      className={cn(
                        'mr-1.5 size-3.5',
                        loading && 'animate-spin',
                      )}
                    />
                    Refresh
                  </Button>
                </div>
              )}
            </>
          )}

          {/* Divider */}
          <div className="border-border shrink-0 border-t" />

          {/* Add from folder option */}
          <button
            onClick={handleAddFromFolder}
            disabled={installing !== null}
            className={cn(
              'hover:bg-muted/50 flex w-full shrink-0 cursor-pointer items-center gap-3 rounded-lg border border-dashed p-3 text-left transition-colors',
              'disabled:cursor-not-allowed disabled:opacity-50',
            )}
          >
            <div className="bg-muted flex size-10 shrink-0 items-center justify-center rounded-lg">
              <FolderOpen className="text-muted-foreground size-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-foreground font-medium">Add from folder</p>
              <p className="text-muted-foreground text-sm">
                Select a folder containing a Moldable app
              </p>
            </div>
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

interface AppCardProps {
  app: AppRegistryEntry
  installed: boolean
  installing: boolean
  disabled: boolean
  onInstall: () => void
}

function AppCard({
  app,
  installed,
  installing,
  disabled,
  onInstall,
}: AppCardProps) {
  return (
    <div
      className={cn(
        'flex w-full items-center gap-3 rounded-lg border p-3',
        !installed && 'hover:bg-muted/50 transition-colors',
      )}
    >
      {/* Icon */}
      <div className="bg-muted flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg">
        {app.iconUrl ? (
          <img
            src={app.iconUrl}
            alt={app.name}
            className="size-full object-cover p-1"
            onError={(e) => {
              // Fallback to emoji if image fails
              e.currentTarget.style.display = 'none'
              e.currentTarget.nextElementSibling?.classList.remove('hidden')
            }}
          />
        ) : null}
        <span className={cn('text-lg', app.iconUrl && 'hidden')}>
          {app.icon}
        </span>
      </div>

      {/* Info */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="text-foreground font-medium">{app.name}</p>
          <Badge variant="outline" className="text-[10px]">
            v{app.version}
          </Badge>
        </div>
        {app.description && (
          <p className="text-muted-foreground line-clamp-1 text-sm">
            {app.description}
          </p>
        )}
        {app.requiredEnv && app.requiredEnv.length > 0 && (
          <p className="text-muted-foreground/70 mt-0.5 text-xs">
            Requires: {app.requiredEnv.join(', ')}
          </p>
        )}
      </div>

      {/* Action */}
      {installed ? (
        <Badge variant="secondary" className="shrink-0">
          Installed
        </Badge>
      ) : (
        <Button
          size="sm"
          variant="outline"
          onClick={onInstall}
          disabled={disabled}
          className="shrink-0"
        >
          {installing ? (
            <>
              <Loader2 className="mr-1.5 size-3.5 animate-spin" />
              Installing...
            </>
          ) : (
            'Install'
          )}
        </Button>
      )}
    </div>
  )
}
