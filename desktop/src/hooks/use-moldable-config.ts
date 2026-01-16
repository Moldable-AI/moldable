import { useCallback, useEffect, useState } from 'react'
import { isTauri } from '../lib/app-manager'
import { invoke } from '@tauri-apps/api/core'

/**
 * Hook to read/write preferences from Moldable's workspace config.json
 *
 * This persists preferences to the workspace config (~/.moldable/workspaces/{id}/config.json)
 * instead of localStorage, ensuring they survive webview resets and are inspectable/portable.
 *
 * @param key - The preference key
 * @param defaultValue - Default value if preference is not set
 * @returns [value, setValue, isLoading] tuple
 */
export function useMoldableConfig<T>(
  key: string,
  defaultValue: T,
): [T, (value: T) => void, boolean] {
  const [value, setValueState] = useState<T>(defaultValue)
  const [isLoading, setIsLoading] = useState(true)

  // Load preference on mount
  useEffect(() => {
    if (!isTauri()) {
      setIsLoading(false)
      return
    }

    invoke<unknown | null>('get_preference', { key })
      .then((result) => {
        if (result !== null && result !== undefined) {
          setValueState(result as T)
        }
      })
      .catch((error) => {
        console.error(`Failed to load preference "${key}":`, error)
      })
      .finally(() => {
        setIsLoading(false)
      })
  }, [key])

  // Set preference
  const setValue = useCallback(
    (newValue: T) => {
      setValueState(newValue)

      if (!isTauri()) {
        return
      }

      invoke('set_preference', { key, value: newValue }).catch((error) => {
        console.error(`Failed to save preference "${key}":`, error)
      })
    },
    [key],
  )

  return [value, setValue, isLoading]
}

/**
 * Hook to load all preferences at once
 *
 * @returns [preferences, isLoading] tuple
 */
export function useAllPreferences(): [Record<string, unknown>, boolean] {
  const [preferences, setPreferences] = useState<Record<string, unknown>>({})
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    if (!isTauri()) {
      setIsLoading(false)
      return
    }

    invoke<Record<string, unknown>>('get_all_preferences')
      .then((result) => {
        setPreferences(result ?? {})
      })
      .catch((error) => {
        console.error('Failed to load preferences:', error)
      })
      .finally(() => {
        setIsLoading(false)
      })
  }, [])

  return [preferences, isLoading]
}

/**
 * Preference keys used by Moldable desktop
 */
export const PREFERENCE_KEYS = {
  /** Selected AI model ID */
  SELECTED_MODEL: 'selectedModel',
  /** Reasoning effort settings per vendor */
  REASONING_EFFORT: 'reasoningEffort',
  /** Theme preference: 'light' | 'dark' | 'system' */
  THEME: 'theme',
  /** Whether onboarding has been completed for this workspace */
  ONBOARDING_COMPLETED: 'onboardingCompleted',
} as const
