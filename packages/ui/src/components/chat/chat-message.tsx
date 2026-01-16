'use client'

import { Brain, ChevronDown, Loader2 } from 'lucide-react'
import { type ReactNode, memo, useEffect, useMemo, useState } from 'react'
import { cn } from '../../lib/utils'
import { Markdown } from '../markdown'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '../ui/collapsible'
import {
  ThinkingTimeline,
  type ThinkingTimelineItem,
  ThinkingTimelineMarker,
} from './thinking-timeline'
import { getToolHandler } from './tool-handlers'
import { AnimatePresence, motion } from 'framer-motion'

const DEFAULT_ACTIONS_LABEL = 'Thinking'

// OpenRouter sends these for encrypted reasoning msgs
const stripRedacted = (text: string) => text.replace(/\[REDACTED\]/g, '').trim()

// Simplified message type for Moldable (subset of AI SDK UIMessage)
export type ChatMessagePart =
  | { type: 'text'; text: string }
  | { type: 'reasoning'; text: string }
  | {
      type: 'tool-invocation'
      toolCallId?: string
      toolName: string
      state: string
      args?: unknown
      output?: unknown
    }

export type ChatMessage = {
  id: string
  role: 'user' | 'assistant' | 'system'
  content?: string
  parts?: ChatMessagePart[]
}

type MessageProps = {
  message: ChatMessage
  isLast?: boolean
  isStreaming?: boolean
}

type ThinkingGroup = {
  id: string
  timeline: ThinkingTimelineItem[]
  title: string
  isStreaming: boolean
}

type ContentItem =
  | { type: 'thinking'; id: string; thinkingGroup: ThinkingGroup }
  | { type: 'text'; id: string; textPart: { type: 'text'; text: string } }
  | { type: 'inline-tool'; id: string; content: ReactNode }

function PureMessage({
  message,
  isLast = false,
  isStreaming = false,
}: MessageProps) {
  // Track open state for each thinking group independently
  const [thinkingGroupStates, setThinkingGroupStates] = useState<
    Map<string, { isOpen: boolean; userOpened: boolean }>
  >(new Map())

  // Process parts chronologically, grouping only reasoning into thinking groups
  // Inline tools (file ops, commands) are rendered directly
  const { contentItems, hasFinalAssistantText } = useMemo(() => {
    const items: ContentItem[] = []
    const state = {
      currentThinkingGroup: null as ThinkingGroup | null,
      thinkingGroupIndex: 0,
      hasText: false,
    }

    // Helper to close current thinking group
    const closeThinkingGroup = () => {
      if (state.currentThinkingGroup) {
        items.push({
          type: 'thinking' as const,
          id: state.currentThinkingGroup.id,
          thinkingGroup: state.currentThinkingGroup,
        })
        state.currentThinkingGroup = null
      }
    }

    // Helper to ensure thinking group exists
    const ensureThinkingGroup = () => {
      if (!state.currentThinkingGroup) {
        state.thinkingGroupIndex++
        state.currentThinkingGroup = {
          id: `thinking-${message.id}-${state.thinkingGroupIndex}`,
          timeline: [],
          title: DEFAULT_ACTIONS_LABEL,
          isStreaming: false,
        }
      }
      return state.currentThinkingGroup
    }

    // If no parts, use content as text
    const parts = message.parts ?? []
    if (parts.length === 0 && message.content) {
      return {
        contentItems: [
          {
            type: 'text' as const,
            id: `message-${message.id}-content`,
            textPart: { type: 'text' as const, text: message.content },
          },
        ],
        hasFinalAssistantText: true,
      }
    }

    for (let index = 0; index < parts.length; index++) {
      const part = parts[index]
      const key = `message-${message.id}-part-${index}`

      // Handle tool calls
      if (part.type === 'tool-invocation') {
        const toolHandler = getToolHandler(part.toolName)

        // Check if this tool should be rendered inline
        if (toolHandler.inline) {
          // Close any open thinking group first
          closeThinkingGroup()

          // Render inline tool
          const isToolLoading =
            part.state === 'partial-call' ||
            part.state === 'call' ||
            part.state === 'pending'

          const toolContent = isToolLoading
            ? toolHandler.renderLoading?.(part.args) || (
                <div className="text-muted-foreground text-xs">
                  {toolHandler.loadingLabel}
                </div>
              )
            : toolHandler.renderOutput(part.output, part.toolCallId || key)

          items.push({
            type: 'inline-tool' as const,
            id: key,
            content: toolContent,
          })
          continue
        }

        // Non-inline tools go into thinking group
        const group = ensureThinkingGroup()

        // Show loading state for tools
        if (
          part.state === 'partial-call' ||
          part.state === 'call' ||
          part.state === 'pending'
        ) {
          const toolLabel = toolHandler.loadingLabel
          group.title = toolLabel
          group.isStreaming = true
          group.timeline.push({
            marker: ThinkingTimelineMarker.Loading,
            content: (
              <div
                key={`${part.toolCallId || key}-loading`}
                className="px-2 py-1"
              >
                <span className="text-muted-foreground font-mono text-xs">
                  {toolLabel}
                </span>
              </div>
            ),
          })
          continue
        }

        // Show tool output
        if (part.state === 'result' || part.state === 'output-available') {
          group.timeline.push({
            marker: toolHandler.marker ?? ThinkingTimelineMarker.Default,
            content: toolHandler.renderOutput(
              part.output,
              part.toolCallId || key,
            ),
          })
          continue
        }

        continue
      }

      if (part.type === 'reasoning') {
        const full = part.text ?? ''
        const cleaned = stripRedacted(full)
        if (cleaned.length === 0) {
          continue
        }

        const group = ensureThinkingGroup()

        // Extract title from markdown **title** or use first line
        const markdownTitleMatch = cleaned.match(/\*\*([^*]+)\*\*/)
        const candidateTitle = markdownTitleMatch?.[1]
        const trimmed = cleaned
        const firstLine = trimmed.split(/\n+/)[0]
        const extractedTitle =
          candidateTitle || firstLine?.slice(0, 50) || DEFAULT_ACTIONS_LABEL
        group.title = extractedTitle
        const body = candidateTitle
          ? trimmed.replace(/\*\*[^*]+\*\*\s*/, '')
          : trimmed

        group.timeline.push({
          marker: ThinkingTimelineMarker.Default,
          content: (
            <div key={key} className="whitespace-pre-wrap px-2 py-1">
              {body}
            </div>
          ),
        })
        continue
      }

      if (part.type === 'text') {
        // Close current thinking group before text
        closeThinkingGroup()

        state.hasText = true
        items.push({
          type: 'text' as const,
          id: key,
          textPart: part,
        })
      }
    }

    // Close any remaining thinking group
    closeThinkingGroup()

    return {
      contentItems: items,
      hasFinalAssistantText: state.hasText,
    }
  }, [message.id, message.parts, message.content])

  // Determine if last thinking group is streaming
  const lastThinkingGroup = contentItems
    .filter((item) => item.type === 'thinking')
    .map((item) => (item.type === 'thinking' ? item.thinkingGroup : null))
    .filter((g): g is ThinkingGroup => g !== null)
    .pop()

  // Check if we're still streaming overall and waiting for text
  const isStreamingOverall = isStreaming && isLast && !hasFinalAssistantText

  // For the last thinking group, also keep it open if we just finished streaming
  // but text hasn't appeared yet (grace period for AI to start responding)
  const shouldKeepLastGroupOpen =
    isLast && !hasFinalAssistantText && message.role === 'assistant'

  // Auto-open/close reasoning groups based on streaming state
  useEffect(() => {
    setThinkingGroupStates((prevStates) => {
      let hasChanges = false
      const nextStates = new Map(prevStates)

      contentItems.forEach((item) => {
        if (item.type === 'thinking' && item.thinkingGroup) {
          const groupId = item.thinkingGroup.id
          const group = item.thinkingGroup
          const isLastGroup = lastThinkingGroup?.id === groupId
          const currentState = nextStates.get(groupId)

          const shouldBeOpen =
            group.isStreaming ||
            (isLastGroup && isStreamingOverall) ||
            (isLastGroup && shouldKeepLastGroupOpen)

          if (currentState) {
            if (!currentState.userOpened) {
              if (shouldBeOpen && currentState.isOpen !== true) {
                nextStates.set(groupId, { ...currentState, isOpen: true })
                hasChanges = true
              } else if (!shouldBeOpen && currentState.isOpen !== false) {
                nextStates.set(groupId, { ...currentState, isOpen: false })
                hasChanges = true
              }
            }
          } else {
            nextStates.set(groupId, {
              isOpen: shouldBeOpen,
              userOpened: false,
            })
            hasChanges = true
          }
        }
      })

      return hasChanges ? nextStates : prevStates
    })
  }, [
    contentItems,
    isStreamingOverall,
    lastThinkingGroup,
    shouldKeepLastGroupOpen,
  ])

  return (
    <AnimatePresence>
      <motion.div
        data-testid={`message-${message.role}`}
        className="group/message w-full min-w-0 px-2"
        initial={{ y: 5, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        data-role={message.role}
      >
        <div
          className={cn(
            'flex w-full min-w-0 items-start gap-4',
            message.role === 'user' && 'justify-end',
          )}
        >
          <div
            className={cn(
              'mt-1 flex min-w-0 flex-col gap-2',
              message.role === 'user' ? 'max-w-[85%] items-end' : 'w-full',
            )}
          >
            {/* Render content items in chronological order */}
            {contentItems.map((item) => {
              if (
                item.type === 'thinking' &&
                item.thinkingGroup &&
                message.role === 'assistant'
              ) {
                const group = item.thinkingGroup
                const groupState = thinkingGroupStates.get(group.id)
                const isLastGroup = lastThinkingGroup?.id === group.id
                const isGroupStreaming =
                  group.isStreaming || (isLastGroup && isStreamingOverall)
                const shouldBeOpenByDefault = isGroupStreaming
                const isOpen = groupState?.isOpen ?? shouldBeOpenByDefault
                const titleForTrigger =
                  hasFinalAssistantText && isLastGroup && !isGroupStreaming
                    ? DEFAULT_ACTIONS_LABEL
                    : group.title || DEFAULT_ACTIONS_LABEL

                return (
                  <Collapsible
                    key={item.id}
                    open={isOpen}
                    onOpenChange={(open) => {
                      setThinkingGroupStates((prev) => {
                        const next = new Map(prev)
                        const current = next.get(group.id) ?? {
                          isOpen: false,
                          userOpened: false,
                        }
                        next.set(group.id, {
                          ...current,
                          isOpen: open,
                          userOpened: open ? true : current.userOpened,
                        })
                        return next
                      })
                    }}
                    className="mb-2 w-full"
                    data-ai-reasoning
                  >
                    <CollapsibleTrigger
                      className={cn(
                        'group flex max-w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-[11px] font-semibold uppercase tracking-wide transition-colors',
                        'text-muted-foreground hover:bg-accent hover:text-foreground min-w-0',
                      )}
                    >
                      <Brain
                        className={cn(
                          'size-3.5 shrink-0 opacity-80',
                          isGroupStreaming && 'animate-pulse',
                        )}
                      />
                      <span className="flex-1 truncate">{titleForTrigger}</span>
                      <ChevronDown
                        className={cn(
                          'size-3.5 shrink-0 transition-transform',
                          'group-data-[state=open]:rotate-180',
                        )}
                      />
                    </CollapsibleTrigger>
                    <CollapsibleContent className="text-muted-foreground min-w-0 overflow-hidden rounded-md px-[5px] py-2 font-mono text-xs leading-relaxed">
                      <ThinkingTimeline items={group.timeline} />
                    </CollapsibleContent>
                  </Collapsible>
                )
              }

              if (item.type === 'inline-tool') {
                return (
                  <div key={item.id} className="w-full min-w-0">
                    {item.content}
                  </div>
                )
              }

              if (item.type === 'text' && item.textPart) {
                return (
                  <div
                    key={item.id}
                    className={cn('flex flex-col gap-4', {
                      'bg-secondary text-secondary-foreground w-fit rounded-2xl px-4 py-2.5':
                        message.role === 'user',
                    })}
                  >
                    <Markdown
                      markdown={item.textPart.text}
                      proseSize="sm"
                      className={cn(
                        '[&_.prose]:leading-relaxed [&_.prose]:text-current',
                        '[&_.prose_pre]:bg-background/80 [&_.prose_code]:text-current',
                        '[&_.prose_p:last-child]:mb-0 [&_.prose_p]:mb-2',
                        message.role === 'user' &&
                          '[&_.prose_pre]:bg-secondary-foreground/20',
                      )}
                    />
                  </div>
                )
              }

              return null
            })}
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  )
}

export const Message = memo(PureMessage)

export function ThinkingMessage() {
  return (
    <motion.div
      data-testid="message-assistant-loading"
      className="group/message w-full px-2"
      initial={{ y: 5, opacity: 0 }}
      animate={{ y: 0, opacity: 1, transition: { delay: 0.5 } }}
      data-role="assistant"
    >
      <div className="text-muted-foreground flex flex-row items-center gap-2 px-2">
        <Loader2 className="size-4 shrink-0 animate-spin" />
        <span className="font-mono text-xs font-medium uppercase">
          Thinking...
        </span>
      </div>
    </motion.div>
  )
}
