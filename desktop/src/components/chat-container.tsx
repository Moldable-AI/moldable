import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  type ChatMessage,
  type ChatMessagePart,
  ChatPanel,
} from '@moldable-ai/ui'
import { useChatConversations } from '../hooks/use-chat-conversations'
import {
  type ActiveAppContext,
  type RegisteredAppInfo,
  getAvailableModels,
  getReasoningEffortOptions,
  useMoldableChat,
} from '../hooks/use-moldable-chat'
import type { AvailableKeys } from '../hooks/use-moldable-preferences'
import { VendorLogo } from './vendor-logo'

const WELCOME_MESSAGE = (
  <div className="space-y-2">
    <p className="font-medium">👋 Welcome to Moldable</p>
    <p>
      Describe any app and watch it come to life—running locally with full
      system access, completely private, infinitely moldable.
    </p>
  </div>
)

interface ChatContainerProps {
  isExpanded: boolean
  onExpandedChange: (expanded: boolean) => void
  /** Whether the chat is minimized (hidden below fold) */
  isMinimized: boolean
  onMinimizedChange: (minimized: boolean) => void
  /** Active workspace ID - conversations are scoped to workspace */
  workspaceId?: string
  /** All registered apps in Moldable */
  registeredApps?: RegisteredAppInfo[]
  /** Currently active app being viewed (if any) */
  activeApp?: ActiveAppContext | null
  /** Available API keys - used to auto-select appropriate model */
  availableKeys?: AvailableKeys
  /** Whether API keys are missing */
  missingApiKey?: boolean
  /** Callback to trigger API key setup */
  onAddApiKey?: () => void
  /** External input to populate (from apps via postMessage) */
  suggestedInput?: string
  /** Called when suggested input has been consumed */
  onSuggestedInputConsumed?: () => void
}

export function ChatContainer({
  isExpanded,
  onExpandedChange,
  isMinimized,
  onMinimizedChange,
  workspaceId,
  registeredApps,
  activeApp,
  availableKeys,
  missingApiKey,
  onAddApiKey,
  suggestedInput,
  onSuggestedInputConsumed,
}: ChatContainerProps) {
  const {
    messages,
    status,
    error,
    sendMessage,
    stop,
    setMessages,
    clearError,
    selectedModel,
    setSelectedModel,
    selectedReasoningEffort,
    setSelectedReasoningEffort,
  } = useMoldableChat({
    activeWorkspaceId: workspaceId,
    registeredApps,
    activeApp,
    availableKeys,
  })

  const {
    conversations,
    currentConversationId,
    saveConversation,
    loadConversation,
    deleteConversation,
    newConversation,
  } = useChatConversations(workspaceId)

  const [inputValue, setInputValue] = useState('')

  // Consume suggested input from external sources (e.g., apps via postMessage)
  useEffect(() => {
    if (suggestedInput) {
      setInputValue(suggestedInput)
      onSuggestedInputConsumed?.()
    }
  }, [suggestedInput, onSuggestedInputConsumed])

  // Track previous status to detect when streaming ends
  const prevStatusRef = useRef(status)

  // Save conversation when streaming finishes (success or error)
  useEffect(() => {
    const wasStreaming =
      prevStatusRef.current === 'streaming' ||
      prevStatusRef.current === 'submitted'
    const isNowDone = status === 'ready' || status === 'error'

    if (wasStreaming && isNowDone && messages.length > 0) {
      // Save the conversation (even on error, preserve what we have)
      saveConversation(messages, currentConversationId)
    }

    prevStatusRef.current = status
  }, [status, messages, saveConversation, currentConversationId])

  // Map available models to include vendor logo icons
  const models = useMemo(
    () =>
      getAvailableModels().map((m) => ({
        id: m.id,
        name: m.name,
        icon: <VendorLogo vendor={m.logoVendor ?? m.vendor} />,
      })),
    [],
  )

  // Get reasoning effort options for current model
  const reasoningEffortOptions = useMemo(
    () => getReasoningEffortOptions(selectedModel),
    [selectedModel],
  )

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setInputValue(e.target.value)
    },
    [],
  )

  const handleSubmit = useCallback(
    async (e?: React.FormEvent<HTMLFormElement>) => {
      e?.preventDefault()
      const text = inputValue.trim()
      if (!text) return

      setInputValue('')
      await sendMessage({
        role: 'user',
        parts: [{ type: 'text', text }],
      })
    },
    [inputValue, sendMessage],
  )

  const handleNewChat = useCallback(() => {
    setMessages([])
    clearError()
    newConversation()
  }, [setMessages, clearError, newConversation])

  const handleSelectConversation = useCallback(
    async (id: string) => {
      const conversation = await loadConversation(id)
      if (conversation) {
        setMessages(conversation.messages)
        clearError()
      }
    },
    [loadConversation, setMessages, clearError],
  )

  const handleDeleteConversation = useCallback(
    async (id: string) => {
      await deleteConversation(id)
      // If we deleted the current conversation, clear messages
      if (id === currentConversationId) {
        setMessages([])
        clearError()
      }
    },
    [deleteConversation, currentConversationId, setMessages, clearError],
  )

  // Convert AI SDK messages to our ChatMessage format
  const chatMessages: ChatMessage[] = messages.map((m) => {
    // Convert parts to our format
    const parts: ChatMessagePart[] = []
    for (const part of m.parts ?? []) {
      if (part.type === 'text') {
        parts.push({ type: 'text', text: part.text })
      } else if (part.type === 'reasoning') {
        parts.push({ type: 'reasoning', text: part.text })
      } else if (part.type === 'dynamic-tool') {
        // Dynamic tool - has toolName property
        const toolPart = part as {
          toolCallId?: string
          toolName?: string
          state?: string
          input?: unknown
          output?: unknown
        }
        parts.push({
          type: 'tool-invocation',
          toolCallId: toolPart.toolCallId,
          toolName: toolPart.toolName || 'unknown',
          state: toolPart.state || 'pending',
          args: toolPart.input,
          output: toolPart.output,
        })
      } else if (part.type.startsWith('tool-')) {
        // Static tool - type is "tool-{toolName}"
        const toolName = part.type.replace('tool-', '')
        const toolPart = part as {
          toolCallId?: string
          state?: string
          input?: unknown
          output?: unknown
        }
        parts.push({
          type: 'tool-invocation',
          toolCallId: toolPart.toolCallId,
          toolName: toolName,
          state: toolPart.state || 'pending',
          args: toolPart.input,
          output: toolPart.output,
        })
      }
    }

    // Extract text content for backward compatibility
    const textContent = parts
      .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
      .map((p) => p.text)
      .join('')

    return {
      id: m.id,
      role: m.role as 'user' | 'assistant',
      content: textContent,
      parts,
    }
  })

  // Map AI SDK status to our status
  const chatStatus =
    status === 'streaming' || status === 'submitted'
      ? status
      : status === 'error'
        ? 'error'
        : 'ready'

  // Map conversations to the UI format
  const conversationMetas = conversations.map((c) => ({
    id: c.id,
    title: c.title,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    messageCount: c.messageCount,
  }))

  // Generate contextual placeholder based on active app
  const placeholder = useMemo(() => {
    if (activeApp) {
      return 'What can I help with or tweak?'
    }
    return 'What should we build today?'
  }, [activeApp])

  return (
    <ChatPanel
      messages={chatMessages}
      status={chatStatus}
      error={error}
      input={inputValue}
      onInputChange={handleInputChange}
      onSubmit={handleSubmit}
      onStop={stop}
      onNewChat={handleNewChat}
      models={models}
      selectedModel={selectedModel}
      onModelChange={setSelectedModel}
      reasoningEffortOptions={reasoningEffortOptions}
      selectedReasoningEffort={selectedReasoningEffort}
      onReasoningEffortChange={setSelectedReasoningEffort}
      conversations={conversationMetas}
      currentConversationId={currentConversationId}
      onSelectConversation={handleSelectConversation}
      onDeleteConversation={handleDeleteConversation}
      placeholder={placeholder}
      welcomeMessage={WELCOME_MESSAGE}
      isExpanded={isExpanded}
      onExpandedChange={onExpandedChange}
      isMinimized={isMinimized}
      onMinimizedChange={onMinimizedChange}
      missingApiKey={missingApiKey}
      onAddApiKey={onAddApiKey}
    />
  )
}
