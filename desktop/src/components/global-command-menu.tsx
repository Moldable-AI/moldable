'use client'

import {
  Check,
  Filter,
  LayoutGrid,
  type LucideIcon,
  MessageSquare,
  Plus,
  Trash2,
} from 'lucide-react'
import * as React from 'react'
import {
  type AppCommand,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@moldable-ai/ui'
import type { AppConfig } from '../lib/app-manager'
import type { Workspace } from '../lib/workspaces'

// Map of icon names to Lucide components
const iconMap: Record<string, LucideIcon> = {
  plus: Plus,
  'trash-2': Trash2,
  filter: Filter,
}

interface GlobalCommandMenuProps {
  apps: AppConfig[]
  activeApp: AppConfig | null
  activeAppPort: number | null
  onSelectApp: (app: AppConfig | null) => void
  onToggleChat: () => void
  workspaces: Workspace[]
  activeWorkspace: Workspace | null
  onWorkspaceChange: (workspaceId: string) => void
}

export function GlobalCommandMenu({
  apps,
  activeApp,
  activeAppPort,
  onSelectApp,
  onToggleChat,
  workspaces,
  activeWorkspace,
  onWorkspaceChange,
}: GlobalCommandMenuProps) {
  const [open, setOpen] = React.useState(false)
  const [appCommands, setAppCommands] = React.useState<AppCommand[]>([])
  const [isLoadingCommands, setIsLoadingCommands] = React.useState(false)

  // Fetch commands when menu opens and there's an active app
  React.useEffect(() => {
    if (!open || !activeApp || !activeAppPort) {
      setAppCommands([])
      return
    }

    setIsLoadingCommands(true)
    console.log(
      '[GlobalCommandMenu] Fetching commands for',
      activeApp.name,
      'on port',
      activeAppPort,
    )
    fetch(`http://127.0.0.1:${activeAppPort}/api/moldable/commands`)
      .then((r) => r.json())
      .then((data) => {
        console.log('[GlobalCommandMenu] Got commands:', data.commands)
        setAppCommands(data.commands || [])
      })
      .catch((err) => {
        console.warn('Failed to fetch app commands:', err)
        setAppCommands([])
      })
      .finally(() => setIsLoadingCommands(false))
  }, [open, activeApp, activeAppPort])

  // Execute a command on the active app
  const executeCommand = React.useCallback(
    (cmd: AppCommand) => {
      if (!activeAppPort) return

      const iframe = document.querySelector(
        'iframe[title]',
      ) as HTMLIFrameElement | null

      if (cmd.action.type === 'navigate') {
        // Navigate the iframe to a new path
        if (iframe) {
          const url = new URL(iframe.src)
          url.pathname = cmd.action.path
          iframe.src = url.toString()
        }
      } else if (cmd.action.type === 'message') {
        // Post a message to the iframe
        iframe?.contentWindow?.postMessage(
          {
            type: 'moldable:command',
            command: cmd.id,
            payload: cmd.action.payload,
          },
          '*',
        )
      } else if (cmd.action.type === 'focus') {
        // Post a focus message to the iframe
        iframe?.contentWindow?.postMessage(
          {
            type: 'moldable:command',
            command: cmd.id,
            payload: { focus: cmd.action.target },
          },
          '*',
        )
      }

      setOpen(false)
    },
    [activeAppPort],
  )

  React.useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setOpen((open) => !open)
      }
    }

    document.addEventListener('keydown', down)
    return () => document.removeEventListener('keydown', down)
  }, [])

  // Group app commands by their group property
  const groupedCommands = React.useMemo(() => {
    const groups: Record<string, AppCommand[]> = {}
    console.log('[GlobalCommandMenu] Grouping commands:', appCommands.length)
    for (const cmd of appCommands) {
      const group = cmd.group || 'Commands'
      if (!groups[group]) groups[group] = []
      groups[group].push(cmd)
    }
    return groups
  }, [appCommands])

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Type a command or search apps..." />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>

        {/* Toggle chat - at top for quick access */}
        <CommandGroup heading="Quick Actions">
          <CommandItem
            onSelect={() => {
              onToggleChat()
              setOpen(false)
            }}
          >
            <MessageSquare className="mr-2 size-4" />
            <span>Toggle chat</span>
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        {/* App-specific commands when an app is active */}
        {activeApp && appCommands.length > 0
          ? Object.entries(groupedCommands).map(([group, commands]) => (
              <React.Fragment key={`${activeApp.id}-${group}`}>
                <CommandGroup heading={`${activeApp.name} · ${group}`}>
                  {commands.map((cmd) => {
                    const IconComponent = cmd.icon ? iconMap[cmd.icon] : null
                    return (
                      <CommandItem
                        key={cmd.id}
                        onSelect={() => executeCommand(cmd)}
                      >
                        {IconComponent ? (
                          <IconComponent className="mr-2 size-4" />
                        ) : (
                          <span className="mr-2 size-4" />
                        )}
                        <span>{cmd.label}</span>
                        {cmd.shortcut && (
                          <span className="text-muted-foreground ml-auto text-xs">
                            {cmd.shortcut.toUpperCase()}
                          </span>
                        )}
                      </CommandItem>
                    )
                  })}
                </CommandGroup>
                <CommandSeparator />
              </React.Fragment>
            ))
          : activeApp &&
            !isLoadingCommands && (
              <>
                <CommandGroup heading={activeApp.name}>
                  <CommandItem disabled>
                    <span className="text-muted-foreground text-xs italic">
                      No app commands available
                    </span>
                  </CommandItem>
                </CommandGroup>
                <CommandSeparator />
              </>
            )}

        {/* Loading state for commands */}
        {activeApp && isLoadingCommands && appCommands.length === 0 && (
          <>
            <CommandGroup heading={activeApp.name}>
              <CommandItem disabled>
                <span className="text-muted-foreground">
                  Loading commands...
                </span>
              </CommandItem>
            </CommandGroup>
            <CommandSeparator />
          </>
        )}

        {/* Apps navigation */}
        <CommandGroup heading="Apps">
          <CommandItem
            onSelect={() => {
              onSelectApp(null)
              setOpen(false)
            }}
          >
            <LayoutGrid className="mr-2 size-4" />
            <span>All apps</span>
            <span className="text-muted-foreground ml-auto text-xs">Home</span>
          </CommandItem>
          {apps.map((app) => (
            <CommandItem
              key={app.id}
              onSelect={() => {
                onSelectApp(app)
                setOpen(false)
              }}
            >
              {app.iconPath ? (
                <img
                  src={app.iconPath}
                  alt=""
                  className="mr-2 size-4 object-contain"
                />
              ) : (
                <span className="mr-2 text-base">{app.icon}</span>
              )}
              <span>{app.name}</span>
              {activeApp?.id === app.id && (
                <span className="text-muted-foreground ml-auto text-xs">
                  Active
                </span>
              )}
            </CommandItem>
          ))}
        </CommandGroup>

        <CommandSeparator />

        {/* Workspace switching */}
        <CommandGroup heading="Workspaces">
          {workspaces.map((workspace) => (
            <CommandItem
              key={workspace.id}
              onSelect={() => {
                onWorkspaceChange(workspace.id)
                setOpen(false)
              }}
            >
              <span
                className="mr-2 size-3 rounded-full"
                style={{ backgroundColor: workspace.color }}
              />
              <span>{workspace.name}</span>
              {workspace.id === activeWorkspace?.id && (
                <Check className="text-primary ml-auto size-4" />
              )}
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  )
}
