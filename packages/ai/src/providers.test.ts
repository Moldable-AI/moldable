import { getProviderConfig } from './providers'
import { LLMProvider } from './types'
import { describe, expect, it } from 'vitest'

describe('getProviderConfig', () => {
  describe('Anthropic provider', () => {
    it('requires Anthropic or OpenRouter API key', () => {
      expect(() =>
        getProviderConfig(LLMProvider.Anthropic_Claude_Opus_4_5, {}),
      ).toThrow('Anthropic API key or OpenRouter API key is required')
    })

    it('returns correct config with API key', () => {
      const config = getProviderConfig(LLMProvider.Anthropic_Claude_Opus_4_5, {
        anthropicApiKey: 'test-key',
      })

      expect(config.model).toBeDefined()
      expect(config.isReasoning).toBe(true)
      // Anthropic doesn't allow temperature when thinking is enabled
      expect(config.temperature).toBeUndefined()
      expect(config.providerOptions).toBeDefined()
      expect(config.providerOptions?.anthropic).toBeDefined()
    })

    it('maps reasoning effort to budget tokens', () => {
      const lowConfig = getProviderConfig(
        LLMProvider.Anthropic_Claude_Opus_4_5,
        { anthropicApiKey: 'test-key' },
        'low',
      )
      const highConfig = getProviderConfig(
        LLMProvider.Anthropic_Claude_Opus_4_5,
        { anthropicApiKey: 'test-key' },
        'high',
      )
      const xhighConfig = getProviderConfig(
        LLMProvider.Anthropic_Claude_Opus_4_5,
        { anthropicApiKey: 'test-key' },
        'xhigh',
      )

      // Each level should have different budget tokens
      const lowBudget = (
        lowConfig.providerOptions?.anthropic as {
          thinking?: { budgetTokens?: number }
        }
      )?.thinking?.budgetTokens
      const highBudget = (
        highConfig.providerOptions?.anthropic as {
          thinking?: { budgetTokens?: number }
        }
      )?.thinking?.budgetTokens
      const xhighBudget = (
        xhighConfig.providerOptions?.anthropic as {
          thinking?: { budgetTokens?: number }
        }
      )?.thinking?.budgetTokens

      expect(lowBudget).toBe(5000)
      expect(highBudget).toBe(20000)
      expect(xhighBudget).toBe(50000)
    })

    it('defaults to medium reasoning effort', () => {
      const config = getProviderConfig(LLMProvider.Anthropic_Claude_Opus_4_5, {
        anthropicApiKey: 'test-key',
      })

      const budgetTokens = (
        config.providerOptions?.anthropic as {
          thinking?: { budgetTokens?: number }
        }
      )?.thinking?.budgetTokens
      expect(budgetTokens).toBe(10000) // medium = 10000
    })

    it('falls back to OpenRouter when only OpenRouter key is available', () => {
      const config = getProviderConfig(LLMProvider.Anthropic_Claude_Opus_4_5, {
        openrouterApiKey: 'test-key',
      })

      expect(config.model).toBeDefined()
      expect(config.isReasoning).toBe(true)
      expect(config.temperature).toBe(1.0)
    })

    it('prefers direct Anthropic API over OpenRouter when both keys available', () => {
      const config = getProviderConfig(LLMProvider.Anthropic_Claude_Opus_4_5, {
        anthropicApiKey: 'test-anthropic-key',
        openrouterApiKey: 'test-openrouter-key',
      })

      // When using direct Anthropic, temperature is undefined for reasoning models
      expect(config.temperature).toBeUndefined()
      expect(config.providerOptions?.anthropic).toBeDefined()
    })
  })

  describe('OpenAI provider', () => {
    it('requires OpenAI or OpenRouter API key', () => {
      expect(() => getProviderConfig(LLMProvider.OpenAI_GPT_5_2, {})).toThrow(
        'OpenAI API key or OpenRouter API key is required',
      )
    })

    it('returns correct config with API key', () => {
      const config = getProviderConfig(LLMProvider.OpenAI_GPT_5_2, {
        openaiApiKey: 'test-key',
      })

      expect(config.model).toBeDefined()
      expect(config.isReasoning).toBe(true)
      expect(config.temperature).toBe(1.0)
      expect(config.providerOptions?.openai).toBeDefined()
    })

    it('includes reasoning effort in provider options', () => {
      const config = getProviderConfig(
        LLMProvider.OpenAI_GPT_5_2,
        { openaiApiKey: 'test-key' },
        'high',
      )

      expect(
        (config.providerOptions?.openai as { reasoningEffort?: string })
          ?.reasoningEffort,
      ).toBe('high')
    })

    it('falls back to OpenRouter when only OpenRouter key is available', () => {
      const config = getProviderConfig(LLMProvider.OpenAI_GPT_5_2, {
        openrouterApiKey: 'test-key',
      })

      expect(config.model).toBeDefined()
      expect(config.isReasoning).toBe(true)
      expect(config.temperature).toBe(1.0)
    })

    it('prefers direct OpenAI API over OpenRouter when both keys available', () => {
      const config = getProviderConfig(LLMProvider.OpenAI_GPT_5_2, {
        openaiApiKey: 'test-openai-key',
        openrouterApiKey: 'test-openrouter-key',
      })

      // When using direct OpenAI, it has openai provider options
      expect(config.providerOptions?.openai).toBeDefined()
    })
  })

  describe('OpenRouter provider', () => {
    it('requires OpenRouter API key', () => {
      expect(() =>
        getProviderConfig(LLMProvider.OpenRouter_MiniMax_M2_1, {}),
      ).toThrow('OpenRouter API key is required')
    })

    it('returns correct config with API key', () => {
      const config = getProviderConfig(LLMProvider.OpenRouter_MiniMax_M2_1, {
        openrouterApiKey: 'test-key',
      })

      expect(config.model).toBeDefined()
      expect(config.isReasoning).toBe(true)
      expect(config.temperature).toBe(1.0)
    })

    it('includes reasoning option for reasoning models', () => {
      const config = getProviderConfig(LLMProvider.OpenRouter_MiniMax_M2_1, {
        openrouterApiKey: 'test-key',
      })

      expect(
        (config.providerOptions as { reasoning?: { enabled?: boolean } })
          ?.reasoning?.enabled,
      ).toBe(true)
    })
  })

  describe('unknown provider', () => {
    it('throws for unknown model', () => {
      expect(() =>
        getProviderConfig('unknown/model' as LLMProvider, {
          openaiApiKey: 'test-key',
        }),
      ).toThrow('Unknown model: unknown/model')
    })
  })
})
