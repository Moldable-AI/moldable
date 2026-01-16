# Streaming Tool Execution Output

## Overview

Tool executions (particularly shell commands) currently show no progress until completion. Users see a static "Running command..." indicator with no stdout/stderr output until the entire command finishes. This creates a poor experience for long-running commands where users can't tell if the command is working, stuck, or producing output.

## Problem Statement

1. **No visibility during execution**: Commands like `npm install`, `cargo build`, or test suites can run for minutes with no visible progress
2. **Batch-only tool results**: The Vercel AI SDK's tool model is request/response - tools return a complete result, not a stream
3. **`renderLoading` limitations**: The loading renderer only receives tool **arguments** (what the AI is typing), not execution output
4. **User uncertainty**: Users can't tell if a command is hanging, working, or producing errors

### Current Flow

```
┌─────────────────────────────────────────────────────────────────┐
│  AI streams tool arguments          Tool executes (hidden)      │
│  ──────────────────────────>        ════════════════════        │
│                                                                 │
│  UI shows: "$ npm install..."       UI shows: same thing        │
│            (command being typed)              (no progress)     │
│                                                                 │
│                                     ───────────────────────>    │
│                                     Complete result returned    │
│                                     UI finally shows output     │
└─────────────────────────────────────────────────────────────────┘
```

## Goals

- Stream stdout/stderr to UI as commands execute in real-time
- Show progress for all tool types that produce incremental output
- Maintain compatibility with AI SDK's tool model
- Keep UI responsive during long-running commands
- Support cancellation of running commands

## Non-Goals

- Interactive terminal (stdin support) - this is agentic, not interactive
- Full PTY emulation with ANSI escape codes
- Streaming output for tools that are inherently batch (file reads, searches)
- Real-time output for sub-second commands (not worth the complexity)

## Prior Art

- **Cursor**: Shows streaming terminal output during command execution
- **Devin/Codex**: Stream shell output in real-time
- **Vercel AI SDK**: Has experimental `experimental_toToolResultContent` and generator-based tool execution, but limited

---

## Architecture

### Proposed Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│  AI streams tool arguments     Tool executes with progress channel      │
│  ──────────────────────>       ════════════════════════════════════     │
│                                         │                               │
│  UI: "$ npm install"                    │ stdout chunk: "Installing..." │
│       (command visible)                 │ ─────────────────────────>    │
│                                         │ UI updates in real-time       │
│                                         │                               │
│                                         │ stdout chunk: "added 50..."   │
│                                         │ ─────────────────────────>    │
│                                         │ UI updates                    │
│                                         │                               │
│                                         └──── Complete ────────────>    │
│                                              Final result + full output │
└─────────────────────────────────────────────────────────────────────────┘
```

### Data Model

```typescript
/**
 * Progress update emitted during tool execution
 */
interface ToolProgressUpdate {
  /** Which tool call this is for */
  toolCallId: string

  /** Type of progress */
  type: 'stdout' | 'stderr' | 'status'

  /** The content chunk */
  content: string

  /** Timestamp */
  timestamp: number
}

/**
 * Extended tool handler with streaming support
 */
interface StreamingToolHandler extends ToolHandler {
  /**
   * Render function for streaming output during execution.
   * Called with accumulated output as it arrives.
   */
  renderStreaming?: (
    args: unknown,
    progress: {
      stdout: string
      stderr: string
      status?: string
    },
  ) => ReactNode
}
```

### Stream Protocol Extension

Add a new event type to the UI message stream for tool progress:

```typescript
// New stream event types
type ToolProgressEvent = {
  type: 'tool-progress'
  toolCallId: string
  progress: ToolProgressUpdate
}

// Extended stream includes progress events interleaved with other events
// 0: text-delta
// 1: tool-call-streaming-start
// 2: tool-call-delta (arguments streaming)
// 3: tool-call-streaming-finish
// 4: tool-progress        <-- NEW: stdout/stderr chunks during execution
// 5: tool-result          <-- existing: final result
```

---

## Implementation Plan

### Phase 1: Server-Side Streaming Infrastructure

**Files to modify:**

1. `packages/ai/src/tools/bash.ts` - Add progress callback to `executeCommand`

**Changes to `executeCommand`:**

```typescript
async function executeCommand(
  command: string,
  options: {
    cwd?: string
    timeout?: number
    maxBuffer?: number
    useSandbox?: boolean
    // NEW: Progress callback for streaming output
    onProgress?: (update: {
      type: 'stdout' | 'stderr'
      content: string
    }) => void
  },
): Promise<CommandResult> {
  // ... existing setup ...

  // Collect stdout with progress emission
  child.stdout?.on('data', (data: Buffer) => {
    const chunk = data.toString()
    if (stdout.length + chunk.length <= maxBuffer) {
      stdout += chunk
      // Emit progress if callback provided
      options.onProgress?.({ type: 'stdout', content: chunk })
    }
  })

  // Same for stderr
  child.stderr?.on('data', (data: Buffer) => {
    const chunk = data.toString()
    if (stderr.length + chunk.length <= maxBuffer) {
      stderr += chunk
      options.onProgress?.({ type: 'stderr', content: chunk })
    }
  })

  // ... rest unchanged ...
}
```

### Phase 2: Tool Execution with Progress Channel

**Files to modify:**

1. `packages/ai/src/tools/bash.ts` - Expose progress in tool definition
2. `packages/ai-server/src/index.ts` - Wire up progress streaming

**Approach A: Custom Tool Wrapper**

The AI SDK doesn't natively support streaming tool execution. We need to:

1. Intercept tool execution at the server level
2. Execute tools ourselves with progress callbacks
3. Stream progress events to the client while tool runs
4. Return final result when complete

```typescript
// In ai-server/src/index.ts

// Create a progress emitter for streaming tools
function createStreamingToolExecutor(
  tools: Record<string, CoreTool>,
  writer: UIMessageStreamWriter,
) {
  return Object.fromEntries(
    Object.entries(tools).map(([name, tool]) => {
      if (name === 'runCommand') {
        // Wrap command execution with progress streaming
        return [
          name,
          {
            ...tool,
            execute: async (
              input: { command: string; workingDirectory?: string },
              context,
            ) => {
              const toolCallId = context.toolCallId

              return executeCommand(input.command, {
                cwd: input.workingDirectory,
                onProgress: (update) => {
                  // Stream progress to client
                  writer.write({
                    type: 'tool-progress',
                    toolCallId,
                    progress: update,
                  })
                },
              })
            },
          },
        ]
      }
      return [name, tool]
    }),
  )
}
```

**Approach B: Side-Channel SSE (Alternative)**

If modifying the main stream is complex, use a parallel SSE connection:

```typescript
// Client opens: GET /tool-progress/:conversationId
// Server pushes progress events as they occur
// Client merges with main chat stream
```

### Phase 3: Client-Side Progress Handling

**Files to modify:**

1. `packages/ui/src/components/chat/tool-handlers.tsx` - Add `renderStreaming`
2. `desktop/src/hooks/use-moldable-chat.ts` - Handle progress events
3. `packages/ui/src/components/chat/chat-messages.tsx` - Wire up streaming renderer

**Progress state management:**

```typescript
// In use-moldable-chat.ts

// Track progress per tool call
const [toolProgress, setToolProgress] = useState<
  Record<string, { stdout: string; stderr: string }>
>({})

// Handle progress events from stream
function handleStreamEvent(event: StreamEvent) {
  if (event.type === 'tool-progress') {
    setToolProgress((prev) => ({
      ...prev,
      [event.toolCallId]: {
        stdout:
          (prev[event.toolCallId]?.stdout || '') +
          (event.progress.type === 'stdout' ? event.progress.content : ''),
        stderr:
          (prev[event.toolCallId]?.stderr || '') +
          (event.progress.type === 'stderr' ? event.progress.content : ''),
      },
    }))
  }
}

// Clear progress when tool completes
function handleToolResult(toolCallId: string) {
  setToolProgress((prev) => {
    const { [toolCallId]: _, ...rest } = prev
    return rest
  })
}
```

### Phase 4: UI Rendering

**Files to modify:**

1. `packages/ui/src/components/chat/tool-handlers.tsx`

**Add streaming renderer for terminal output:**

```typescript
runCommand: {
  loadingLabel: 'Running command...',
  marker: ThinkingTimelineMarker.Terminal,
  inline: true,

  // Existing loading renderer (shows command being typed)
  renderLoading: (args) => { /* ... */ },

  // NEW: Streaming renderer (shows live output)
  renderStreaming: (args, progress) => {
    const { command } = (args ?? {}) as { command?: string }
    const { stdout, stderr } = progress

    return (
      <div className="border-terminal-border bg-terminal my-2 min-w-0 overflow-hidden rounded-lg border">
        <div className="bg-terminal-header flex min-w-0 items-center gap-2 px-3 py-1.5">
          <Terminal className="text-terminal-muted size-3.5 shrink-0 animate-pulse" />
          <code className="text-terminal-foreground min-w-0 flex-1 truncate font-mono text-xs">
            {command ? summarizeCommand(command) : 'Running...'}
          </code>
          <span className="text-terminal-muted text-xs">Running...</span>
        </div>
        <div className="max-h-[300px] overflow-auto p-3">
          <div className="text-terminal-foreground mb-2 break-all font-mono text-xs">
            <span className="text-terminal-muted">$</span> {command}
          </div>
          {(stdout || stderr) && (
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
            </div>
          )}
        </div>
      </div>
    )
  },

  // Existing output renderer (final result)
  renderOutput: (output, toolCallId) => { /* ... */ },
}
```

### Phase 5: Cancellation Support

**Files to modify:**

1. `packages/ai/src/tools/bash.ts` - Accept AbortSignal
2. `packages/ai-server/src/index.ts` - Propagate abort to running tools
3. UI components - Show cancel button during execution

```typescript
// In bash.ts
async function executeCommand(
  command: string,
  options: {
    // ... existing options ...
    abortSignal?: AbortSignal
  },
) {
  // ... setup ...

  // Handle abort
  if (options.abortSignal) {
    options.abortSignal.addEventListener('abort', () => {
      child.kill('SIGTERM')
      setTimeout(() => {
        if (!child.killed) child.kill('SIGKILL')
      }, 5000)
    })
  }

  // ... rest ...
}
```

---

## Testing Strategy

### Unit Tests

1. **Progress callback invocation**
   - Verify `onProgress` called for each stdout/stderr chunk
   - Verify chunk content matches actual output
   - Verify order preserved

2. **Abort signal handling**
   - Verify command killed on abort
   - Verify partial output returned

### Integration Tests

1. **End-to-end streaming**
   - Start long-running command (e.g., `sleep 1 && echo "a" && sleep 1 && echo "b"`)
   - Verify progress events arrive at client in order
   - Verify final result matches accumulated progress

2. **Concurrent tool calls**
   - Multiple commands running simultaneously
   - Verify progress events correctly attributed to tool call IDs

### Manual Testing

1. Run `npm install` in a project with many dependencies
2. Verify output streams in real-time, not all at once
3. Cancel mid-execution, verify partial output shown
4. Run command that produces stderr, verify it shows differently

---

## Edge Cases

1. **Very fast commands**: If command completes before first progress event, just show final result (no streaming needed)

2. **Binary output**: Skip streaming for commands that output binary data (detect and batch)

3. **Massive output**: Cap streaming buffer (e.g., last 50KB), but keep full output for final result

4. **Interleaved stdout/stderr**: Preserve order as much as possible (may require timestamp-based merging)

5. **Command produces no output**: Show "Running..." status, then final exit code

6. **Network interruption**: If client disconnects mid-stream, server should still complete command (result stored for reconnect)

7. **Tool timeout**: Stream final output before timeout, then show timeout error

---

## Performance Considerations

1. **Throttle progress updates**: Don't send every byte - batch updates every 100ms or 4KB, whichever comes first

2. **Virtualize long output**: For commands with thousands of lines, use virtual scrolling in UI

3. **Lazy rendering**: Only render visible portion of streaming output

4. **Memory management**: Clear accumulated progress from state once tool completes

---

## Future Enhancements

1. **ANSI color support**: Parse and render terminal colors in streaming output
2. **Progress bars**: Detect and render progress indicators (e.g., from npm, cargo)
3. **Collapsible output**: Auto-collapse long output, expand on click
4. **Search in output**: Find text in streaming/completed command output
5. **Copy output**: Easy copy button for command output
6. **Persist running state**: If app restarts, reconnect to running commands (requires process manager)

---

## Success Metrics

1. **User sees output within 200ms**: First stdout chunk visible < 200ms after command starts producing output
2. **No UI jank**: Streaming updates don't cause frame drops
3. **Accurate final result**: Streaming output matches final result exactly
4. **Cancellation works**: User can stop long commands and see partial output
