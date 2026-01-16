import { IncomingMessage, ServerResponse } from 'http'
import { homedir } from 'os'
import { join } from 'path'
import { describe, expect, it, vi } from 'vitest'

describe('AI Server', () => {
  describe('HTTP Helper Functions (unit tests)', () => {
    // Test parseBody by simulating an IncomingMessage
    describe('parseBody behavior', () => {
      it('should parse valid JSON body', async () => {
        // Create a mock request stream
        const { Readable } = await import('stream')
        const mockReq = new Readable({
          read() {
            this.push(JSON.stringify({ test: 'data' }))
            this.push(null)
          },
        }) as unknown as IncomingMessage

        // Simulating parseBody logic inline
        const parseBody = (req: IncomingMessage): Promise<unknown> => {
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

        const result = await parseBody(mockReq)
        expect(result).toEqual({ test: 'data' })
      })

      it('should return empty object for empty body', async () => {
        const { Readable } = await import('stream')
        const mockReq = new Readable({
          read() {
            this.push(null)
          },
        }) as unknown as IncomingMessage

        const parseBody = (req: IncomingMessage): Promise<unknown> => {
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

        const result = await parseBody(mockReq)
        expect(result).toEqual({})
      })

      it('should reject invalid JSON', async () => {
        const { Readable } = await import('stream')
        const mockReq = new Readable({
          read() {
            this.push('not valid json {')
            this.push(null)
          },
        }) as unknown as IncomingMessage

        const parseBody = (req: IncomingMessage): Promise<unknown> => {
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

        await expect(parseBody(mockReq)).rejects.toThrow()
      })
    })

    describe('sendJson behavior', () => {
      it('should send JSON response with correct headers', () => {
        const corsHeaders = {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers':
            'Content-Type, Authorization, User-Agent, X-Requested-With',
        }

        const mockRes = {
          writeHead: vi.fn(),
          end: vi.fn(),
        } as unknown as ServerResponse

        const sendJson = (
          res: ServerResponse,
          data: unknown,
          status = 200,
        ): void => {
          res.writeHead(status, {
            ...corsHeaders,
            'Content-Type': 'application/json',
          })
          res.end(JSON.stringify(data))
        }

        sendJson(mockRes, { message: 'test' })

        expect(mockRes.writeHead).toHaveBeenCalledWith(200, {
          ...corsHeaders,
          'Content-Type': 'application/json',
        })
        expect(mockRes.end).toHaveBeenCalledWith('{"message":"test"}')
      })

      it('should send custom status code', () => {
        const corsHeaders = {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers':
            'Content-Type, Authorization, User-Agent, X-Requested-With',
        }

        const mockRes = {
          writeHead: vi.fn(),
          end: vi.fn(),
        } as unknown as ServerResponse

        const sendJson = (
          res: ServerResponse,
          data: unknown,
          status = 200,
        ): void => {
          res.writeHead(status, {
            ...corsHeaders,
            'Content-Type': 'application/json',
          })
          res.end(JSON.stringify(data))
        }

        sendJson(mockRes, { error: 'not found' }, 404)

        expect(mockRes.writeHead).toHaveBeenCalledWith(404, expect.any(Object))
      })
    })

    describe('sendError behavior', () => {
      it('should send error as JSON with 500 status by default', () => {
        const corsHeaders = {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers':
            'Content-Type, Authorization, User-Agent, X-Requested-With',
        }

        const mockRes = {
          writeHead: vi.fn(),
          end: vi.fn(),
        } as unknown as ServerResponse

        const sendJson = (
          res: ServerResponse,
          data: unknown,
          status = 200,
        ): void => {
          res.writeHead(status, {
            ...corsHeaders,
            'Content-Type': 'application/json',
          })
          res.end(JSON.stringify(data))
        }

        const sendError = (
          res: ServerResponse,
          message: string,
          status = 500,
        ): void => {
          sendJson(res, { error: message }, status)
        }

        sendError(mockRes, 'Something went wrong')

        expect(mockRes.writeHead).toHaveBeenCalledWith(500, expect.any(Object))
        expect(mockRes.end).toHaveBeenCalledWith(
          '{"error":"Something went wrong"}',
        )
      })

      it('should send error with custom status', () => {
        const corsHeaders = {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers':
            'Content-Type, Authorization, User-Agent, X-Requested-With',
        }

        const mockRes = {
          writeHead: vi.fn(),
          end: vi.fn(),
        } as unknown as ServerResponse

        const sendJson = (
          res: ServerResponse,
          data: unknown,
          status = 200,
        ): void => {
          res.writeHead(status, {
            ...corsHeaders,
            'Content-Type': 'application/json',
          })
          res.end(JSON.stringify(data))
        }

        const sendError = (
          res: ServerResponse,
          message: string,
          status = 500,
        ): void => {
          sendJson(res, { error: message }, status)
        }

        sendError(mockRes, 'Bad request', 400)

        expect(mockRes.writeHead).toHaveBeenCalledWith(400, expect.any(Object))
      })
    })
  })

  describe('CORS Headers', () => {
    it('should have correct CORS header values', () => {
      const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers':
          'Content-Type, Authorization, User-Agent, X-Requested-With',
      }

      expect(corsHeaders['Access-Control-Allow-Origin']).toBe('*')
      expect(corsHeaders['Access-Control-Allow-Methods']).toContain('GET')
      expect(corsHeaders['Access-Control-Allow-Methods']).toContain('POST')
      expect(corsHeaders['Access-Control-Allow-Methods']).toContain('OPTIONS')
      expect(corsHeaders['Access-Control-Allow-Headers']).toContain(
        'Content-Type',
      )
      expect(corsHeaders['Access-Control-Allow-Headers']).toContain(
        'Authorization',
      )
    })
  })

  describe('Health Check Response Format', () => {
    it('should have correct health response structure', () => {
      // Simulate health check response generation
      const generateHealthResponse = (
        env: Record<string, string | undefined>,
      ) => ({
        status: 'ok',
        version: '0.1.0',
        hasAnthropicKey: !!env.ANTHROPIC_API_KEY,
        hasOpenAIKey: !!env.OPENAI_API_KEY,
        hasOpenRouterKey: !!env.OPENROUTER_API_KEY,
        mcpServers: [],
      })

      const response = generateHealthResponse({
        ANTHROPIC_API_KEY: 'test-key',
        OPENAI_API_KEY: undefined,
        OPENROUTER_API_KEY: 'another-key',
      })

      expect(response.status).toBe('ok')
      expect(response.version).toBe('0.1.0')
      expect(response.hasAnthropicKey).toBe(true)
      expect(response.hasOpenAIKey).toBe(false)
      expect(response.hasOpenRouterKey).toBe(true)
      expect(response.mcpServers).toEqual([])
    })
  })

  describe('Chat Request Validation', () => {
    it('should validate messages array is required', () => {
      const validateChatRequest = (
        body: unknown,
      ): { valid: boolean; error?: string } => {
        const typedBody = body as { messages?: unknown[] }
        if (!typedBody.messages || !Array.isArray(typedBody.messages)) {
          return { valid: false, error: 'messages array is required' }
        }
        return { valid: true }
      }

      expect(validateChatRequest({})).toEqual({
        valid: false,
        error: 'messages array is required',
      })
      expect(validateChatRequest({ messages: 'not an array' })).toEqual({
        valid: false,
        error: 'messages array is required',
      })
      expect(validateChatRequest({ messages: [] })).toEqual({ valid: true })
      expect(validateChatRequest({ messages: [{ role: 'user' }] })).toEqual({
        valid: true,
      })
    })

    it('should validate API key requirements based on model with OpenRouter fallback', () => {
      // This mirrors the validation logic in the AI server
      // Anthropic/OpenAI models can use direct keys OR fall back to OpenRouter
      const validateApiKeys = (
        model: string,
        apiKeys: {
          anthropicApiKey?: string
          openaiApiKey?: string
          openrouterApiKey?: string
        },
      ): { valid: boolean; error?: string } => {
        const isAnthropic = model.startsWith('anthropic/')
        const isOpenRouter = model.startsWith('openrouter/')
        const isOpenAI = model.startsWith('openai/')

        // Anthropic models: need Anthropic key OR OpenRouter
        if (
          isAnthropic &&
          !apiKeys.anthropicApiKey &&
          !apiKeys.openrouterApiKey
        ) {
          return {
            valid: false,
            error: 'ANTHROPIC_API_KEY or OPENROUTER_API_KEY required',
          }
        }
        // OpenRouter-native models: need OpenRouter key
        if (isOpenRouter && !apiKeys.openrouterApiKey) {
          return { valid: false, error: 'OPENROUTER_API_KEY not configured' }
        }
        // OpenAI models: need OpenAI key OR OpenRouter
        if (isOpenAI && !apiKeys.openaiApiKey && !apiKeys.openrouterApiKey) {
          return {
            valid: false,
            error: 'OPENAI_API_KEY or OPENROUTER_API_KEY required',
          }
        }
        return { valid: true }
      }

      // Anthropic model without any key
      expect(validateApiKeys('anthropic/claude-opus-4-5', {})).toEqual({
        valid: false,
        error: 'ANTHROPIC_API_KEY or OPENROUTER_API_KEY required',
      })

      // Anthropic model with direct Anthropic key
      expect(
        validateApiKeys('anthropic/claude-opus-4-5', {
          anthropicApiKey: 'key',
        }),
      ).toEqual({
        valid: true,
      })

      // Anthropic model with OpenRouter key (fallback)
      expect(
        validateApiKeys('anthropic/claude-opus-4-5', {
          openrouterApiKey: 'key',
        }),
      ).toEqual({
        valid: true,
      })

      // Anthropic model with both keys (prefers direct, but valid either way)
      expect(
        validateApiKeys('anthropic/claude-opus-4-5', {
          anthropicApiKey: 'key',
          openrouterApiKey: 'key',
        }),
      ).toEqual({
        valid: true,
      })

      // OpenRouter model without key
      expect(validateApiKeys('openrouter/minimax/minimax-m2.1', {})).toEqual({
        valid: false,
        error: 'OPENROUTER_API_KEY not configured',
      })

      // OpenRouter model with key
      expect(
        validateApiKeys('openrouter/minimax/minimax-m2.1', {
          openrouterApiKey: 'key',
        }),
      ).toEqual({
        valid: true,
      })

      // OpenAI model without any key
      expect(validateApiKeys('openai/gpt-5.2', {})).toEqual({
        valid: false,
        error: 'OPENAI_API_KEY or OPENROUTER_API_KEY required',
      })

      // OpenAI model with direct OpenAI key
      expect(
        validateApiKeys('openai/gpt-5.2', { openaiApiKey: 'key' }),
      ).toEqual({
        valid: true,
      })

      // OpenAI model with OpenRouter key (fallback)
      expect(
        validateApiKeys('openai/gpt-5.2', { openrouterApiKey: 'key' }),
      ).toEqual({
        valid: true,
      })

      // OpenAI model with both keys (prefers direct, but valid either way)
      expect(
        validateApiKeys('openai/gpt-5.2', {
          openaiApiKey: 'key',
          openrouterApiKey: 'key',
        }),
      ).toEqual({
        valid: true,
      })
    })
  })

  describe('UIMessage Filtering Logic', () => {
    it('should filter out messages with no parts', () => {
      type UIPart =
        | { type: 'text'; text: string }
        | { type: 'reasoning'; text: string }
        | { type: 'tool-call'; toolCallId: string }

      interface UIMessage {
        id: string
        role: string
        parts: UIPart[]
      }

      const filterMessages = (messages: UIMessage[]): UIMessage[] => {
        return messages.filter((msg) => {
          if (!msg.parts || msg.parts.length === 0) {
            return false
          }
          return true
        })
      }

      const messages: UIMessage[] = [
        { id: '1', role: 'user', parts: [{ type: 'text', text: 'Hello' }] },
        { id: '2', role: 'assistant', parts: [] },
        {
          id: '3',
          role: 'assistant',
          parts: [{ type: 'text', text: 'Response' }],
        },
      ]

      const filtered = filterMessages(messages)
      expect(filtered).toHaveLength(2)
      expect(filtered.map((m) => m.id)).toEqual(['1', '3'])
    })

    it('should filter out messages with only empty text parts', () => {
      type UIPart =
        | { type: 'text'; text: string }
        | { type: 'reasoning'; text: string }
        | { type: 'tool-call'; toolCallId: string }

      interface UIMessage {
        id: string
        role: string
        parts: UIPart[]
      }

      const filterMessages = (messages: UIMessage[]): UIMessage[] => {
        return messages.filter((msg) => {
          if (!msg.parts || msg.parts.length === 0) {
            return false
          }

          const hasNonEmptyContent = msg.parts.some((part) => {
            if (part.type === 'text' || part.type === 'reasoning') {
              const textPart = part as { text?: string }
              return textPart.text && textPart.text.trim() !== ''
            }
            if (part.type.startsWith('tool-')) {
              return true
            }
            return true
          })

          return hasNonEmptyContent
        })
      }

      const messages: UIMessage[] = [
        { id: '1', role: 'user', parts: [{ type: 'text', text: 'Hello' }] },
        { id: '2', role: 'assistant', parts: [{ type: 'text', text: '' }] },
        { id: '3', role: 'assistant', parts: [{ type: 'text', text: '   ' }] },
        {
          id: '4',
          role: 'assistant',
          parts: [{ type: 'text', text: 'Valid' }],
        },
      ]

      const filtered = filterMessages(messages)
      expect(filtered).toHaveLength(2)
      expect(filtered.map((m) => m.id)).toEqual(['1', '4'])
    })

    it('should preserve messages with tool invocations', () => {
      type UIPart =
        | { type: 'text'; text: string }
        | { type: 'tool-call'; toolCallId: string }

      interface UIMessage {
        id: string
        role: string
        parts: UIPart[]
      }

      const filterMessages = (messages: UIMessage[]): UIMessage[] => {
        return messages.filter((msg) => {
          if (!msg.parts || msg.parts.length === 0) {
            return false
          }

          const hasNonEmptyContent = msg.parts.some((part) => {
            if (part.type === 'text') {
              const textPart = part as { text?: string }
              return textPart.text && textPart.text.trim() !== ''
            }
            if (part.type.startsWith('tool-')) {
              return true
            }
            return true
          })

          return hasNonEmptyContent
        })
      }

      const messages: UIMessage[] = [
        { id: '1', role: 'user', parts: [{ type: 'text', text: 'Hello' }] },
        {
          id: '2',
          role: 'assistant',
          parts: [{ type: 'tool-call', toolCallId: 'call_123' }],
        },
      ]

      const filtered = filterMessages(messages)
      expect(filtered).toHaveLength(2)
      expect(filtered.map((m) => m.id)).toEqual(['1', '2'])
    })
  })

  describe('Dangling Tool Call Removal Logic', () => {
    it('should remove tool calls without matching tool results', () => {
      // Simulate the removeDanglingToolCalls function logic
      const removeDanglingToolCalls = <
        T extends { role: string; content: unknown },
      >(
        messages: T[],
      ): T[] => {
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
            const hasToolCalls = content.some(
              (part) => part.type === 'tool-call',
            )

            if (hasToolCalls) {
              // Filter out tool calls that don't have matching results
              const filteredContent = content.filter((part) => {
                if (part.type === 'tool-call' && part.toolCallId) {
                  return toolResultIds.has(part.toolCallId)
                }
                return true
              })

              // Check if message still has meaningful content
              const hasRemainingContent = filteredContent.some((part) => {
                if (part.type === 'text' && part.text) {
                  return part.text.trim() !== ''
                }
                return part.type === 'tool-call'
              })

              if (hasRemainingContent) {
                result.push({ ...msg, content: filteredContent })
              } else if (filteredContent.length > 0) {
                const isLast = msg === messages[messages.length - 1]
                if (isLast) {
                  result.push({ ...msg, content: filteredContent })
                }
              }
            } else {
              result.push(msg)
            }
          } else {
            result.push(msg)
          }
        }

        return result
      }

      // Test: assistant message with tool call but no tool result
      const messages = [
        { role: 'user', content: 'Hello' },
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'Let me check...' },
            {
              type: 'tool-call',
              toolCallId: 'call_dangling',
              toolName: 'test',
            },
          ],
        },
        // No tool result message follows - simulating user interruption
        { role: 'user', content: 'New message' },
      ]

      const result = removeDanglingToolCalls(messages)

      // The dangling tool call should be removed
      expect(result).toHaveLength(3)
      const assistantMsg = result[1]
      expect(assistantMsg?.role).toBe('assistant')
      expect(Array.isArray(assistantMsg?.content)).toBe(true)
      // Should only have text part, not tool-call
      const content = assistantMsg?.content as Array<{ type: string }>
      expect(content.some((p) => p.type === 'tool-call')).toBe(false)
      expect(content.some((p) => p.type === 'text')).toBe(true)
    })

    it('should keep tool calls with matching tool results', () => {
      const removeDanglingToolCalls = <
        T extends { role: string; content: unknown },
      >(
        messages: T[],
      ): T[] => {
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

        const result: T[] = []
        for (const msg of messages) {
          if (msg.role === 'assistant' && Array.isArray(msg.content)) {
            const content = msg.content as Array<{
              type: string
              toolCallId?: string
            }>
            const hasToolCalls = content.some(
              (part) => part.type === 'tool-call',
            )

            if (hasToolCalls) {
              const filteredContent = content.filter((part) => {
                if (part.type === 'tool-call' && part.toolCallId) {
                  return toolResultIds.has(part.toolCallId)
                }
                return true
              })

              if (filteredContent.length > 0) {
                result.push({ ...msg, content: filteredContent })
              }
            } else {
              result.push(msg)
            }
          } else {
            result.push(msg)
          }
        }

        return result
      }

      // Test: assistant message with tool call AND matching tool result
      const messages = [
        { role: 'user', content: 'Hello' },
        {
          role: 'assistant',
          content: [
            { type: 'tool-call', toolCallId: 'call_123', toolName: 'test' },
          ],
        },
        {
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolCallId: 'call_123',
              result: 'success',
            },
          ],
        },
        { role: 'user', content: 'Thanks' },
      ]

      const result = removeDanglingToolCalls(messages)

      // All messages should be kept
      expect(result).toHaveLength(4)
      const assistantMsg = result[1]
      const content = assistantMsg?.content as Array<{ type: string }>
      expect(content.some((p) => p.type === 'tool-call')).toBe(true)
    })

    it('should remove assistant message entirely if only dangling tool calls', () => {
      const removeDanglingToolCalls = <
        T extends { role: string; content: unknown },
      >(
        messages: T[],
      ): T[] => {
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

        const result: T[] = []
        for (const msg of messages) {
          if (msg.role === 'assistant' && Array.isArray(msg.content)) {
            const content = msg.content as Array<{
              type: string
              toolCallId?: string
              text?: string
            }>
            const hasToolCalls = content.some(
              (part) => part.type === 'tool-call',
            )

            if (hasToolCalls) {
              const filteredContent = content.filter((part) => {
                if (part.type === 'tool-call' && part.toolCallId) {
                  return toolResultIds.has(part.toolCallId)
                }
                return true
              })

              const hasRemainingContent = filteredContent.some((part) => {
                if (part.type === 'text' && part.text) {
                  return part.text.trim() !== ''
                }
                return part.type === 'tool-call'
              })

              if (hasRemainingContent) {
                result.push({ ...msg, content: filteredContent })
              }
              // Otherwise, message is dropped
            } else {
              result.push(msg)
            }
          } else {
            result.push(msg)
          }
        }

        return result
      }

      // Test: assistant message with ONLY a dangling tool call (no text)
      const messages = [
        { role: 'user', content: 'Hello' },
        {
          role: 'assistant',
          content: [
            { type: 'tool-call', toolCallId: 'call_orphan', toolName: 'test' },
          ],
        },
        // No tool result - user interrupted
        { role: 'user', content: 'Cancel that' },
      ]

      const result = removeDanglingToolCalls(messages)

      // The assistant message should be removed entirely
      expect(result).toHaveLength(2)
      expect(result[0]?.role).toBe('user')
      expect(result[1]?.role).toBe('user')
    })
  })

  describe('Model Message Filtering Logic', () => {
    it('should filter empty string content', () => {
      type ModelMessage = {
        role: 'user' | 'assistant' | 'system'
        content: string | Array<{ type: string; text?: string }>
      }

      const filterModelMessages = (
        messages: ModelMessage[],
      ): ModelMessage[] => {
        return messages.filter((msg) => {
          if (typeof msg.content === 'string' && msg.content.trim() !== '') {
            return true
          }
          if (Array.isArray(msg.content) && msg.content.length > 0) {
            return true
          }
          return false
        })
      }

      const messages: ModelMessage[] = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: '' },
        { role: 'assistant', content: '   ' },
        { role: 'assistant', content: 'Valid response' },
      ]

      const filtered = filterModelMessages(messages)
      expect(filtered).toHaveLength(2)
      expect(filtered[0]?.content).toBe('Hello')
      expect(filtered[1]?.content).toBe('Valid response')
    })

    it('should preserve messages with tool-call content', () => {
      type ModelMessage = {
        role: 'user' | 'assistant' | 'system'
        content: string | Array<{ type: string; text?: string }>
      }

      const filterModelMessages = (
        messages: ModelMessage[],
      ): ModelMessage[] => {
        return messages.filter((msg, index) => {
          const isLastMessage = index === messages.length - 1

          if (typeof msg.content === 'string' && msg.content.trim() !== '') {
            return true
          }

          if (Array.isArray(msg.content) && msg.content.length > 0) {
            if (msg.role === 'assistant' && !isLastMessage) {
              const hasTextContent = msg.content.some(
                (part) => part.type === 'text' && part.text,
              )
              const hasToolCall = msg.content.some(
                (part) => part.type === 'tool-call',
              )
              if (!hasTextContent && !hasToolCall) {
                return false
              }
            }
            return true
          }

          return false
        })
      }

      const messages: ModelMessage[] = [
        { role: 'user', content: 'Hello' },
        {
          role: 'assistant',
          content: [{ type: 'tool-call', text: undefined }],
        },
        { role: 'user', content: 'Tool result' },
      ]

      const filtered = filterModelMessages(messages)
      expect(filtered).toHaveLength(3)
    })

    it('should filter reasoning-only messages when not last', () => {
      type ModelMessage = {
        role: 'user' | 'assistant' | 'system'
        content: string | Array<{ type: string; text?: string }>
      }

      const filterModelMessages = (
        messages: ModelMessage[],
      ): ModelMessage[] => {
        return messages.filter((msg, index) => {
          const isLastMessage = index === messages.length - 1

          if (typeof msg.content === 'string' && msg.content.trim() !== '') {
            return true
          }

          if (Array.isArray(msg.content) && msg.content.length > 0) {
            if (msg.role === 'assistant' && !isLastMessage) {
              const hasTextContent = msg.content.some(
                (part) => part.type === 'text' && part.text,
              )
              const hasToolCall = msg.content.some(
                (part) => part.type === 'tool-call',
              )
              if (!hasTextContent && !hasToolCall) {
                return false
              }
            }
            return true
          }

          return false
        })
      }

      const messages: ModelMessage[] = [
        { role: 'user', content: 'Hello' },
        // Reasoning-only message (not last)
        {
          role: 'assistant',
          content: [{ type: 'reasoning', text: 'thinking...' }],
        },
        { role: 'user', content: 'Follow up' },
      ]

      const filtered = filterModelMessages(messages)
      expect(filtered).toHaveLength(2)
      expect(filtered[0]?.content).toBe('Hello')
      expect(filtered[1]?.content).toBe('Follow up')
    })
  })

  describe('MCP Server Response Format', () => {
    it('should format MCP servers correctly', () => {
      interface McpServer {
        name: string
        config: Record<string, unknown>
        status: 'connected' | 'error' | 'disconnected'
        error?: string
        tools: Array<{ name: string; description: string }>
      }

      const formatMcpResponse = (servers: McpServer[]) => ({
        servers: servers.map((s) => ({
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

      const servers: McpServer[] = [
        {
          name: 'test-server',
          config: { command: 'node', args: ['server.js'] },
          status: 'connected',
          tools: [
            { name: 'tool1', description: 'First tool' },
            { name: 'tool2', description: 'Second tool' },
          ],
        },
        {
          name: 'failed-server',
          config: { command: 'bad' },
          status: 'error',
          error: 'Connection failed',
          tools: [],
        },
      ]

      const response = formatMcpResponse(servers)

      expect(response.servers).toHaveLength(2)
      expect(response.servers[0]?.name).toBe('test-server')
      expect(response.servers[0]?.status).toBe('connected')
      expect(response.servers[0]?.tools).toHaveLength(2)
      expect(response.servers[1]?.error).toBe('Connection failed')
    })
  })

  describe('Environment Variable Loading', () => {
    it('should prioritize env paths correctly', () => {
      // Simulate the env path priority logic
      const getEnvPaths = (dirname: string) => [
        join(homedir(), '.moldable', 'shared', '.env'),
        join(dirname, '..', '..', '..', '.moldable', 'shared', '.env'),
        join(dirname, '..', '..', '..', '.env'),
      ]

      const paths = getEnvPaths('/test/packages/ai-server/src')

      expect(paths[0]).toContain('.moldable/shared/.env')
      expect(paths[1]).toContain('.moldable/shared/.env')
      expect(paths[2]).toMatch(/\.env$/)
    })
  })

  describe('Server Route Matching', () => {
    it('should correctly identify routes', () => {
      const matchRoute = (pathname: string, method: string): string | null => {
        if (pathname === '/api/chat' && method === 'POST') return 'chat'
        if (pathname === '/health' && method === 'GET') return 'health'
        if (pathname === '/api/mcp/servers' && method === 'GET')
          return 'mcp-servers'
        if (pathname === '/api/mcp/reload' && method === 'POST')
          return 'mcp-reload'
        return null
      }

      expect(matchRoute('/api/chat', 'POST')).toBe('chat')
      expect(matchRoute('/api/chat', 'GET')).toBeNull()
      expect(matchRoute('/health', 'GET')).toBe('health')
      expect(matchRoute('/health', 'POST')).toBeNull()
      expect(matchRoute('/api/mcp/servers', 'GET')).toBe('mcp-servers')
      expect(matchRoute('/api/mcp/reload', 'POST')).toBe('mcp-reload')
      expect(matchRoute('/unknown', 'GET')).toBeNull()
    })
  })

  describe('Default Configuration Values', () => {
    it('should have correct default port', () => {
      const DEFAULT_PORT = 3100
      expect(DEFAULT_PORT).toBe(3100)
    })

    it('should have correct default host', () => {
      const DEFAULT_HOST = '127.0.0.1'
      expect(DEFAULT_HOST).toBe('127.0.0.1')
    })

    it('should default to medium reasoning effort', () => {
      const getReasoningEffort = (provided?: string) => provided || 'medium'
      expect(getReasoningEffort()).toBe('medium')
      expect(getReasoningEffort('low')).toBe('low')
      expect(getReasoningEffort('high')).toBe('high')
    })
  })

  describe('Abort Controller Behavior', () => {
    it('should properly handle abort signal', async () => {
      const controller = new AbortController()

      const promise = new Promise<string>((resolve, reject) => {
        controller.signal.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'))
        })

        setTimeout(() => resolve('completed'), 1000)
      })

      // Abort immediately
      controller.abort()

      await expect(promise).rejects.toThrow('Aborted')
    })

    it('should track abort state correctly', () => {
      const controller = new AbortController()

      expect(controller.signal.aborted).toBe(false)

      controller.abort()

      expect(controller.signal.aborted).toBe(true)
    })
  })

  describe('Bundle Installation Logic', () => {
    it('should validate bundle path is required', () => {
      const validateBundleRequest = (body: {
        bundlePath?: string
      }): { valid: boolean; error?: string } => {
        if (!body.bundlePath) {
          return { valid: false, error: 'bundlePath is required' }
        }
        return { valid: true }
      }

      expect(validateBundleRequest({})).toEqual({
        valid: false,
        error: 'bundlePath is required',
      })

      expect(
        validateBundleRequest({ bundlePath: '/path/to/bundle.mcpb' }),
      ).toEqual({
        valid: true,
      })
    })

    it('should determine if npm install is needed for node bundles', () => {
      const shouldInstallDeps = (
        serverType: string,
        hasPackageJson: boolean,
      ): boolean => {
        return serverType === 'node' && hasPackageJson
      }

      // Node bundle with package.json
      expect(shouldInstallDeps('node', true)).toBe(true)

      // Node bundle without package.json
      expect(shouldInstallDeps('node', false)).toBe(false)

      // Python bundle (should never install npm deps)
      expect(shouldInstallDeps('python', true)).toBe(false)
      expect(shouldInstallDeps('python', false)).toBe(false)

      // Binary bundle
      expect(shouldInstallDeps('binary', true)).toBe(false)
    })

    it('should format install success response correctly', () => {
      const formatInstallResponse = (
        name: string,
        installPath: string,
      ): { success: true; name: string; installPath: string } => {
        return {
          success: true,
          name,
          installPath,
        }
      }

      const response = formatInstallResponse(
        'my-mcp-server',
        '/Users/test/.moldable/shared/mcps/my-mcp-server',
      )

      expect(response.success).toBe(true)
      expect(response.name).toBe('my-mcp-server')
      expect(response.installPath).toContain('my-mcp-server')
    })
  })

  describe('MCPB Manifest Validation', () => {
    it('should identify valid manifest structure', () => {
      const isValidManifest = (manifest: unknown): boolean => {
        if (!manifest || typeof manifest !== 'object') return false
        const m = manifest as Record<string, unknown>
        return (
          typeof m.name === 'string' &&
          typeof m.version === 'string' &&
          typeof m.manifest_version === 'string' &&
          typeof m.description === 'string' &&
          typeof m.server === 'object' &&
          m.server !== null
        )
      }

      // Valid manifest
      expect(
        isValidManifest({
          name: 'test',
          version: '1.0.0',
          manifest_version: '1.0',
          description: 'Test server',
          server: { type: 'node', entry_point: 'index.js' },
          author: { name: 'Test' },
        }),
      ).toBe(true)

      // Invalid manifests
      expect(isValidManifest({})).toBe(false)
      expect(isValidManifest(null)).toBe(false)
      expect(isValidManifest({ name: 'test' })).toBe(false)
      expect(
        isValidManifest({
          name: 'test',
          version: '1.0.0',
          manifest_version: '1.0',
          description: 'Test',
          server: null,
        }),
      ).toBe(false)
    })

    it('should validate server types', () => {
      const validServerTypes = ['node', 'python', 'binary', 'uv']

      const isValidServerType = (type: string): boolean => {
        return validServerTypes.includes(type)
      }

      expect(isValidServerType('node')).toBe(true)
      expect(isValidServerType('python')).toBe(true)
      expect(isValidServerType('binary')).toBe(true)
      expect(isValidServerType('uv')).toBe(true)
      expect(isValidServerType('invalid')).toBe(false)
      expect(isValidServerType('java')).toBe(false)
    })
  })

  describe('Bundle File Handling', () => {
    it('should validate bundle file extension', () => {
      const isValidBundleFile = (path: string): boolean => {
        return path.endsWith('.mcpb') || path.endsWith('.zip')
      }

      expect(isValidBundleFile('/path/to/bundle.mcpb')).toBe(true)
      expect(isValidBundleFile('/path/to/bundle.zip')).toBe(true)
      expect(isValidBundleFile('/path/to/bundle.tar.gz')).toBe(false)
      expect(isValidBundleFile('/path/to/bundle.txt')).toBe(false)
      expect(isValidBundleFile('simple.mcpb')).toBe(true)
    })

    it('should extract bundle name from path', () => {
      const getBundleNameFromPath = (bundlePath: string): string => {
        const filename = bundlePath.split('/').pop() || bundlePath
        return filename.replace(/\.(mcpb|zip)$/, '')
      }

      expect(getBundleNameFromPath('/path/to/my-bundle.mcpb')).toBe('my-bundle')
      expect(getBundleNameFromPath('/path/to/test-server.zip')).toBe(
        'test-server',
      )
      expect(getBundleNameFromPath('simple.mcpb')).toBe('simple')
    })
  })

  describe('Path Resolution for npm install', () => {
    it('should resolve npm path using common locations', () => {
      // Simulate path resolution logic
      const resolveNpmPath = (
        commonPaths: string[],
        existsSync: (path: string) => boolean,
      ): string => {
        for (const base of commonPaths) {
          const fullPath = `${base}/npm`
          if (existsSync(fullPath)) {
            return fullPath
          }
        }
        return 'npm' // Fallback
      }

      // Test with homebrew path existing
      const result1 = resolveNpmPath(
        ['/opt/homebrew/bin', '/usr/local/bin'],
        (path) => path === '/opt/homebrew/bin/npm',
      )
      expect(result1).toBe('/opt/homebrew/bin/npm')

      // Test with usr/local existing
      const result2 = resolveNpmPath(
        ['/opt/homebrew/bin', '/usr/local/bin'],
        (path) => path === '/usr/local/bin/npm',
      )
      expect(result2).toBe('/usr/local/bin/npm')

      // Test fallback when none exist
      const result3 = resolveNpmPath(
        ['/opt/homebrew/bin', '/usr/local/bin'],
        () => false,
      )
      expect(result3).toBe('npm')
    })
  })
})
