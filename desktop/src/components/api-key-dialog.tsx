import { Check, ExternalLink, Loader2 } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Input,
} from '@moldable-ai/ui'
import { invoke } from '@tauri-apps/api/core'
import { open as openUrl } from '@tauri-apps/plugin-shell'

type KeyProvider = 'openrouter' | 'anthropic' | 'openai' | null

interface ApiKeyDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void | Promise<void>
}

/** Detect the provider from an API key based on its prefix */
function detectKeyProvider(key: string): KeyProvider {
  const trimmed = key.trim()
  if (trimmed.startsWith('sk-or-')) return 'openrouter'
  if (trimmed.startsWith('sk-ant-')) return 'anthropic'
  if (trimmed.startsWith('sk-proj-') || trimmed.startsWith('sk-'))
    return 'openai'
  return null
}

export function ApiKeyDialog({
  open,
  onOpenChange,
  onSuccess,
}: ApiKeyDialogProps) {
  const [apiKey, setApiKey] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const detectedProvider = useMemo(() => detectKeyProvider(apiKey), [apiKey])
  const isValidKey = apiKey.trim().length > 20 && detectedProvider !== null

  const handleSave = useCallback(async () => {
    if (!isValidKey) return

    setIsSaving(true)
    setError(null)

    try {
      await invoke<string>('save_api_key', { apiKey: apiKey.trim() })
      setSuccess(true)
      setIsSaving(false)

      // Brief delay to show success and ensure file is fully written,
      // then trigger health refresh and close dialog
      setTimeout(async () => {
        try {
          // Wait for health check to complete before closing
          // This ensures the AI server picks up the new key
          await onSuccess()
        } catch (err) {
          console.error('Error refreshing health after API key save:', err)
        } finally {
          // Always close and reset state
          onOpenChange(false)
          setApiKey('')
          setSuccess(false)
        }
      }, 800)
    } catch (err) {
      console.error('Failed to save API key:', err)
      setError(err instanceof Error ? err.message : String(err))
      setIsSaving(false)
    }
  }, [apiKey, isValidKey, onSuccess, onOpenChange])

  const handleOpenUrl = useCallback(async (url: string) => {
    await openUrl(url)
  }, [])

  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen) {
      // Reset state on close
      setApiKey('')
      setError(null)
      setSuccess(false)
    }
    onOpenChange(isOpen)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add API key</DialogTitle>
          <DialogDescription>
            Add an API key to use AI features in Moldable.
          </DialogDescription>
        </DialogHeader>

        {!success ? (
          <div className="flex flex-col gap-4 pt-2">
            <Input
              type="password"
              placeholder="OpenRouter, Anthropic, or OpenAI API key"
              value={apiKey}
              onChange={(e) => {
                setApiKey(e.target.value)
                setError(null)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && isValidKey) {
                  handleSave()
                }
              }}
              className="font-mono text-sm"
              autoFocus
            />

            {error && <p className="text-xs text-red-500">{error}</p>}

            <Button
              className="w-full cursor-pointer"
              onClick={handleSave}
              disabled={!isValidKey || isSaving}
            >
              {isSaving ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  Saving...
                </>
              ) : (
                'Save'
              )}
            </Button>

            {/* Get a key links */}
            <div className="text-muted-foreground space-y-1.5 text-xs">
              <p className="text-center">Get an API key from:</p>
              <div className="flex flex-wrap justify-center gap-x-3 gap-y-1">
                <button
                  onClick={() => handleOpenUrl('https://openrouter.ai/keys')}
                  className="hover:text-foreground inline-flex cursor-pointer items-center gap-1 transition-colors"
                >
                  <ExternalLink className="size-3" />
                  OpenRouter
                </button>
                <button
                  onClick={() =>
                    handleOpenUrl('https://console.anthropic.com/')
                  }
                  className="hover:text-foreground inline-flex cursor-pointer items-center gap-1 transition-colors"
                >
                  <ExternalLink className="size-3" />
                  Anthropic
                </button>
                <button
                  onClick={() =>
                    handleOpenUrl('https://platform.openai.com/api-keys')
                  }
                  className="hover:text-foreground inline-flex cursor-pointer items-center gap-1 transition-colors"
                >
                  <ExternalLink className="size-3" />
                  OpenAI
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3 py-4">
            <div className="flex size-12 items-center justify-center rounded-full bg-green-500/10 text-green-500">
              <Check className="size-6" />
            </div>
            <p className="text-muted-foreground text-sm">API key saved!</p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
