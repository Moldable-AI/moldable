import { useCallback, useEffect, useState } from 'react'
import { relaunch } from '@tauri-apps/plugin-process'
import { type Update, check } from '@tauri-apps/plugin-updater'

interface UpdateState {
  available: boolean
  update: Update | null
  checking: boolean
  downloading: boolean
  progress: number
  error: string | null
}

interface UseAppUpdateOptions {
  /** Check interval in milliseconds. Default: 1 hour */
  checkInterval?: number
  /** Whether to check on mount. Default: true */
  checkOnMount?: boolean
}

/**
 * Hook to check for and install app updates using Tauri's updater plugin.
 *
 * This checks GitHub releases for new versions and handles downloading,
 * verifying signatures, and installing updates.
 */
export function useAppUpdate(options: UseAppUpdateOptions = {}) {
  const { checkInterval = 1000 * 60 * 60, checkOnMount = true } = options

  const [state, setState] = useState<UpdateState>({
    available: false,
    update: null,
    checking: false,
    downloading: false,
    progress: 0,
    error: null,
  })

  const checkForUpdate = useCallback(async () => {
    console.log('[update] Checking for updates...')
    setState((s) => ({ ...s, checking: true, error: null }))
    try {
      const update = await check()
      console.log('[update] Check result:', {
        available: update?.available,
        version: update?.version,
        currentVersion: update?.currentVersion,
      })
      setState((s) => ({
        ...s,
        checking: false,
        available: update?.available ?? false,
        update: update ?? null,
      }))
      return update
    } catch (error) {
      // Don't show error for expected failures (no internet, etc.)
      const errorMessage =
        error instanceof Error ? error.message : 'Update check failed'

      console.warn('[update] Check failed:', error)

      // Silently ignore network errors - user might be offline
      if (
        errorMessage.includes('network') ||
        errorMessage.includes('fetch') ||
        errorMessage.includes('connect')
      ) {
        console.debug('[update] Network unavailable, skipping update check')
        setState((s) => ({ ...s, checking: false }))
        return null
      }
      setState((s) => ({
        ...s,
        checking: false,
        error: errorMessage,
      }))
      return null
    }
  }, [])

  const downloadAndInstall = useCallback(async () => {
    if (!state.update) return

    setState((s) => ({ ...s, downloading: true, progress: 0, error: null }))
    try {
      let downloaded = 0
      let contentLength = 0

      await state.update.downloadAndInstall((event) => {
        switch (event.event) {
          case 'Started':
            contentLength = event.data.contentLength ?? 0
            console.log('[update] Download started, size:', contentLength)
            break
          case 'Progress':
            downloaded += event.data.chunkLength
            if (contentLength > 0) {
              const progress = Math.round((downloaded / contentLength) * 100)
              setState((s) => ({ ...s, progress }))
            }
            break
          case 'Finished':
            console.log('[update] Download finished')
            setState((s) => ({ ...s, progress: 100 }))
            break
        }
      })

      // Relaunch the app to apply the update
      console.log('[update] Relaunching to apply update...')
      await relaunch()
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Update failed'
      console.error('[update] Install failed:', errorMessage)
      setState((s) => ({
        ...s,
        downloading: false,
        error: errorMessage,
      }))
    }
  }, [state.update])

  const dismiss = useCallback(() => {
    setState((s) => ({ ...s, available: false, update: null }))
  }, [])

  // Check on mount (after a short delay to not block startup)
  useEffect(() => {
    if (checkOnMount) {
      const timer = setTimeout(() => {
        checkForUpdate()
      }, 3000) // Wait 3 seconds after mount

      return () => clearTimeout(timer)
    }
  }, [checkOnMount, checkForUpdate])

  // Periodic checks
  useEffect(() => {
    if (checkInterval <= 0) return
    const interval = setInterval(checkForUpdate, checkInterval)
    return () => clearInterval(interval)
  }, [checkInterval, checkForUpdate])

  return {
    ...state,
    checkForUpdate,
    downloadAndInstall,
    dismiss,
  }
}
