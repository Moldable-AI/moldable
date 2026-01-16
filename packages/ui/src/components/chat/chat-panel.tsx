'use client'

import { AlertCircle, MessageCircle, Minimize2, Plus } from 'lucide-react'
import {
  type ChangeEvent,
  type FormEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import { cn } from '../../lib/utils'
import { Button } from '../ui/button'
import { ScrollArea } from '../ui/scroll-area'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '../ui/tooltip'
import { ChatInput } from './chat-input'
import type { ChatMessage } from './chat-message'
import { Messages } from './chat-messages'
import {
  ConversationHistory,
  type ConversationMeta,
} from './conversation-history'
import { type ModelOption, ModelSelector } from './model-selector'
import {
  type ReasoningEffortOption,
  ReasoningEffortSelector,
} from './reasoning-effort-selector'
import { AnimatePresence, motion } from 'framer-motion'

type ChatStatus = 'ready' | 'submitted' | 'streaming' | 'error'

export interface ChatPanelProps {
  /** Chat messages */
  messages: ChatMessage[]
  /** Current chat status */
  status: ChatStatus
  /** Input value */
  input: string
  /** Handle input change */
  onInputChange: (e: ChangeEvent<HTMLTextAreaElement>) => void
  /** Handle form submit */
  onSubmit: (e?: FormEvent<HTMLFormElement>) => void
  /** Handle stop generation */
  onStop?: () => void
  /** Handle new chat */
  onNewChat?: () => void
  /** Available models */
  models: ModelOption[]
  /** Selected model ID */
  selectedModel: string
  /** Handle model change */
  onModelChange: (modelId: string) => void
  /** Available reasoning effort options (varies by model vendor) */
  reasoningEffortOptions?: ReasoningEffortOption[]
  /** Selected reasoning effort */
  selectedReasoningEffort?: string
  /** Handle reasoning effort change */
  onReasoningEffortChange?: (effort: string) => void
  /** Conversation history */
  conversations?: ConversationMeta[]
  /** Current conversation ID */
  currentConversationId?: string | null
  /** Handle conversation selection */
  onSelectConversation?: (id: string) => void
  /** Handle conversation deletion */
  onDeleteConversation?: (id: string) => void
  /** Placeholder text */
  placeholder?: string
  /** Welcome message when no messages exist */
  welcomeMessage?: ReactNode
  /** Whether the panel is expanded */
  isExpanded: boolean
  /** Toggle expanded state */
  onExpandedChange: (expanded: boolean) => void
  /** Whether the panel is minimized (hidden below fold with only flap visible) */
  isMinimized?: boolean
  /** Toggle minimized state */
  onMinimizedChange?: (minimized: boolean) => void
  /** Custom class name */
  className?: string
  /** Error from chat request */
  error?: Error | null
  /** Whether API keys are missing */
  missingApiKey?: boolean
  /** Callback to trigger API key setup */
  onAddApiKey?: () => void
}

/**
 * Floating chat panel with model selector
 */
export function ChatPanel({
  messages,
  status,
  input,
  onInputChange,
  onSubmit,
  onStop,
  onNewChat,
  models,
  selectedModel,
  onModelChange,
  reasoningEffortOptions,
  selectedReasoningEffort,
  onReasoningEffortChange,
  conversations,
  currentConversationId,
  onSelectConversation,
  onDeleteConversation,
  placeholder = 'Ask anything...',
  welcomeMessage,
  isExpanded,
  onExpandedChange,
  isMinimized = false,
  onMinimizedChange,
  className,
  error,
  missingApiKey,
  onAddApiKey,
}: ChatPanelProps) {
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const scrollAreaRef = useRef<HTMLDivElement>(null)
  const [isAtBottom, setIsAtBottom] = useState(true)

  const isResponding = status === 'streaming' || status === 'submitted'

  // Track scroll position to detect if user is at bottom
  useEffect(() => {
    const scrollArea = scrollAreaRef.current
    if (!scrollArea) return

    // Radix ScrollArea puts the viewport as first child element
    const viewport = scrollArea.querySelector(
      '[data-radix-scroll-area-viewport]',
    )
    if (!viewport) return

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = viewport
      // Consider "at bottom" if within 50px of the bottom
      const atBottom = scrollHeight - scrollTop - clientHeight < 50
      setIsAtBottom(atBottom)
    }

    viewport.addEventListener('scroll', handleScroll)
    return () => viewport.removeEventListener('scroll', handleScroll)
  }, [isExpanded])

  // Focus input when expanded
  useEffect(() => {
    if (isExpanded) {
      const timer = setTimeout(() => {
        inputRef.current?.focus()
      }, 200)
      return () => clearTimeout(timer)
    }
  }, [isExpanded])

  // Scroll to bottom on new messages only if user is already at bottom
  useEffect(() => {
    if (isExpanded && messagesEndRef.current && isAtBottom) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages, isExpanded, isAtBottom])

  const handleSubmit = useCallback(
    (e?: FormEvent<HTMLFormElement>) => {
      e?.preventDefault()
      if (!input.trim()) return

      // If streaming, stop the current response first
      if (isResponding && onStop) {
        onStop()
      }

      if (!isExpanded) {
        onExpandedChange(true)
      }
      // Reset to bottom when user sends a message
      setIsAtBottom(true)
      onSubmit(e)
    },
    [input, isResponding, isExpanded, onExpandedChange, onSubmit, onStop],
  )

  const handleNewChat = useCallback(() => {
    onNewChat?.()
    inputRef.current?.focus()
  }, [onNewChat])

  // Keyboard shortcut: Cmd+Shift+O for new chat
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'o' && e.metaKey && e.shiftKey) {
        e.preventDefault()
        // Only create new chat if not currently streaming and panel is expanded
        if (!isResponding && isExpanded) {
          handleNewChat()
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isResponding, isExpanded, handleNewChat])

  // Handle clicking the minimized flap
  const handleFlapClick = useCallback(() => {
    onMinimizedChange?.(false)
  }, [onMinimizedChange])

  // Handle minimize button - now goes to minimized state
  const handleMinimize = useCallback(() => {
    if (isExpanded) {
      onExpandedChange(false)
    }
    onMinimizedChange?.(true)
  }, [isExpanded, onExpandedChange, onMinimizedChange])

  return (
    <>
      {/* Backdrop when expanded */}
      <AnimatePresence>
        {isExpanded && !isMinimized && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-40 bg-black/20"
            onClick={() => onExpandedChange(false)}
          />
        )}
      </AnimatePresence>

      {/* Minimized flap - small tab peeking from bottom */}
      <AnimatePresence>
        {isMinimized && (
          <motion.div
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 20, opacity: 0 }}
            transition={{ type: 'tween', duration: 0.2, ease: 'easeOut' }}
            className="fixed bottom-0 left-[calc(50%+var(--sidebar-width,0px)/2)] z-50 -translate-x-1/2"
          >
            <button
              onClick={handleFlapClick}
              className={cn(
                'bg-background/95 hover:bg-background group flex cursor-pointer items-center gap-2 rounded-t-xl border border-b-0 px-4 py-2 shadow-lg backdrop-blur transition-colors',
                'text-muted-foreground hover:text-foreground',
              )}
            >
              <MessageCircle className="size-4" />
              <span className="text-sm font-medium">Chat</span>
              <span className="bg-muted text-muted-foreground group-hover:bg-primary/10 group-hover:text-primary rounded px-1.5 py-0.5 text-xs transition-colors">
                ⌘M
              </span>
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Chat panel */}
      <motion.div
        initial={false}
        animate={{
          width: isExpanded ? 'min(90vw, 640px)' : '400px',
          y: isMinimized ? 'calc(100% + 24px)' : 0,
          opacity: isMinimized ? 0 : 1,
        }}
        transition={{ type: 'tween', duration: 0.25, ease: 'easeOut' }}
        className={cn(
          'pointer-events-none fixed bottom-6 left-[calc(50%+var(--sidebar-width,0px)/2)] z-50 flex -translate-x-1/2 justify-center',
          isMinimized && 'pointer-events-none',
          className,
        )}
      >
        <div
          className={cn(
            'bg-background pointer-events-auto relative w-full border shadow-lg',
            'supports-[backdrop-filter]:bg-background/95 backdrop-blur',
            'rounded-4xl',
            isExpanded ? 'overflow-hidden' : 'overflow-visible',
          )}
        >
          {/* Radiating Glow when collapsed */}
          {!isExpanded && (
            <motion.div
              className="rounded-4xl pointer-events-none absolute inset-0 z-0"
              animate={{
                boxShadow: [
                  '0 0 0px 0px color-mix(in oklch, var(--primary) 0%, #ff8800 00%)',
                  '0 0 20px 0px color-mix(in oklch, var(--primary) 20%, #ff8800 30%)',
                  '0 0 30px 2px color-mix(in oklch, var(--primary) 0%, #ff8800 00%)',
                ],
              }}
              transition={{
                duration: 4,
                repeat: Infinity,
                repeatDelay: 5,
                ease: [0.4, 0, 0.2, 1],
              }}
            />
          )}

          {/* Expanded content */}
          <motion.div
            initial={false}
            animate={{
              height: isExpanded ? 'min(60vh, 480px)' : '0px',
              opacity: isExpanded ? 1 : 0,
            }}
            transition={{ type: 'tween', duration: 0.2, ease: 'easeOut' }}
            className="relative z-10 flex flex-col overflow-hidden"
            style={{ pointerEvents: isExpanded ? 'auto' : 'none' }}
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b px-4 py-2">
              <div className="flex items-center gap-1">
                <ModelSelector
                  models={models}
                  selectedModel={selectedModel}
                  onModelChange={onModelChange}
                  disabled={isResponding}
                />
                {reasoningEffortOptions &&
                  selectedReasoningEffort &&
                  onReasoningEffortChange && (
                    <ReasoningEffortSelector
                      options={reasoningEffortOptions}
                      selectedEffort={selectedReasoningEffort}
                      onEffortChange={onReasoningEffortChange}
                      disabled={isResponding}
                    />
                  )}
              </div>
              <div className="flex items-center gap-1">
                {conversations &&
                  conversations.length > 0 &&
                  onSelectConversation && (
                    <ConversationHistory
                      conversations={conversations}
                      currentConversationId={currentConversationId}
                      onSelect={onSelectConversation}
                      onDelete={onDeleteConversation}
                      disabled={isResponding}
                    />
                  )}
                <TooltipProvider>
                  {messages.length > 0 && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={handleNewChat}
                          disabled={isResponding}
                          className="text-muted-foreground hover:text-foreground"
                        >
                          <Plus className="size-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="bottom">
                        <p>New chat</p>
                      </TooltipContent>
                    </Tooltip>
                  )}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={handleMinimize}
                        className="text-muted-foreground hover:text-foreground"
                      >
                        <Minimize2 className="size-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">
                      <p>Minimize</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
            </div>

            {/* Messages area */}
            <ScrollArea ref={scrollAreaRef} className="min-w-0 flex-1 px-2">
              <div className="min-w-0 space-y-4 py-4">
                {messages.length === 0 && welcomeMessage && (
                  <div className="bg-muted/50 text-muted-foreground mx-2 rounded-2xl p-4 text-sm">
                    {welcomeMessage}
                  </div>
                )}
                <Messages messages={messages} status={status} />
                {/* Missing API key prompt */}
                {(missingApiKey ||
                  (error &&
                    error.message?.includes('API_KEY not configured'))) && (
                  <div className="border-primary/30 bg-primary/5 mx-2 flex flex-col items-center gap-3 rounded-lg border p-4 text-center">
                    <div className="bg-primary/10 flex size-10 items-center justify-center rounded-full">
                      <AlertCircle className="text-primary size-5" />
                    </div>
                    <div>
                      <p className="text-foreground font-medium">
                        API key required
                      </p>
                      <p className="text-muted-foreground mt-1 text-sm">
                        Add an API key to start chatting with AI
                      </p>
                    </div>
                    {onAddApiKey && (
                      <Button
                        onClick={onAddApiKey}
                        size="sm"
                        className="cursor-pointer"
                      >
                        Add API key
                      </Button>
                    )}
                  </div>
                )}
                {/* Error display - don't show for API key errors */}
                {error &&
                  status === 'error' &&
                  !error.message?.includes('API_KEY not configured') && (
                    <div className="border-destructive/30 bg-destructive/10 text-destructive mx-2 flex items-start gap-2 rounded-lg border p-3 text-sm">
                      <AlertCircle className="mt-0.5 size-4 shrink-0" />
                      <div className="min-w-0">
                        <p className="font-medium">Request failed</p>
                        <p className="text-destructive/80 mt-0.5 break-words">
                          {error.message || 'An unknown error occurred'}
                        </p>
                      </div>
                    </div>
                  )}
                <div ref={messagesEndRef} />
              </div>
            </ScrollArea>
          </motion.div>

          {/* Input area (always visible) */}
          <div
            className="relative z-10"
            onClick={() => {
              if (!isExpanded) {
                onExpandedChange(true)
              }
            }}
          >
            <ChatInput
              input={input}
              onInputChange={onInputChange}
              onSubmit={handleSubmit}
              isResponding={isResponding}
              placeholder={placeholder}
              inputRef={inputRef}
              onStop={onStop}
              compact={!isExpanded}
            />
          </div>
        </div>
      </motion.div>
    </>
  )
}
