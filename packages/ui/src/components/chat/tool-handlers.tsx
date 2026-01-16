'use client'

import {
  BookOpen,
  Check,
  CheckCheck,
  Copy,
  Download,
  FileCode,
  FileText,
  FolderOpen,
  Globe,
  Plus,
  Search,
  Sparkles,
  Terminal,
  Trash2,
  X,
} from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { cn } from '../../lib/utils'
import { ThinkingTimelineMarker } from './thinking-timeline'

/**
 * Tool handler definition
 */
export type ToolHandler = {
  // Label to show while the tool is loading
  loadingLabel: string
  // Marker to use in the timeline (for grouped tools)
  marker?: ThinkingTimelineMarker
  // Whether this tool should be shown inline (not grouped)
  inline?: boolean
  // Render function for the tool output
  renderOutput: (output: unknown, toolCallId: string) => ReactNode
  // Render function for loading state (optional, for inline tools)
  // args contains the streaming tool arguments (may be partial during streaming)
  renderLoading?: (args?: unknown) => ReactNode
}

/**
 * Code block component for displaying command output or file contents
 */
function CodeBlock({
  children,
  maxHeight = 200,
  className,
}: {
  children: ReactNode
  maxHeight?: number
  className?: string
}) {
  return (
    <pre
      className={cn(
        'bg-terminal text-terminal-foreground min-w-0 overflow-auto whitespace-pre-wrap break-all rounded-lg p-3 font-mono text-xs',
        className,
      )}
      style={{ maxHeight }}
    >
      {children}
    </pre>
  )
}

/**
 * Copy button component
 */
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <button
      onClick={handleCopy}
      className="text-terminal-muted hover:bg-terminal-border hover:text-terminal-foreground cursor-pointer rounded p-1 transition-colors"
      title="Copy command"
    >
      {copied ? (
        <CheckCheck className="text-success size-3.5" />
      ) : (
        <Copy className="size-3.5" />
      )}
    </button>
  )
}

/**
 * Summarize a command for the header (truncate long commands)
 */
function summarizeCommand(command: string): string {
  // Get first line only
  const firstLine = command.split('\n')[0]
  // Truncate if too long
  if (firstLine.length > 60) {
    return firstLine.slice(0, 25) + '...'
  }
  return firstLine
}

/**
 * Terminal output component
 */
function TerminalOutput({
  command,
  stdout,
  stderr,
  exitCode,
  error,
  sandboxed,
}: {
  command: string
  stdout?: string
  stderr?: string
  exitCode?: number
  error?: string
  sandboxed?: boolean
}) {
  const success = !error && (exitCode === 0 || exitCode === undefined)
  const hasOutput = stdout || stderr || error

  return (
    <div className="border-terminal-border bg-terminal min-w-0 max-w-full overflow-hidden rounded-lg border">
      {/* Terminal header - summarized command */}
      <div className="border-terminal-border bg-terminal-header flex min-w-0 items-center gap-2 border-b px-3 py-1.5">
        <Terminal className="text-terminal-muted size-3.5 shrink-0" />
        <code className="text-terminal-foreground min-w-0 flex-1 truncate font-mono text-xs">
          {summarizeCommand(command)}
        </code>
        {sandboxed === false && (
          <span className="shrink-0 rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-medium text-amber-600">
            unsandboxed
          </span>
        )}
        <CopyButton text={command} />
        {success ? (
          <Check className="text-success size-3.5 shrink-0" />
        ) : (
          <X className="text-terminal-error size-3.5 shrink-0" />
        )}
      </div>
      {/* Terminal body - full command + output */}
      <div className="max-h-[300px] overflow-auto p-3">
        {/* Full command */}
        <div className="text-terminal-foreground mb-2 break-all font-mono text-xs">
          <span className="text-terminal-muted">$</span> {command}
        </div>
        {/* Output */}
        {hasOutput && (
          <div className="border-terminal-border/50 border-t pt-2">
            {stdout && (
              <pre className="text-terminal-stdout whitespace-pre-wrap break-all font-mono text-xs">
                {stdout}
              </pre>
            )}
            {stderr && (
              <pre className="text-terminal-stderr whitespace-pre-wrap break-all font-mono text-xs">
                {stderr}
              </pre>
            )}
            {error && (
              <pre className="text-terminal-error whitespace-pre-wrap break-all font-mono text-xs">
                {error}
              </pre>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * File operation indicator (inline, minimal)
 */
function FileOperation({
  operation,
  path,
  success = true,
  children,
}: {
  operation: 'read' | 'write' | 'list' | 'check' | 'delete' | 'edit'
  path: string
  success?: boolean
  children?: ReactNode
}) {
  const icons = {
    read: FileText,
    write: FileText,
    list: FolderOpen,
    check: FileText,
    delete: Trash2,
    edit: FileCode,
  }
  const labels = {
    read: 'Read',
    write: 'Wrote',
    list: 'Listed',
    check: 'Checked',
    delete: 'Deleted',
    edit: 'Edited',
  }
  const Icon = icons[operation]
  const fileName = getFileName(path)

  return (
    <div className="my-1 min-w-0">
      <div
        className={cn(
          'inline-flex max-w-full items-center gap-2 rounded-md px-2 py-1 text-xs',
          success
            ? 'bg-muted text-muted-foreground'
            : 'bg-destructive/10 text-destructive',
        )}
      >
        <Icon className="size-3.5 shrink-0" />
        <span className="shrink-0 font-medium">{labels[operation]}</span>
        <code
          className="bg-background/50 min-w-0 truncate rounded px-1 font-mono"
          title={path}
        >
          {fileName}
        </code>
        {success ? (
          <Check className="size-3 shrink-0 text-green-600" />
        ) : (
          <X className="size-3 shrink-0" />
        )}
      </div>
      {children}
    </div>
  )
}

/**
 * Extract just the filename from a path
 */
function getFileName(path: string): string {
  const parts = path.split('/')
  return parts[parts.length - 1] || path
}

/**
 * Default tool handlers for Moldable tools
 */
export const DEFAULT_TOOL_HANDLERS: Record<string, ToolHandler> = {
  readFile: {
    loadingLabel: 'Reading file...',
    marker: ThinkingTimelineMarker.File,
    inline: true,
    renderLoading: () => (
      <div className="bg-muted text-muted-foreground inline-flex max-w-full items-center gap-2 rounded-md px-2 py-1 text-xs">
        <FileText className="size-3.5 shrink-0 animate-pulse" />
        <span className="truncate">Reading file...</span>
      </div>
    ),
    renderOutput: (output, toolCallId) => {
      const result = (output ?? {}) as {
        success?: boolean
        content?: string
        path?: string
        error?: string
      }

      if (!result.success) {
        return (
          <FileOperation
            key={toolCallId}
            operation="read"
            path={result.path || 'file'}
            success={false}
          />
        )
      }

      // Show simple indicator for successful reads
      return (
        <FileOperation
          key={toolCallId}
          operation="read"
          path={result.path || 'file'}
          success={true}
        />
      )
    },
  },

  writeFile: {
    loadingLabel: 'Writing file...',
    marker: ThinkingTimelineMarker.File,
    inline: true,
    renderLoading: (args?: unknown) => {
      const { path, content } = (args ?? {}) as {
        path?: string
        content?: string
      }

      // Show streaming preview of file content
      if (content) {
        const lines = content.split('\n')
        const previewLines = lines.slice(0, 20)
        const preview = previewLines.join('\n').slice(0, 1000)
        const lineCount = lines.length

        return (
          <div className="my-1 min-w-0">
            <div className="bg-muted text-muted-foreground inline-flex max-w-full items-center gap-2 rounded-md px-2 py-1 text-xs">
              <FileText className="size-3.5 shrink-0 animate-pulse" />
              <span className="shrink-0 font-medium">Writing</span>
              <code className="bg-background/50 min-w-0 truncate rounded px-1 font-mono">
                {path ? getFileName(path) : 'file'}
              </code>
              <span className="text-muted-foreground/70 shrink-0">
                ({lineCount} line{lineCount !== 1 ? 's' : ''})
              </span>
            </div>
            <div className="mt-2">
              <CodeBlock maxHeight={200}>{preview}</CodeBlock>
            </div>
          </div>
        )
      }

      // Fallback when content hasn't started streaming yet
      return (
        <div className="bg-muted text-muted-foreground inline-flex max-w-full items-center gap-2 rounded-md px-2 py-1 text-xs">
          <FileText className="size-3.5 shrink-0 animate-pulse" />
          <span className="truncate">
            Writing {path ? getFileName(path) : 'file'}...
          </span>
        </div>
      )
    },
    renderOutput: (output, toolCallId) => {
      const result = (output ?? {}) as {
        success?: boolean
        path?: string
        error?: string
        preview?: string
        lineCount?: number
        truncated?: boolean
      }

      if (!result.success) {
        return (
          <FileOperation
            key={toolCallId}
            operation="write"
            path={result.path || 'file'}
            success={false}
          />
        )
      }

      // Show simple indicator for successful writes
      return (
        <FileOperation
          key={toolCallId}
          operation="write"
          path={result.path || 'file'}
          success={true}
        />
      )
    },
  },

  listDirectory: {
    loadingLabel: 'Listing directory...',
    marker: ThinkingTimelineMarker.Folder,
    inline: true,
    renderLoading: () => (
      <div className="bg-muted text-muted-foreground inline-flex max-w-full items-center gap-2 rounded-md px-2 py-1 text-xs">
        <FolderOpen className="size-3.5 shrink-0 animate-pulse" />
        <span className="truncate">Listing directory...</span>
      </div>
    ),
    renderOutput: (output, toolCallId) => {
      const result = (output ?? {}) as {
        success?: boolean
        path?: string
        entries?: string[]
        items?: Array<{ name: string; type: string }>
        error?: string
      }

      if (result.success === false) {
        return (
          <FileOperation
            key={toolCallId}
            operation="list"
            path={result.path || 'directory'}
            success={false}
          />
        )
      }

      // Format entries for display
      const entries = result.items
        ? result.items.map(
            (i) => `${i.type === 'directory' ? '📁' : '📄'} ${i.name}`,
          )
        : result.entries || []

      return (
        <div
          key={toolCallId}
          className={cn(
            'my-1 inline-flex max-w-full items-center gap-2 rounded-md px-2 py-1 text-xs',
            'bg-muted text-muted-foreground',
          )}
        >
          <FolderOpen className="size-3.5 shrink-0" />
          <span className="shrink-0 font-medium">Listed</span>
          <code
            className="bg-background/50 min-w-0 truncate rounded px-1 font-mono"
            title={result.path}
          >
            {getFileName(result.path || 'directory')}
          </code>
          <span className="text-muted-foreground/70 shrink-0">
            ({entries.length} items)
          </span>
          <Check className="size-3 shrink-0 text-green-600" />
        </div>
      )
    },
  },

  fileExists: {
    loadingLabel: 'Checking file...',
    marker: ThinkingTimelineMarker.File,
    inline: true,
    renderLoading: () => (
      <div className="bg-muted text-muted-foreground inline-flex max-w-full items-center gap-2 rounded-md px-2 py-1 text-xs">
        <FileText className="size-3.5 shrink-0 animate-pulse" />
        <span className="truncate">Checking file...</span>
      </div>
    ),
    renderOutput: (output, toolCallId) => {
      const result = (output ?? {}) as {
        exists?: boolean
        path?: string
      }

      return (
        <div
          key={toolCallId}
          className="bg-muted text-muted-foreground my-1 inline-flex max-w-full items-center gap-2 rounded-md px-2 py-1 text-xs"
        >
          <FileText className="size-3.5 shrink-0" />
          <code className="bg-background/50 min-w-0 truncate rounded px-1 font-mono">
            {result.path || 'file'}
          </code>
          <span className="shrink-0">
            {result.exists ? 'exists' : 'not found'}
          </span>
          {result.exists ? (
            <Check className="size-3 shrink-0 text-green-600" />
          ) : (
            <X className="size-3 shrink-0 text-amber-500" />
          )}
        </div>
      )
    },
  },

  executeBashCommand: {
    loadingLabel: 'Running command...',
    marker: ThinkingTimelineMarker.Terminal,
    inline: true,
    renderLoading: (args?: unknown) => {
      const { command } = (args ?? {}) as { command?: string }

      // Show streaming command as it's being written
      if (command && command.trim()) {
        return (
          <div className="border-terminal-border bg-terminal my-2 min-w-0 max-w-full overflow-hidden rounded-lg border">
            <div className="bg-terminal-header flex min-w-0 items-center gap-2 px-3 py-1.5">
              <Terminal className="text-terminal-muted size-3.5 shrink-0 animate-pulse" />
              <code className="text-terminal-foreground min-w-0 flex-1 truncate font-mono text-xs">
                {summarizeCommand(command)}
              </code>
            </div>
            <div className="max-h-[150px] overflow-auto p-3">
              <div className="text-terminal-foreground break-all font-mono text-xs">
                <span className="text-terminal-muted">$</span> {command}
              </div>
            </div>
          </div>
        )
      }

      // Fallback when command hasn't started streaming
      return (
        <div className="border-terminal-border bg-terminal my-2 min-w-0 max-w-full overflow-hidden rounded-lg border">
          <div className="bg-terminal-header flex min-w-0 items-center gap-2 px-3 py-1.5">
            <Terminal className="text-terminal-muted size-3.5 shrink-0 animate-pulse" />
            <code className="text-terminal-foreground/60 min-w-0 flex-1 truncate font-mono text-xs italic">
              Generating command...
            </code>
          </div>
        </div>
      )
    },
    renderOutput: (output, toolCallId) => {
      const result = (output ?? {}) as {
        success?: boolean
        stdout?: string
        stderr?: string
        exitCode?: number
        command?: string
        error?: string
      }

      return (
        <div key={toolCallId} className="my-2 min-w-0 max-w-full">
          <TerminalOutput
            command={result.command || 'command'}
            stdout={result.stdout}
            stderr={result.stderr}
            exitCode={result.exitCode}
            error={result.error}
          />
        </div>
      )
    },
  },

  runCommand: {
    loadingLabel: 'Running command...',
    marker: ThinkingTimelineMarker.Terminal,
    inline: true,
    renderLoading: (args?: unknown) => {
      const { command, sandbox } = (args ?? {}) as {
        command?: string
        sandbox?: boolean
      }

      // Show streaming command as it's being written
      if (command && command.trim()) {
        return (
          <div className="border-terminal-border bg-terminal my-2 min-w-0 max-w-full overflow-hidden rounded-lg border">
            <div className="bg-terminal-header flex min-w-0 items-center gap-2 px-3 py-1.5">
              <Terminal className="text-terminal-muted size-3.5 shrink-0 animate-pulse" />
              <code className="text-terminal-foreground min-w-0 flex-1 truncate font-mono text-xs">
                {summarizeCommand(command)}
              </code>
              {sandbox === false && (
                <span className="shrink-0 rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-medium text-amber-600">
                  unsandboxed
                </span>
              )}
            </div>
            <div className="max-h-[150px] overflow-auto p-3">
              <div className="text-terminal-foreground break-all font-mono text-xs">
                <span className="text-terminal-muted">$</span> {command}
              </div>
            </div>
          </div>
        )
      }

      // Fallback when command hasn't started streaming
      return (
        <div className="border-terminal-border bg-terminal my-2 min-w-0 max-w-full overflow-hidden rounded-lg border">
          <div className="bg-terminal-header flex min-w-0 items-center gap-2 px-3 py-1.5">
            <Terminal className="text-terminal-muted size-3.5 shrink-0 animate-pulse" />
            <code className="text-terminal-foreground/60 min-w-0 flex-1 truncate font-mono text-xs italic">
              Preparing command...
            </code>
          </div>
        </div>
      )
    },
    renderOutput: (output, toolCallId) => {
      const result = (output ?? {}) as {
        success?: boolean
        stdout?: string
        stderr?: string
        exitCode?: number
        command?: string
        error?: string
        sandboxed?: boolean
      }

      return (
        <div key={toolCallId} className="my-2 min-w-0 max-w-full">
          <TerminalOutput
            command={result.command || 'command'}
            stdout={result.stdout}
            stderr={result.stderr}
            exitCode={result.exitCode}
            error={result.error}
            sandboxed={result.sandboxed}
          />
        </div>
      )
    },
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // Additional File Operations
  // ─────────────────────────────────────────────────────────────────────────────

  deleteFile: {
    loadingLabel: 'Deleting file...',
    marker: ThinkingTimelineMarker.File,
    inline: true,
    renderLoading: (args?: unknown) => {
      const { path } = (args ?? {}) as { path?: string }
      return (
        <div className="bg-muted text-muted-foreground inline-flex max-w-full items-center gap-2 rounded-md px-2 py-1 text-xs">
          <Trash2 className="size-3.5 shrink-0 animate-pulse" />
          <span className="truncate">
            Deleting {path ? getFileName(path) : 'file'}...
          </span>
        </div>
      )
    },
    renderOutput: (output, toolCallId) => {
      const result = (output ?? {}) as {
        success?: boolean
        path?: string
        error?: string
      }

      return (
        <FileOperation
          key={toolCallId}
          operation="delete"
          path={result.path || 'file'}
          success={result.success !== false}
        />
      )
    },
  },

  editFile: {
    loadingLabel: 'Editing file...',
    marker: ThinkingTimelineMarker.File,
    inline: true,
    renderLoading: (args?: unknown) => {
      const { path } = (args ?? {}) as { path?: string }
      return (
        <div className="bg-muted text-muted-foreground inline-flex max-w-full items-center gap-2 rounded-md px-2 py-1 text-xs">
          <FileCode className="size-3.5 shrink-0 animate-pulse" />
          <span className="truncate">
            Editing {path ? getFileName(path) : 'file'}...
          </span>
        </div>
      )
    },
    renderOutput: (output, toolCallId) => {
      const result = (output ?? {}) as {
        success?: boolean
        path?: string
        error?: string
      }

      return (
        <FileOperation
          key={toolCallId}
          operation="edit"
          path={result.path || 'file'}
          success={result.success !== false}
        />
      )
    },
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // Search Operations
  // ─────────────────────────────────────────────────────────────────────────────

  grep: {
    loadingLabel: 'Searching...',
    marker: ThinkingTimelineMarker.Search,
    inline: true,
    renderLoading: (args?: unknown) => {
      const { pattern } = (args ?? {}) as { pattern?: string }
      return (
        <div className="bg-muted text-muted-foreground inline-flex max-w-full items-center gap-2 rounded-md px-2 py-1 text-xs">
          <Search className="size-3.5 shrink-0 animate-pulse" />
          <span className="truncate">
            Searching
            {pattern
              ? ` for "${pattern.slice(0, 20)}${pattern.length > 20 ? '...' : ''}"`
              : ''}
            ...
          </span>
        </div>
      )
    },
    renderOutput: (output, toolCallId) => {
      const result = (output ?? {}) as {
        success?: boolean
        matches?: Array<{
          file: string
          line: number
          content: string
        }>
        totalMatches?: number
        truncated?: boolean
        error?: string
        // Alternative format from ripgrep
        content?: string
      }

      // Handle raw content output (ripgrep format)
      if (result.content && !result.matches) {
        const lines = result.content.split('\n').filter(Boolean)
        return (
          <div
            key={toolCallId}
            className="bg-muted text-muted-foreground my-1 inline-flex max-w-full items-center gap-2 rounded-md px-2 py-1 text-xs"
          >
            <Search className="size-3.5 shrink-0" />
            <span className="shrink-0 font-medium">Search results</span>
            <span className="text-muted-foreground/70 shrink-0">
              ({lines.length} lines)
            </span>
            <Check className="size-3 shrink-0 text-green-600" />
          </div>
        )
      }

      if (result.success === false || !result.matches?.length) {
        return (
          <div
            key={toolCallId}
            className="bg-muted text-muted-foreground my-1 inline-flex max-w-full items-center gap-2 rounded-md px-2 py-1 text-xs"
          >
            <Search className="size-3.5 shrink-0" />
            <span className="truncate">No matches found</span>
          </div>
        )
      }

      // Group matches by file
      const byFile = result.matches.reduce(
        (acc, match) => {
          if (!acc[match.file]) acc[match.file] = []
          acc[match.file].push(match)
          return acc
        },
        {} as Record<string, typeof result.matches>,
      )

      const fileCount = Object.keys(byFile).length
      const matchCount = result.totalMatches || result.matches.length

      return (
        <div
          key={toolCallId}
          className="bg-muted text-muted-foreground my-1 inline-flex max-w-full items-center gap-2 rounded-md px-2 py-1 text-xs"
        >
          <Search className="size-3.5 shrink-0" />
          <span className="shrink-0 font-medium">Found</span>
          <span className="shrink-0">
            {matchCount} match{matchCount !== 1 ? 'es' : ''} in {fileCount} file
            {fileCount !== 1 ? 's' : ''}
          </span>
          {result.truncated && (
            <span className="shrink-0 text-amber-500">(truncated)</span>
          )}
          <Check className="size-3 shrink-0 text-green-600" />
        </div>
      )
    },
  },

  globFileSearch: {
    loadingLabel: 'Finding files...',
    marker: ThinkingTimelineMarker.Search,
    inline: true,
    renderLoading: (args?: unknown) => {
      const { pattern } = (args ?? {}) as { pattern?: string }
      return (
        <div className="bg-muted text-muted-foreground inline-flex max-w-full items-center gap-2 rounded-md px-2 py-1 text-xs">
          <Search className="size-3.5 shrink-0 animate-pulse" />
          <span className="truncate">
            Finding files{pattern ? ` matching "${pattern}"` : ''}...
          </span>
        </div>
      )
    },
    renderOutput: (output, toolCallId) => {
      const result = (output ?? {}) as {
        success?: boolean
        files?: string[]
        error?: string
      }

      if (result.success === false || !result.files?.length) {
        return (
          <div
            key={toolCallId}
            className="bg-muted text-muted-foreground my-1 inline-flex max-w-full items-center gap-2 rounded-md px-2 py-1 text-xs"
          >
            <Search className="size-3.5 shrink-0" />
            <span className="truncate">No files found</span>
          </div>
        )
      }

      return (
        <div
          key={toolCallId}
          className="bg-muted text-muted-foreground my-1 inline-flex max-w-full items-center gap-2 rounded-md px-2 py-1 text-xs"
        >
          <Search className="size-3.5 shrink-0" />
          <span className="shrink-0 font-medium">Found</span>
          <span className="shrink-0">
            {result.files.length} file{result.files.length !== 1 ? 's' : ''}
          </span>
          <Check className="size-3 shrink-0 text-green-600" />
        </div>
      )
    },
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // Web Search
  // ─────────────────────────────────────────────────────────────────────────────

  webSearch: {
    loadingLabel: 'Searching the web...',
    marker: ThinkingTimelineMarker.Search,
    inline: true,
    renderLoading: (args?: unknown) => {
      const { query } = (args ?? {}) as { query?: string }
      return (
        <div className="bg-muted text-muted-foreground inline-flex max-w-full items-center gap-2 rounded-md px-2 py-1 text-xs">
          <Globe className="size-3.5 shrink-0 animate-pulse" />
          <span className="truncate">
            Searching
            {query
              ? ` "${query.slice(0, 30)}${query.length > 30 ? '...' : ''}"`
              : ' the web'}
            ...
          </span>
        </div>
      )
    },
    renderOutput: (output, toolCallId) => {
      const result = (output ?? {}) as {
        success?: boolean
        results?: Array<{
          title: string
          link: string
          snippet: string
        }>
        error?: string
      }

      if (result.success === false || !result.results?.length) {
        return (
          <div
            key={toolCallId}
            className="bg-muted text-muted-foreground my-1 inline-flex max-w-full items-center gap-2 rounded-md px-2 py-1 text-xs"
          >
            <Globe className="size-3.5 shrink-0" />
            <span className="truncate">No results found</span>
          </div>
        )
      }

      return (
        <div
          key={toolCallId}
          className="bg-muted text-muted-foreground my-1 inline-flex max-w-full items-center gap-2 rounded-md px-2 py-1 text-xs"
        >
          <Globe className="size-3.5 shrink-0" />
          <span className="shrink-0 font-medium">Web search</span>
          <span className="shrink-0">
            {result.results.length} result
            {result.results.length !== 1 ? 's' : ''}
          </span>
          <Check className="size-3 shrink-0 text-green-600" />
        </div>
      )
    },
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // Agent Skills Management
  // ─────────────────────────────────────────────────────────────────────────────

  listSkillRepos: {
    loadingLabel: 'Listing skill repositories...',
    marker: ThinkingTimelineMarker.Default,
    inline: true,
    renderLoading: () => (
      <div className="bg-muted text-muted-foreground inline-flex max-w-full items-center gap-2 rounded-md px-2 py-1 text-xs">
        <BookOpen className="size-3.5 shrink-0 animate-pulse" />
        <span className="truncate">Loading skill repositories...</span>
      </div>
    ),
    renderOutput: (output, toolCallId) => {
      const result = (output ?? {}) as {
        success?: boolean
        repositories?: Array<{
          name: string
          url: string
          enabled: boolean
          mode: string
          skills: string[]
          lastSync?: string
        }>
        error?: string
      }

      if (result.success === false || !result.repositories?.length) {
        return (
          <div
            key={toolCallId}
            className="bg-muted text-muted-foreground my-1 inline-flex max-w-full items-center gap-2 rounded-md px-2 py-1 text-xs"
          >
            <BookOpen className="size-3.5 shrink-0" />
            <span className="truncate">
              {result.error || 'No skill repositories configured'}
            </span>
          </div>
        )
      }

      return (
        <div
          key={toolCallId}
          className="bg-muted text-muted-foreground my-1 inline-flex max-w-full items-center gap-2 rounded-md px-2 py-1 text-xs"
        >
          <BookOpen className="size-3.5 shrink-0" />
          <span className="shrink-0 font-medium">Skill Repositories</span>
          <span className="shrink-0">
            ({result.repositories.length} repo
            {result.repositories.length !== 1 ? 's' : ''})
          </span>
          <Check className="size-3 shrink-0 text-green-600" />
        </div>
      )
    },
  },

  listAvailableSkills: {
    loadingLabel: 'Fetching available skills...',
    marker: ThinkingTimelineMarker.Default,
    inline: true,
    renderLoading: (args?: unknown) => {
      const { repoName } = (args ?? {}) as { repoName?: string }
      return (
        <div className="bg-muted text-muted-foreground inline-flex max-w-full items-center gap-2 rounded-md px-2 py-1 text-xs">
          <Sparkles className="size-3.5 shrink-0 animate-pulse" />
          <span className="truncate">
            Fetching skills{repoName ? ` from ${repoName}` : ''}...
          </span>
        </div>
      )
    },
    renderOutput: (output, toolCallId) => {
      const result = (output ?? {}) as {
        success?: boolean
        repoName?: string
        available?: string[]
        selected?: string[]
        mode?: string
        error?: string
      }

      if (result.success === false) {
        return (
          <div
            key={toolCallId}
            className="bg-destructive/10 text-destructive my-1 inline-flex max-w-full items-center gap-2 rounded-md px-2 py-1 text-xs"
          >
            <Sparkles className="size-3.5 shrink-0" />
            <span className="truncate">
              {result.error || 'Failed to fetch skills'}
            </span>
          </div>
        )
      }

      const available = result.available || []
      const selected = result.selected || []

      return (
        <div
          key={toolCallId}
          className="bg-muted text-muted-foreground my-1 inline-flex max-w-full items-center gap-2 rounded-md px-2 py-1 text-xs"
        >
          <Sparkles className="size-3.5 shrink-0" />
          <span className="shrink-0 font-medium">
            {result.repoName || 'Available Skills'}
          </span>
          <span className="shrink-0">
            ({selected.length}/{available.length} selected)
          </span>
          <Check className="size-3 shrink-0 text-green-600" />
        </div>
      )
    },
  },

  syncSkills: {
    loadingLabel: 'Syncing skills...',
    marker: ThinkingTimelineMarker.Default,
    inline: true,
    renderLoading: (args?: unknown) => {
      const { repoName } = (args ?? {}) as { repoName?: string }
      return (
        <div className="bg-muted text-muted-foreground inline-flex max-w-full items-center gap-2 rounded-md px-2 py-1 text-xs">
          <Download className="size-3.5 shrink-0 animate-pulse" />
          <span className="truncate">
            Syncing skills{repoName ? ` from ${repoName}` : ''}...
          </span>
        </div>
      )
    },
    renderOutput: (output, toolCallId) => {
      const result = (output ?? {}) as {
        success?: boolean
        synced?: number
        failed?: number
        skills?: string[]
        error?: string
      }

      if (result.success === false) {
        return (
          <div
            key={toolCallId}
            className="bg-destructive/10 text-destructive my-1 inline-flex max-w-full items-center gap-2 rounded-md px-2 py-1 text-xs"
          >
            <Download className="size-3.5 shrink-0" />
            <span className="truncate">{result.error || 'Sync failed'}</span>
          </div>
        )
      }

      const synced = result.synced || 0
      const failed = result.failed || 0

      return (
        <div
          key={toolCallId}
          className="bg-muted text-muted-foreground my-1 min-w-0"
        >
          <div className="inline-flex max-w-full items-center gap-2 rounded-md px-2 py-1 text-xs">
            <Download className="size-3.5 shrink-0" />
            <span className="font-medium">Skills synced</span>
            <span className="text-green-600">{synced} synced</span>
            {failed > 0 && (
              <span className="text-amber-500">{failed} failed</span>
            )}
            <Check className="size-3 shrink-0 text-green-600" />
          </div>
          {result.skills && result.skills.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1 px-2 pb-1">
              {result.skills.map((skill) => (
                <span
                  key={skill}
                  className="bg-primary/10 text-primary inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium"
                >
                  <Check className="size-2.5" />
                  {skill}
                </span>
              ))}
            </div>
          )}
        </div>
      )
    },
  },

  addSkillRepo: {
    loadingLabel: 'Adding skill repository...',
    marker: ThinkingTimelineMarker.Default,
    inline: true,
    renderLoading: (args?: unknown) => {
      const { url } = (args ?? {}) as { url?: string }
      return (
        <div className="bg-muted text-muted-foreground inline-flex max-w-full items-center gap-2 rounded-md px-2 py-1 text-xs">
          <Plus className="size-3.5 shrink-0 animate-pulse" />
          <span className="truncate">
            Adding repository{url ? `: ${url}` : ''}...
          </span>
        </div>
      )
    },
    renderOutput: (output, toolCallId) => {
      const result = (output ?? {}) as {
        success?: boolean
        name?: string
        url?: string
        availableSkills?: string[]
        error?: string
      }

      if (result.success === false) {
        return (
          <div
            key={toolCallId}
            className="bg-destructive/10 text-destructive my-1 inline-flex max-w-full items-center gap-2 rounded-md px-2 py-1 text-xs"
          >
            <Plus className="size-3.5 shrink-0" />
            <span className="truncate">
              {result.error || 'Failed to add repository'}
            </span>
          </div>
        )
      }

      return (
        <div
          key={toolCallId}
          className="bg-muted text-muted-foreground my-1 min-w-0"
        >
          <div className="inline-flex max-w-full items-center gap-2 rounded-md px-2 py-1 text-xs">
            <Plus className="size-3.5 shrink-0" />
            <span className="font-medium">Repository added</span>
            <code className="bg-background/50 truncate rounded px-1 font-mono text-[10px]">
              {result.url}
            </code>
            <Check className="size-3 shrink-0 text-green-600" />
          </div>
          {result.availableSkills && result.availableSkills.length > 0 && (
            <div className="text-muted-foreground px-2 pb-1 text-[10px]">
              {result.availableSkills.length} skill
              {result.availableSkills.length !== 1 ? 's' : ''} available:{' '}
              {result.availableSkills.slice(0, 8).join(', ')}
              {result.availableSkills.length > 8 &&
                ` +${result.availableSkills.length - 8} more`}
            </div>
          )}
        </div>
      )
    },
  },

  updateSkillSelection: {
    loadingLabel: 'Updating skill selection...',
    marker: ThinkingTimelineMarker.Default,
    inline: true,
    renderLoading: () => (
      <div className="bg-muted text-muted-foreground inline-flex max-w-full items-center gap-2 rounded-md px-2 py-1 text-xs">
        <Sparkles className="size-3.5 shrink-0 animate-pulse" />
        <span className="truncate">Updating skill selection...</span>
      </div>
    ),
    renderOutput: (output, toolCallId) => {
      const result = (output ?? {}) as {
        success?: boolean
        repoName?: string
        mode?: string
        skills?: string[]
        error?: string
      }

      if (result.success === false) {
        return (
          <div
            key={toolCallId}
            className="bg-destructive/10 text-destructive my-1 inline-flex max-w-full items-center gap-2 rounded-md px-2 py-1 text-xs"
          >
            <Sparkles className="size-3.5 shrink-0" />
            <span className="truncate">{result.error || 'Update failed'}</span>
          </div>
        )
      }

      return (
        <div
          key={toolCallId}
          className="bg-muted text-muted-foreground my-1 inline-flex max-w-full items-center gap-2 rounded-md px-2 py-1 text-xs"
        >
          <Sparkles className="size-3.5 shrink-0" />
          <span className="font-medium">
            {result.repoName || 'Selection'} updated
          </span>
          <span>
            Mode: <span className="font-medium">{result.mode}</span>
          </span>
          {result.skills && result.skills.length > 0 && (
            <span className="truncate">
              ({result.skills.length} skill
              {result.skills.length !== 1 ? 's' : ''})
            </span>
          )}
          <Check className="size-3 shrink-0 text-green-600" />
        </div>
      )
    },
  },

  initSkillsConfig: {
    loadingLabel: 'Initializing skills config...',
    marker: ThinkingTimelineMarker.Default,
    inline: true,
    renderLoading: () => (
      <div className="bg-muted text-muted-foreground inline-flex max-w-full items-center gap-2 rounded-md px-2 py-1 text-xs">
        <BookOpen className="size-3.5 shrink-0 animate-pulse" />
        <span className="truncate">Initializing skills configuration...</span>
      </div>
    ),
    renderOutput: (output, toolCallId) => {
      const result = (output ?? {}) as {
        success?: boolean
        message?: string
        repositories?: Array<{
          name: string
          url: string
          mode: string
          skills: string[]
        }>
        error?: string
      }

      if (result.success === false) {
        return (
          <div
            key={toolCallId}
            className="bg-destructive/10 text-destructive my-1 inline-flex max-w-full items-center gap-2 rounded-md px-2 py-1 text-xs"
          >
            <BookOpen className="size-3.5 shrink-0" />
            <span className="truncate">
              {result.error || 'Initialization failed'}
            </span>
          </div>
        )
      }

      return (
        <div
          key={toolCallId}
          className="bg-muted text-muted-foreground my-1 min-w-0"
        >
          <div className="inline-flex max-w-full items-center gap-2 rounded-md px-2 py-1 text-xs">
            <BookOpen className="size-3.5 shrink-0" />
            <span className="font-medium">Skills config initialized</span>
            <Check className="size-3 shrink-0 text-green-600" />
          </div>
          {result.repositories && result.repositories.length > 0 && (
            <div className="text-muted-foreground px-2 pb-1 text-[10px]">
              Added: {result.repositories.map((r) => r.name).join(', ')}
            </div>
          )}
        </div>
      )
    },
  },
}

/**
 * Get the handler for a tool
 */
export function getToolHandler(toolName: string): ToolHandler {
  const handler = DEFAULT_TOOL_HANDLERS[toolName]
  if (handler) {
    return handler
  }

  // Default handler for unknown tools
  return {
    loadingLabel: `Using ${toolName}...`,
    marker: ThinkingTimelineMarker.Default,
    inline: false,
    renderOutput: (output, toolCallId) => {
      const outputContent =
        typeof output === 'string'
          ? output
          : output
            ? JSON.stringify(output, null, 2)
            : 'No output'

      return (
        <div key={toolCallId} className="min-w-0 px-2 py-1">
          <div className="text-muted-foreground min-w-0 font-mono text-xs">
            <div className="truncate font-semibold">{toolName} completed</div>
            <CodeBlock maxHeight={150} className="mt-1">
              {outputContent.slice(0, 1000)}
              {outputContent.length > 1000 && '\n... (truncated)'}
            </CodeBlock>
          </div>
        </div>
      )
    },
  }
}
