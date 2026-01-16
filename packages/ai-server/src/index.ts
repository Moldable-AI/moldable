#!/usr/bin/env node
import {
  DEFAULT_MODEL,
  LLMProvider,
  type ReasoningEffort,
  buildSystemPrompt,
  createMoldableTools,
  getProviderConfig,
  toMarkdown,
} from '@moldable-ai/ai'
import {
  McpClientManager,
  type McpServerInfo,
  addMcpServer,
  createMcpTools,
  getMcpServer,
  getMcpbInstallDir,
  installBundleFromExtracted,
  parseManifest,
  removeMcpServer,
} from '@moldable-ai/mcp'
import {
  type UIMessage,
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  stepCountIs,
  streamText,
} from 'ai'
import { config } from 'dotenv'
import { strFromU8, unzipSync } from 'fflate'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { IncomingMessage, ServerResponse, createServer } from 'http'
import { homedir } from 'os'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Development workspace - only relevant when developing Moldable itself
// This is NOT where user apps go (that's MOLDABLE_HOME/shared/apps/)
// Only set if explicitly provided via env var or request body
const WORKSPACE_ROOT = process.env.MOLDABLE_WORKSPACE || null

// Moldable home directory - where all user data, apps, and configs live
const MOLDABLE_HOME = join(homedir(), '.moldable')

// Try multiple locations for .env file
// Priority: shared/.env (user home) > dev workspace shared/.env > dev .env
const envPaths = [
  join(homedir(), '.moldable', 'shared', '.env'), // User's shared env for all workspaces
  join(__dirname, '..', '..', '..', '.moldable', 'shared', '.env'), // Dev workspace
  join(__dirname, '..', '..', '..', '.env'), // Dev fallback
]

for (const envPath of envPaths) {
  if (existsSync(envPath)) {
    config({ path: envPath })
    console.log(`📁 Loaded env from: ${envPath}`)
    break
  }
}

const PORT = process.env.MOLDABLE_AI_PORT || 3100
const HOST = process.env.MOLDABLE_AI_HOST || '127.0.0.1'
const DEBUG_CHAT_REQUESTS =
  process.env.MOLDABLE_DEBUG_CHAT_REQUESTS === '1' ||
  process.env.MOLDABLE_DEBUG_PROMPTS === '1' ||
  process.env.MOLDABLE_DEBUG === '1' ||
  process.env.DEBUG === '1'

// MCP client manager (singleton)
// MCPs are shared across all workspaces
const mcpManager = new McpClientManager(
  join(homedir(), '.moldable', 'shared', 'config', 'mcp.json'),
)
let mcpServers: McpServerInfo[] = []

// Initialize MCP connections
async function initMcpConnections() {
  console.log('🔌 Connecting to MCP servers...')
  try {
    mcpServers = await mcpManager.connectAll()
    const connected = mcpServers.filter((s) => s.status === 'connected')
    const failed = mcpServers.filter((s) => s.status === 'error')

    if (connected.length > 0) {
      console.log(`✅ Connected to ${connected.length} MCP server(s):`)
      for (const server of connected) {
        console.log(`   - ${server.name}: ${server.tools.length} tools`)
      }
    }

    if (failed.length > 0) {
      console.log(`⚠️  Failed to connect to ${failed.length} MCP server(s):`)
      for (const server of failed) {
        console.log(`   - ${server.name}: ${server.error}`)
      }
    }

    if (mcpServers.length === 0) {
      console.log('   No MCP servers configured')
    }
  } catch (error) {
    console.error('❌ Error initializing MCP connections:', error)
  }
}

// CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers':
    'Content-Type, Authorization, User-Agent, X-Requested-With',
}

// Parse JSON body
async function parseBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', (chunk) => {
      body += chunk.toString()
    })
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {})
      } catch (e) {
        reject(e)
      }
    })
    req.on('error', reject)
  })
}

// Send JSON response
function sendJson(res: ServerResponse, data: unknown, status = 200): void {
  res.writeHead(status, {
    ...corsHeaders,
    'Content-Type': 'application/json',
  })
  res.end(JSON.stringify(data))
}

// Send error response
function sendError(res: ServerResponse, message: string, status = 500): void {
  sendJson(res, { error: message }, status)
}

/**
 * Remove dangling tool calls from messages.
 *
 * When a user sends a new message while the assistant is executing tools,
 * we may have tool_call blocks without corresponding tool_result blocks.
 * The Anthropic API requires every tool_use to have a matching tool_result.
 *
 * This function:
 * 1. Collects all tool call IDs from tool messages
 * 2. Removes tool calls that don't have matching results
 * 3. Removes assistant messages that become empty after removing dangling calls
 */
function removeDanglingToolCalls<T extends { role: string; content: unknown }>(
  messages: T[],
): T[] {
  // First pass: collect all tool result IDs
  const toolResultIds = new Set<string>()
  for (const msg of messages) {
    if (msg.role === 'tool' && Array.isArray(msg.content)) {
      for (const part of msg.content as Array<{
        type: string
        toolCallId?: string
      }>) {
        if (part.type === 'tool-result' && part.toolCallId) {
          toolResultIds.add(part.toolCallId)
        }
      }
    }
  }

  // Second pass: filter out dangling tool calls
  const result: T[] = []

  for (const msg of messages) {
    if (msg.role === 'assistant' && Array.isArray(msg.content)) {
      const content = msg.content as Array<{
        type: string
        toolCallId?: string
        text?: string
      }>

      // Check if this message has tool calls
      const hasToolCalls = content.some((part) => part.type === 'tool-call')

      if (hasToolCalls) {
        // Filter out tool calls that don't have matching results
        const filteredContent = content.filter((part) => {
          if (part.type === 'tool-call' && part.toolCallId) {
            const hasResult = toolResultIds.has(part.toolCallId)
            if (!hasResult) {
              console.log(
                `   ⚠️ Removing dangling tool call: ${part.toolCallId} (no matching tool_result)`,
              )
            }
            return hasResult
          }
          return true // Keep non-tool-call parts
        })

        // Check if the message still has meaningful content after filtering
        const hasRemainingContent = filteredContent.some((part) => {
          if (part.type === 'text' && part.text) {
            return part.text.trim() !== ''
          }
          return part.type === 'tool-call' // Any remaining tool calls are valid
        })

        if (hasRemainingContent) {
          result.push({ ...msg, content: filteredContent })
        } else if (filteredContent.length > 0) {
          // Has content but no text or tool-calls (e.g., only reasoning)
          // Check if this is the last message - if so, keep it
          // Otherwise, filter it out
          const isLast = msg === messages[messages.length - 1]
          if (isLast) {
            result.push({ ...msg, content: filteredContent })
          } else {
            console.log(
              `   ⚠️ Filtering out assistant message with only reasoning after removing dangling tool calls`,
            )
          }
        } else {
          console.log(
            `   ⚠️ Filtering out assistant message that became empty after removing dangling tool calls`,
          )
        }
      } else {
        // No tool calls, keep as is
        result.push(msg)
      }
    } else {
      // Non-assistant messages, keep as is
      result.push(msg)
    }
  }

  return result
}

// Handle chat request - using AI SDK's UIMessage format for useChat compatibility
async function handleChat(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  // Create abort controller for this request
  const abortController = new AbortController()
  let isAborted = false

  // Listen for client disconnect to abort the request.
  // Note: req 'close' fires when request body is done being read (normal behavior).
  // We only treat it as an abort if we've started streaming (headers sent) but haven't finished.
  req.on('close', () => {
    if (res.headersSent && !res.writableEnded) {
      console.log('⚠️ Client disconnected mid-stream, aborting...')
      isAborted = true
      abortController.abort()
    }
  })

  try {
    const body = (await parseBody(req)) as {
      messages?: UIMessage[]
      model?: string
      reasoningEffort?: ReasoningEffort
      basePath?: string // Workspace root for file operations
      activeWorkspaceId?: string // Active workspace ID (e.g., "personal", "work")
      registeredApps?: Array<{
        // All registered apps in Moldable
        id: string
        name: string
        icon: string
      }>
      activeApp?: {
        // Currently active app in Moldable
        id: string
        name: string
        icon: string
        workingDir: string
        dataDir: string
      }
    }

    console.log('📨 Received chat request')
    if (DEBUG_CHAT_REQUESTS) {
      console.log('   Raw body:', JSON.stringify(body, null, 2))
    }

    if (!body.messages || !Array.isArray(body.messages)) {
      sendError(res, 'messages array is required', 400)
      return
    }

    const model = (body.model as LLMProvider) || DEFAULT_MODEL
    const reasoningEffort = body.reasoningEffort || 'medium'
    console.log('   Model:', model)
    console.log('   Reasoning effort:', reasoningEffort)
    console.log('   Input messages:', body.messages.length)
    if (body.activeApp) {
      console.log(
        `   Active app: ${body.activeApp.icon} ${body.activeApp.name} (${body.activeApp.workingDir})`,
      )
    }

    // Get API keys from environment
    const apiKeys = {
      anthropicApiKey: process.env.ANTHROPIC_API_KEY,
      openaiApiKey: process.env.OPENAI_API_KEY,
      openrouterApiKey: process.env.OPENROUTER_API_KEY,
    }

    // Check if we have the required API key
    const isAnthropic = model.startsWith('anthropic/')
    const isOpenRouter = model.startsWith('openrouter/')
    if (isAnthropic && !apiKeys.anthropicApiKey) {
      sendError(res, 'ANTHROPIC_API_KEY not configured', 500)
      return
    }
    if (isOpenRouter && !apiKeys.openrouterApiKey) {
      sendError(res, 'OPENROUTER_API_KEY not configured', 500)
      return
    }
    if (!isAnthropic && !isOpenRouter && !apiKeys.openaiApiKey) {
      sendError(res, 'OPENAI_API_KEY not configured', 500)
      return
    }

    // toolsBasePath: Where bash commands run and the default working directory for tools.
    // - body.basePath: Sent by desktop when user is viewing a specific app (the app's working dir)
    // - WORKSPACE_ROOT: Fallback for Moldable development (the monorepo path)
    // - undefined: No specific working dir, tools resolve paths from root
    //
    // NOTE: Even with a basePath set, tools can always access ~/.moldable/*
    // (home dir is allowlisted) so apps are created in MOLDABLE_HOME/shared/apps/
    const toolsBasePath = body.basePath || WORKSPACE_ROOT || undefined
    if (toolsBasePath) {
      console.log('   Tools base path:', toolsBasePath)
    }

    // Create Moldable built-in tools
    const moldableTools = createMoldableTools({
      basePath: toolsBasePath,
    })

    // Create MCP tools from connected servers
    const mcpTools = createMcpTools(mcpManager)
    const mcpToolCount = Object.keys(mcpTools).length
    if (mcpToolCount > 0) {
      console.log(`   MCP tools: ${mcpToolCount}`)
    }

    // Combine all tools
    const tools = {
      ...moldableTools,
      ...mcpTools,
    }
    const toolNames = Object.keys(tools)

    // Build system message (async to load AGENTS.md from development workspace)
    // developmentWorkspace is ONLY for reading AGENTS.md when developing Moldable itself
    const systemMessage = await buildSystemPrompt({
      developmentWorkspace: WORKSPACE_ROOT || undefined,
      activeWorkspaceId: body.activeWorkspaceId,
      moldableHome: MOLDABLE_HOME,
      currentDate: new Date(),
      availableTools: toolNames,
      registeredApps: body.registeredApps,
      activeApp: body.activeApp,
    })

    // Get provider config
    const {
      model: languageModel,
      temperature,
      providerOptions,
    } = getProviderConfig(model, apiKeys, reasoningEffort)

    // DEBUG: Log incoming UIMessages structure
    console.log('   === UIMessages Debug ===')
    for (const msg of body.messages) {
      console.log(`   [${msg.role}] id=${msg.id}`)
      console.log(`      parts: ${JSON.stringify(msg.parts)}`)
    }
    console.log('   ========================')

    // Pre-filter UIMessages to remove messages with empty content
    // This can happen when user sends a new message while streaming (assistant message is empty/partial)
    const validUIMessages = body.messages.filter((msg) => {
      // If no parts or empty parts array, filter out
      if (!msg.parts || msg.parts.length === 0) {
        console.log(
          `   ⚠️ Filtering out ${msg.role} UIMessage with no parts (id: ${msg.id})`,
        )
        return false
      }

      // Check if message has any non-empty content in its parts
      const hasNonEmptyContent = msg.parts.some((part) => {
        // Check text-based parts (text, reasoning) for non-empty text
        if (part.type === 'text' || part.type === 'reasoning') {
          const textPart = part as { text?: string }
          const hasText = textPart.text && textPart.text.trim() !== ''
          console.log(
            `      part.type=${part.type}, hasText=${hasText}, text="${(textPart.text || '').substring(0, 50)}..."`,
          )
          return hasText
        }
        // Tool invocations are valid content (they have structured data, not text)
        if (part.type.startsWith('tool-') || part.type === 'dynamic-tool') {
          console.log(`      part.type=${part.type}, valid=true (tool)`)
          return true
        }
        // Other part types (file, source-url, etc.) - assume valid if present
        console.log(`      part.type=${part.type}, valid=true (other)`)
        return true
      })

      if (!hasNonEmptyContent) {
        console.log(
          `   ⚠️ Filtering out ${msg.role} UIMessage with empty content (id: ${msg.id})`,
        )
        return false
      }
      return true
    })

    // Convert UIMessages to ModelMessages using AI SDK's converter
    const modelMessages = await convertToModelMessages(validUIMessages, {
      tools: toolNames.length > 0 ? tools : undefined,
    })

    // DEBUG: Log model messages structure
    console.log('   === ModelMessages Debug ===')
    for (const msg of modelMessages) {
      console.log(`   [${msg.role}] content type: ${typeof msg.content}`)
      if (typeof msg.content === 'string') {
        console.log(`      content: "${msg.content.substring(0, 100)}..."`)
      } else if (Array.isArray(msg.content)) {
        console.log(`      content array length: ${msg.content.length}`)
        for (const part of msg.content) {
          console.log(
            `      - type: ${part.type}, ${JSON.stringify(part).substring(0, 100)}...`,
          )
        }
      }
    }
    console.log('   ============================')

    // Double-check: filter out any model messages with empty/invalid content
    // Non-final assistant messages must have actual text content, not just reasoning
    // IMPORTANT: We must preserve assistant messages with tool_call blocks, as the next
    // message will have tool_result blocks that reference them (Anthropic API requirement)
    const filteredMessages = modelMessages.filter((msg, index) => {
      const isLastMessage = index === modelMessages.length - 1

      // Keep messages that have non-empty string content
      if (typeof msg.content === 'string' && msg.content.trim() !== '') {
        return true
      }

      // For array content, check if there's actual text content (not just reasoning)
      if (Array.isArray(msg.content) && msg.content.length > 0) {
        // For assistant messages that are NOT the final message,
        // we need actual text content, not just reasoning
        // BUT we must keep messages with tool_call blocks (tool invocations)
        if (msg.role === 'assistant' && !isLastMessage) {
          const hasTextContent = msg.content.some(
            (part) => part.type === 'text' && 'text' in part && part.text,
          )
          const hasToolCall = msg.content.some(
            (part) => part.type === 'tool-call',
          )

          // Keep if has text or tool calls
          if (!hasTextContent && !hasToolCall) {
            console.log(
              `   ⚠️ Filtering out non-final assistant message with only reasoning (no text/tool content)`,
            )
            return false
          }
        }
        return true
      }

      // Filter out messages with empty/missing content
      console.log(
        `   ⚠️ Filtering out ${msg.role} model message with empty content`,
      )
      return false
    })

    // Fix dangling tool calls: if an assistant message has tool_call blocks but
    // no corresponding tool_result in the next message, we need to remove those tool calls.
    // This happens when user sends a new message while assistant is executing tools.
    const fixedMessages = removeDanglingToolCalls(filteredMessages)

    const uiFiltered = body.messages.length - validUIMessages.length
    const modelFiltered = modelMessages.length - fixedMessages.length
    console.log(
      '   Messages:',
      `${body.messages.length} UI → ${validUIMessages.length} valid → ${modelMessages.length} model → ${fixedMessages.length} final`,
      uiFiltered + modelFiltered > 0
        ? `(filtered ${uiFiltered + modelFiltered} empty/dangling)`
        : '',
    )

    if (DEBUG_CHAT_REQUESTS) {
      // Log the full request for debugging
      console.log('\n=== Chat Request ===')
      console.log(
        toMarkdown(
          {
            provider: model,
            temperature,
            tools_enabled: `${toolNames.length} tools`,
            available_tools: toolNames,
          },
          { namespace: 'config' },
        ),
      )
      console.log('--- System Prompt ---')
      console.log(systemMessage)
      console.log('--- Messages ---')
      console.log(toMarkdown(fixedMessages, { namespace: 'messages' }))
      console.log('=== End Request ===\n')
    }

    // Create UI message stream response (compatible with useChat/DefaultChatTransport)
    const streamResponse = createUIMessageStreamResponse({
      stream: createUIMessageStream({
        originalMessages: body.messages,
        execute: async ({ writer }) => {
          try {
            if (DEBUG_CHAT_REQUESTS) {
              console.log('   Starting streamText...')
            }
            const result = streamText({
              model: languageModel,
              messages: [
                { role: 'system', content: systemMessage },
                ...fixedMessages,
              ],
              temperature,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              providerOptions: providerOptions as any,
              tools,
              stopWhen: stepCountIs(1000),
              abortSignal: abortController.signal,
            })

            if (DEBUG_CHAT_REQUESTS) {
              console.log('   Merging stream...')
            }
            writer.merge(
              result.toUIMessageStream({
                sendReasoning: true,
              }),
            )
          } catch (streamError) {
            // Don't log abort errors as they're expected when user stops
            if (
              streamError instanceof Error &&
              streamError.name === 'AbortError'
            ) {
              console.log('⚠️ Stream aborted by user')
              return
            }
            console.error('   Stream error:', streamError)
            throw streamError
          }
        },
      }),
    })

    // Copy headers and pipe the stream
    res.writeHead(200, {
      ...corsHeaders,
      'Content-Type':
        streamResponse.headers.get('Content-Type') || 'text/plain',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    })

    if (streamResponse.body) {
      const reader = streamResponse.body.getReader()
      const pump = async () => {
        try {
          while (true) {
            // Check if aborted before each read
            if (isAborted) {
              console.log('⚠️ Stopping pump due to abort')
              reader.cancel()
              res.end()
              break
            }
            const { done, value } = await reader.read()
            if (done) {
              console.log('✅ Stream completed')
              res.end()
              break
            }
            res.write(value)
          }
        } catch (err) {
          // Don't log abort errors
          if (err instanceof Error && err.name === 'AbortError') {
            console.log('⚠️ Pump aborted')
          } else {
            console.error('Stream error:', err)
          }
          res.end()
        }
      }
      pump()
    } else {
      res.end()
    }
  } catch (error) {
    // Don't log abort errors
    if (error instanceof Error && error.name === 'AbortError') {
      console.log('⚠️ Request aborted')
      return
    }
    console.error('❌ Chat error:', error)
    if (!res.headersSent) {
      sendError(
        res,
        error instanceof Error ? error.message : 'Internal server error',
      )
    }
  }
}

// Re-read .env file and update process.env with fresh values
// This allows detecting newly added API keys without restarting the server
// NOTE: We manually parse instead of using dotenv's config() because
// config({ override: true }) doesn't reliably update process.env in all cases
function reloadEnvFile(): void {
  for (const envPath of envPaths) {
    if (existsSync(envPath)) {
      // Clear existing API key values so we detect removal too
      delete process.env.ANTHROPIC_API_KEY
      delete process.env.OPENAI_API_KEY
      delete process.env.OPENROUTER_API_KEY

      // Manually parse and set env vars
      try {
        const content = readFileSync(envPath, 'utf-8')
        for (const line of content.split('\n')) {
          const trimmed = line.trim()
          // Skip comments and empty lines
          if (!trimmed || trimmed.startsWith('#')) continue
          const eqIndex = trimmed.indexOf('=')
          if (eqIndex > 0) {
            const key = trimmed.slice(0, eqIndex).trim()
            const value = trimmed.slice(eqIndex + 1).trim()
            // Only set API key env vars we care about
            if (
              key === 'ANTHROPIC_API_KEY' ||
              key === 'OPENAI_API_KEY' ||
              key === 'OPENROUTER_API_KEY'
            ) {
              process.env[key] = value
            }
          }
        }
      } catch (err) {
        console.error(`Failed to read env file ${envPath}:`, err)
      }
      break
    }
  }
}

// Handle health check
function handleHealth(res: ServerResponse): void {
  // Re-read .env to pick up newly added API keys
  reloadEnvFile()

  sendJson(res, {
    status: 'ok',
    version: '0.1.0',
    hasAnthropicKey: !!process.env.ANTHROPIC_API_KEY,
    hasOpenAIKey: !!process.env.OPENAI_API_KEY,
    hasOpenRouterKey: !!process.env.OPENROUTER_API_KEY,
    mcpServers: mcpServers.map((s) => ({
      name: s.name,
      status: s.status,
      toolCount: s.tools.length,
      error: s.error,
    })),
  })
}

// Handle MCP servers list
function handleMcpServers(res: ServerResponse): void {
  sendJson(res, {
    servers: mcpServers.map((s) => ({
      name: s.name,
      config: s.config,
      status: s.status,
      error: s.error,
      tools: s.tools.map((t) => ({
        name: t.name,
        description: t.description,
      })),
    })),
  })
}

// Handle MCP reload
async function handleMcpReload(res: ServerResponse): Promise<void> {
  console.log('🔄 Reloading MCP connections...')
  try {
    mcpServers = await mcpManager.reload()
    const connected = mcpServers.filter((s) => s.status === 'connected')
    console.log(`✅ Reloaded: ${connected.length} connected`)
    sendJson(res, {
      success: true,
      servers: mcpServers.map((s) => ({
        name: s.name,
        status: s.status,
        toolCount: s.tools.length,
        error: s.error,
      })),
    })
  } catch (error) {
    console.error('❌ Error reloading MCP:', error)
    sendError(
      res,
      error instanceof Error ? error.message : 'Failed to reload MCP',
    )
  }
}

// Handle adding a new MCP server
async function handleAddMcpServer(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const body = (await parseBody(req)) as {
    name?: string
    config?: {
      type?: 'stdio' | 'http' | 'sse'
      command?: string
      args?: string[]
      env?: Record<string, string>
      url?: string
      headers?: Record<string, string>
    }
  }
  const { name, config: serverConfig } = body

  if (!name || !serverConfig) {
    sendError(res, 'name and config are required', 400)
    return
  }

  // Validate required fields based on type
  const type = serverConfig.type || (serverConfig.command ? 'stdio' : 'http')
  if (type === 'stdio' && !serverConfig.command) {
    sendError(res, 'command is required for stdio servers', 400)
    return
  }
  if ((type === 'http' || type === 'sse') && !serverConfig.url) {
    sendError(res, 'url is required for HTTP/SSE servers', 400)
    return
  }

  const mcpConfigPath = join(
    homedir(),
    '.moldable',
    'shared',
    'config',
    'mcp.json',
  )

  try {
    addMcpServer(
      name,
      { ...serverConfig, type } as Parameters<typeof addMcpServer>[1],
      mcpConfigPath,
    )
    console.log(`✅ Added MCP server: ${name}`)
    sendJson(res, { success: true, name })
  } catch (error) {
    console.error('❌ Error adding MCP server:', error)
    sendError(
      res,
      error instanceof Error ? error.message : 'Failed to add server',
    )
  }
}

// Handle removing an MCP server
async function handleRemoveMcpServer(
  name: string,
  res: ServerResponse,
): Promise<void> {
  const mcpConfigPath = join(
    homedir(),
    '.moldable',
    'shared',
    'config',
    'mcp.json',
  )

  try {
    removeMcpServer(name, mcpConfigPath)
    console.log(`🗑️  Removed MCP server: ${name}`)
    sendJson(res, { success: true, name })
  } catch (error) {
    console.error('❌ Error removing MCP server:', error)
    sendError(
      res,
      error instanceof Error ? error.message : 'Failed to remove server',
    )
  }
}

// Handle updating an MCP server config
async function handleUpdateMcpServer(
  name: string,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const body = (await parseBody(req)) as {
    config?: {
      type?: 'stdio' | 'http' | 'sse'
      command?: string
      args?: string[]
      env?: Record<string, string>
      url?: string
      headers?: Record<string, string>
      disabled?: boolean
    }
  }
  const { config: newConfig } = body

  if (!newConfig) {
    sendError(res, 'config is required', 400)
    return
  }

  const mcpConfigPath = join(
    homedir(),
    '.moldable',
    'shared',
    'config',
    'mcp.json',
  )

  try {
    // Validate required fields based on type
    const type = newConfig.type || (newConfig.command ? 'stdio' : 'http')
    if (type === 'stdio' && !newConfig.command) {
      sendError(res, 'command is required for stdio servers', 400)
      return
    }
    if ((type === 'http' || type === 'sse') && !newConfig.url) {
      sendError(res, 'url is required for HTTP/SSE servers', 400)
      return
    }

    addMcpServer(
      name,
      { ...newConfig, type } as Parameters<typeof addMcpServer>[1],
      mcpConfigPath,
    )
    console.log(`✏️  Updated MCP server: ${name}`)
    sendJson(res, { success: true, name })
  } catch (error) {
    console.error('❌ Error updating MCP server:', error)
    sendError(
      res,
      error instanceof Error ? error.message : 'Failed to update server',
    )
  }
}

// Handle toggling an MCP server enabled/disabled
async function handleToggleMcpServer(
  name: string,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const body = (await parseBody(req)) as { enabled?: boolean }
  const { enabled } = body

  if (typeof enabled !== 'boolean') {
    sendError(res, 'enabled (boolean) is required', 400)
    return
  }

  const mcpConfigPath = join(
    homedir(),
    '.moldable',
    'shared',
    'config',
    'mcp.json',
  )

  try {
    // Get current config
    const currentConfig = getMcpServer(name, mcpConfigPath)
    if (!currentConfig) {
      sendError(res, `Server "${name}" not found`, 404)
      return
    }

    // Update with disabled flag
    const updatedConfig = {
      ...currentConfig,
      disabled: !enabled,
    }

    addMcpServer(name, updatedConfig, mcpConfigPath)
    console.log(
      `🔀 Toggled MCP server "${name}": ${enabled ? 'enabled' : 'disabled'}`,
    )
    sendJson(res, { success: true, name, enabled })
  } catch (error) {
    console.error('❌ Error toggling MCP server:', error)
    sendError(
      res,
      error instanceof Error ? error.message : 'Failed to toggle server',
    )
  }
}

// Handle installing an MCPB bundle
async function handleInstallBundle(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const body = (await parseBody(req)) as {
    bundlePath?: string
    userConfig?: Record<string, string | number | boolean | string[]>
  }
  const { bundlePath, userConfig } = body

  if (!bundlePath) {
    sendError(res, 'bundlePath is required', 400)
    return
  }

  try {
    // Read file directly from filesystem
    const { readFileSync } = await import('fs')
    const buffer = readFileSync(bundlePath)
    const bytes = new Uint8Array(buffer)
    console.log(`📦 Installing bundle from: ${bundlePath}`)

    // Extract ZIP
    const unzipped = unzipSync(bytes)

    // Parse manifest
    const manifestFile = unzipped['manifest.json']
    if (!manifestFile) {
      sendError(res, 'manifest.json not found in bundle', 400)
      return
    }

    const manifestJson = strFromU8(manifestFile)
    const manifest = parseManifest(JSON.parse(manifestJson))

    // Create install directory
    const installDir = join(getMcpbInstallDir(), manifest.name)
    if (existsSync(installDir)) {
      rmSync(installDir, { recursive: true })
    }
    mkdirSync(installDir, { recursive: true })

    // Extract all files to install directory
    for (const [path, data] of Object.entries(unzipped)) {
      const fullPath = join(installDir, path)
      const dir = dirname(fullPath)
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true })
      }
      writeFileSync(fullPath, data)
    }

    // Make binaries executable on Unix
    if (manifest.server.type === 'binary' && process.platform !== 'win32') {
      const { chmodSync } = await import('fs')
      const entryPath = join(installDir, manifest.server.entry_point)
      if (existsSync(entryPath)) {
        chmodSync(entryPath, 0o755)
      }
    }

    // Install npm dependencies for node bundles
    const packageJsonPath = join(installDir, 'package.json')
    if (manifest.server.type === 'node' && existsSync(packageJsonPath)) {
      console.log(`📦 Installing npm dependencies for ${manifest.name}...`)
      const { execSync } = await import('child_process')
      const { resolveExecutablePath, getAugmentedPath } = await import(
        '@moldable-ai/mcp'
      )
      try {
        const npmPath = resolveExecutablePath('npm')
        execSync(`"${npmPath}" install --omit=dev`, {
          cwd: installDir,
          stdio: 'inherit',
          timeout: 120000,
          env: {
            ...process.env,
            PATH: getAugmentedPath(),
          },
        })
        console.log(`✅ Dependencies installed for ${manifest.name}`)
      } catch (npmError) {
        console.error(`⚠️ Failed to install npm dependencies:`, npmError)
        // Continue anyway - some bundles might not need deps
      }
    }

    // Install to MCP config
    const mcpConfigPath = join(
      homedir(),
      '.moldable',
      'shared',
      'config',
      'mcp.json',
    )
    const result = installBundleFromExtracted(
      installDir,
      userConfig || {},
      mcpConfigPath,
    )

    console.log(`📦 Installed MCPB bundle: ${manifest.name}`)
    sendJson(res, {
      success: true,
      name: result.name,
      installPath: installDir,
    })
  } catch (error) {
    console.error('❌ Error installing bundle:', error)
    sendError(
      res,
      error instanceof Error ? error.message : 'Failed to install bundle',
    )
  }
}

// Create HTTP server
const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${HOST}:${PORT}`)

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders)
    res.end()
    return
  }

  // Route requests
  if (url.pathname === '/api/chat' && req.method === 'POST') {
    await handleChat(req, res)
  } else if (url.pathname === '/health' && req.method === 'GET') {
    handleHealth(res)
  } else if (url.pathname === '/api/mcp/servers' && req.method === 'GET') {
    handleMcpServers(res)
  } else if (url.pathname === '/api/mcp/servers' && req.method === 'POST') {
    await handleAddMcpServer(req, res)
  } else if (
    url.pathname.startsWith('/api/mcp/servers/') &&
    url.pathname.endsWith('/toggle') &&
    req.method === 'POST'
  ) {
    // Extract server name from /api/mcp/servers/:name/toggle
    const pathParts = url.pathname.split('/')
    const name = decodeURIComponent(pathParts[pathParts.length - 2] || '')
    await handleToggleMcpServer(name, req, res)
  } else if (
    url.pathname.startsWith('/api/mcp/servers/') &&
    req.method === 'PUT'
  ) {
    const name = decodeURIComponent(url.pathname.split('/').pop() || '')
    await handleUpdateMcpServer(name, req, res)
  } else if (
    url.pathname.startsWith('/api/mcp/servers/') &&
    req.method === 'DELETE'
  ) {
    const name = decodeURIComponent(url.pathname.split('/').pop() || '')
    await handleRemoveMcpServer(name, res)
  } else if (url.pathname === '/api/mcp/reload' && req.method === 'POST') {
    await handleMcpReload(res)
  } else if (
    url.pathname === '/api/mcp/install-bundle' &&
    req.method === 'POST'
  ) {
    await handleInstallBundle(req, res)
  } else {
    sendError(res, 'Not found', 404)
  }
})

// Start server
server.listen(Number(PORT), HOST, async () => {
  console.log(`🤖 Moldable AI server running at http://${HOST}:${PORT}`)
  console.log(`   MOLDABLE_HOME: ${MOLDABLE_HOME}`)
  console.log(
    `   Development workspace: ${WORKSPACE_ROOT || '(not configured)'}`,
  )
  console.log(
    `   Anthropic API key: ${process.env.ANTHROPIC_API_KEY ? '✓' : '✗'}`,
  )
  console.log(`   OpenAI API key: ${process.env.OPENAI_API_KEY ? '✓' : '✗'}`)
  console.log(
    `   OpenRouter API key: ${process.env.OPENROUTER_API_KEY ? '✓' : '✗'}`,
  )

  // Initialize MCP connections after server starts
  await initMcpConnections()
})

// Handle shutdown gracefully for both SIGINT (Ctrl+C) and SIGTERM (kill)
const shutdown = async () => {
  console.log('\n🛑 Shutting down AI server...')

  // Disconnect MCP servers
  console.log('   Disconnecting MCP servers...')
  await mcpManager.disconnectAll()

  server.close(() => {
    console.log('✅ AI server stopped')
    process.exit(0)
  })
  // Force exit after 5 seconds if graceful shutdown fails
  setTimeout(() => {
    console.log('⚠️ Forcing exit...')
    process.exit(0)
  }, 5000)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
