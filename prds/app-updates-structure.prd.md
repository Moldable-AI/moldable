# App Updates & Distribution Structure

> **How Moldable distributes the desktop app, shared packages, and user-forkable apps with seamless updates.**

---

## Progress Tracking

| Phase       | Status     | Description                                                     |
| ----------- | ---------- | --------------------------------------------------------------- |
| **Phase 1** | ✅ Done    | Update Rust backend for shared apps + workspace data structure  |
| **Phase 2** | ✅ Done    | npm packages published (`@moldable-ai/ui`, `editor`, `storage`) |
| **Phase 3** | ✅ Done    | Apps repo created (`moldable-ai/apps` with `manifest.json`)     |
| **Phase 4** | ⏳ Pending | Desktop auto-update system (Tauri updater plugin)               |
| **Phase 5** | ✅ Done    | App installation from registry (Browse Apps UI)                 |
| **Phase 6** | ⏳ Pending | App update system (upstream tracking, merge UI)                 |

---

## Executive Summary

Moldable has three distinct distribution concerns:

1. **Desktop App** — Standalone Tauri application with auto-updates via GitHub Releases
2. **Shared Packages** — `@moldable-ai/*` npm packages that apps depend on
3. **Moldable Apps** — Forkable apps that users can customize while still receiving upstream updates

This PRD defines the architecture, implementation, and workflows for all three.

---

## 1. Desktop App Distribution

### 1.1 Current State

The desktop app builds to a standalone application:

- **React frontend** → Compiled into the Tauri bundle
- **AI server** → Compiled to native binary via Bun, bundled as Tauri sidecar
- **Audio capture** → Compiled Swift binary, bundled as Tauri sidecar

The built app requires no Node.js, pnpm, or source code to run.

### 1.2 Auto-Update Architecture

```
┌─────────────────────┐
│   User's Machine    │
│  ┌───────────────┐  │
│  │ Moldable.app  │  │
│  │               │  │
│  │ On launch or  │──────────────┐
│  │ periodically  │              │
│  └───────────────┘  │           │
└─────────────────────┘           │
                                  ▼
                    ┌─────────────────────────┐
                    │    GitHub Releases      │
                    │  moldable/moldable      │
                    │                         │
                    │  GET /releases/latest/  │
                    │      download/latest.json
                    └─────────────────────────┘
                                  │
                    ┌─────────────┴─────────────┐
                    │                           │
                    ▼                           ▼
            ┌──────────────┐           ┌──────────────┐
            │ No update    │           │ Update       │
            │ available    │           │ available    │
            └──────────────┘           └──────────────┘
                                              │
                                              ▼
                                  ┌─────────────────────┐
                                  │ Download signed     │
                                  │ update bundle       │
                                  │ (.app.tar.gz)       │
                                  └─────────────────────┘
                                              │
                                              ▼
                                  ┌─────────────────────┐
                                  │ Verify signature    │
                                  │ Install & relaunch  │
                                  └─────────────────────┘
```

### 1.3 Implementation Requirements

#### 1.3.1 Tauri Updater Plugin

**Add to `desktop/src-tauri/Cargo.toml`:**

```toml
[dependencies]
tauri-plugin-updater = "2"
```

**Add to `desktop/package.json`:**

```json
{
  "dependencies": {
    "@tauri-apps/plugin-updater": "^2",
    "@tauri-apps/plugin-process": "^2"
  }
}
```

#### 1.3.2 Signing Keys

Generate a signing keypair for update verification:

```bash
pnpm tauri signer generate -w ~/.tauri/moldable.key
```

This outputs:

- Private key saved to `~/.tauri/moldable.key` (store securely, use in CI)
- Public key printed to console (add to `tauri.conf.json`)

**Important:** Store the private key password securely. Both the key and password are needed for CI.

#### 1.3.3 Tauri Configuration

**Update `desktop/src-tauri/tauri.conf.json`:**

```json
{
  "productName": "Moldable",
  "version": "0.1.0",
  "identifier": "com.moldable.desktop",
  "bundle": {
    "createUpdaterArtifacts": true,
    "icon": ["..."],
    "externalBin": ["..."],
    "macOS": {
      "entitlements": "entitlements.mac.plist",
      "infoPlist": "Info.plist",
      "minimumSystemVersion": "10.15"
    },
    "windows": {
      "certificateThumbprint": null,
      "digestAlgorithm": "sha256",
      "timestampUrl": ""
    }
  },
  "plugins": {
    "updater": {
      "pubkey": "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXkKUldRTE...",
      "endpoints": [
        "https://github.com/moldable/moldable/releases/latest/download/latest.json"
      ],
      "windows": {
        "installMode": "passive"
      }
    }
  }
}
```

#### 1.3.4 Rust Plugin Registration

**Update `desktop/src-tauri/src/lib.rs`:**

```rust
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        // ... existing setup
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

#### 1.3.5 Update Check Hook

**Create `desktop/src/hooks/use-app-update.ts`:**

```typescript
import { useCallback, useEffect, useState } from 'react'
import { relaunch } from '@tauri-apps/plugin-process'
import { Update, check } from '@tauri-apps/plugin-updater'

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
    setState((s) => ({ ...s, checking: true, error: null }))
    try {
      const update = await check()
      setState((s) => ({
        ...s,
        checking: false,
        available: update?.available ?? false,
        update: update ?? null,
      }))
      return update
    } catch (error) {
      setState((s) => ({
        ...s,
        checking: false,
        error: error instanceof Error ? error.message : 'Update check failed',
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
            break
          case 'Progress':
            downloaded += event.data.chunkLength
            if (contentLength > 0) {
              setState((s) => ({
                ...s,
                progress: Math.round((downloaded / contentLength) * 100),
              }))
            }
            break
          case 'Finished':
            setState((s) => ({ ...s, progress: 100 }))
            break
        }
      })

      // Relaunch the app
      await relaunch()
    } catch (error) {
      setState((s) => ({
        ...s,
        downloading: false,
        error: error instanceof Error ? error.message : 'Update failed',
      }))
    }
  }, [state.update])

  const dismiss = useCallback(() => {
    setState((s) => ({ ...s, available: false, update: null }))
  }, [])

  // Check on mount
  useEffect(() => {
    if (checkOnMount) {
      checkForUpdate()
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
```

#### 1.3.6 Update Dialog Component

**Create `desktop/src/components/app-update-dialog.tsx`:**

```tsx
import { Download, RefreshCw, Sparkles, X } from 'lucide-react'
import { Button } from '@moldable-ai/ui'
import { cn } from '../lib/utils'
import { useAppUpdate } from '../hooks/use-app-update'
import { AnimatePresence, motion } from 'framer-motion'

export function AppUpdateDialog() {
  const {
    available,
    update,
    downloading,
    progress,
    error,
    downloadAndInstall,
    dismiss,
  } = useAppUpdate()

  if (!available || !update) return null

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 10, scale: 0.95 }}
        transition={{ duration: 0.2, ease: 'easeOut' }}
        className={cn(
          'fixed bottom-4 left-4 z-50',
          'border-border bg-card w-80 rounded-lg border shadow-xl',
          'overflow-hidden',
        )}
      >
        {/* Header */}
        <div className="flex items-start justify-between p-4 pb-2">
          <div className="flex items-center gap-2">
            <div className="bg-primary/10 flex size-8 items-center justify-center rounded-full">
              <Sparkles className="text-primary size-4" />
            </div>
            <div>
              <h3 className="text-foreground text-sm font-semibold">
                Update Available
              </h3>
              <p className="text-muted-foreground text-xs">
                Version {update.version}
              </p>
            </div>
          </div>
          <button
            onClick={dismiss}
            disabled={downloading}
            className={cn(
              'text-muted-foreground rounded-md p-1',
              'hover:bg-muted hover:text-foreground',
              'disabled:pointer-events-none disabled:opacity-50',
              'cursor-pointer transition-colors',
            )}
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Release notes */}
        {update.body && (
          <div className="px-4 pb-2">
            <div className="bg-muted/50 max-h-24 overflow-y-auto rounded-md p-2">
              <p className="text-muted-foreground whitespace-pre-wrap text-xs">
                {update.body}
              </p>
            </div>
          </div>
        )}

        {/* Progress bar */}
        {downloading && (
          <div className="px-4 pb-2">
            <div className="bg-muted h-1.5 w-full overflow-hidden rounded-full">
              <motion.div
                className="bg-primary h-full"
                initial={{ width: 0 }}
                animate={{ width: `${progress}%` }}
                transition={{ duration: 0.2 }}
              />
            </div>
            <p className="text-muted-foreground mt-1 text-xs">
              Downloading... {progress}%
            </p>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="px-4 pb-2">
            <p className="text-destructive text-xs">{error}</p>
          </div>
        )}

        {/* Actions */}
        <div className="border-border bg-muted/30 flex gap-2 border-t p-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={dismiss}
            disabled={downloading}
            className="flex-1"
          >
            Later
          </Button>
          <Button
            size="sm"
            onClick={downloadAndInstall}
            disabled={downloading}
            className="flex-1 gap-1.5"
          >
            {downloading ? (
              <>
                <RefreshCw className="size-3.5 animate-spin" />
                Installing...
              </>
            ) : (
              <>
                <Download className="size-3.5" />
                Update Now
              </>
            )}
          </Button>
        </div>
      </motion.div>
    </AnimatePresence>
  )
}
```

#### 1.3.7 Add to App Root

**Update `desktop/src/app.tsx`:**

```tsx
import { AppUpdateDialog } from './components/app-update-dialog'

function App() {
  return (
    <>
      {/* ... existing app content */}
      <AppUpdateDialog />
    </>
  )
}
```

### 1.4 GitHub Actions Release Workflow

**Create `.github/workflows/release.yml`:**

```yaml
name: Release

on:
  push:
    tags:
      - 'v*'

env:
  CARGO_INCREMENTAL: 0

jobs:
  create-release:
    runs-on: ubuntu-latest
    outputs:
      release_id: ${{ steps.create-release.outputs.result }}
    steps:
      - uses: actions/checkout@v4

      - name: Create release
        id: create-release
        uses: actions/github-script@v7
        with:
          script: |
            const { data } = await github.rest.repos.createRelease({
              owner: context.repo.owner,
              repo: context.repo.repo,
              tag_name: context.ref.replace('refs/tags/', ''),
              name: `Moldable ${context.ref.replace('refs/tags/', '')}`,
              body: 'See the assets to download and install this version.',
              draft: true,
              prerelease: context.ref.includes('-beta') || context.ref.includes('-alpha'),
            })
            return data.id

  build-desktop:
    needs: create-release
    permissions:
      contents: write
    strategy:
      fail-fast: false
      matrix:
        include:
          # macOS ARM (Apple Silicon)
          - platform: macos-latest
            args: --target aarch64-apple-darwin
            rust_targets: aarch64-apple-darwin

          # macOS Intel
          - platform: macos-latest
            args: --target x86_64-apple-darwin
            rust_targets: x86_64-apple-darwin

          # Linux
          - platform: ubuntu-22.04
            args: ''
            rust_targets: ''

          # Windows
          - platform: windows-latest
            args: ''
            rust_targets: ''

    runs-on: ${{ matrix.platform }}

    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 22

      - name: Setup pnpm
        uses: pnpm/action-setup@v3
        with:
          version: 9

      - name: Get pnpm store directory
        shell: bash
        run: echo "STORE_PATH=$(pnpm store path --silent)" >> $GITHUB_ENV

      - name: Setup pnpm cache
        uses: actions/cache@v4
        with:
          path: ${{ env.STORE_PATH }}
          key: ${{ runner.os }}-pnpm-store-${{ hashFiles('**/pnpm-lock.yaml') }}
          restore-keys: ${{ runner.os }}-pnpm-store-

      - name: Setup Rust
        uses: dtolnay/rust-toolchain@stable
        with:
          targets: ${{ matrix.rust_targets }}

      - name: Rust cache
        uses: swatinem/rust-cache@v2
        with:
          workspaces: './desktop/src-tauri -> target'

      - name: Install dependencies (Ubuntu)
        if: matrix.platform == 'ubuntu-22.04'
        run: |
          sudo apt-get update
          sudo apt-get install -y \
            libwebkit2gtk-4.1-dev \
            libappindicator3-dev \
            librsvg2-dev \
            patchelf

      - name: Install Bun (for AI server build)
        uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest

      - name: Install frontend dependencies
        run: pnpm install --frozen-lockfile

      - name: Build shared packages
        run: pnpm build:packages

      - name: Build AI server binary
        run: pnpm build:ai-server
        env:
          # Set target for cross-compilation on macOS
          BUN_TARGET: ${{ matrix.platform == 'macos-latest' && (contains(matrix.args, 'aarch64') && 'bun-darwin-arm64' || 'bun-darwin-x64') || '' }}

      - name: Build Tauri app
        uses: tauri-apps/tauri-action@v0
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
          TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}
          # Apple signing (macOS only)
          APPLE_CERTIFICATE: ${{ secrets.APPLE_CERTIFICATE }}
          APPLE_CERTIFICATE_PASSWORD: ${{ secrets.APPLE_CERTIFICATE_PASSWORD }}
          APPLE_SIGNING_IDENTITY: ${{ secrets.APPLE_SIGNING_IDENTITY }}
          APPLE_ID: ${{ secrets.APPLE_ID }}
          APPLE_PASSWORD: ${{ secrets.APPLE_PASSWORD }}
          APPLE_TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}
        with:
          releaseId: ${{ needs.create-release.outputs.release_id }}
          args: ${{ matrix.args }}
          projectPath: desktop

  publish-release:
    needs: [create-release, build-desktop]
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - name: Publish release
        uses: actions/github-script@v7
        env:
          release_id: ${{ needs.create-release.outputs.release_id }}
        with:
          script: |
            github.rest.repos.updateRelease({
              owner: context.repo.owner,
              repo: context.repo.repo,
              release_id: process.env.release_id,
              draft: false,
            })
```

### 1.5 GitHub Secrets Required

| Secret                               | Description                                          |
| ------------------------------------ | ---------------------------------------------------- |
| `TAURI_SIGNING_PRIVATE_KEY`          | Contents of `~/.tauri/moldable.key`                  |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Password used when generating the key                |
| `APPLE_CERTIFICATE`                  | Base64-encoded .p12 certificate (macOS code signing) |
| `APPLE_CERTIFICATE_PASSWORD`         | Password for the .p12 certificate                    |
| `APPLE_SIGNING_IDENTITY`             | e.g., "Developer ID Application: Your Name (TEAMID)" |
| `APPLE_ID`                           | Apple ID email for notarization                      |
| `APPLE_PASSWORD`                     | App-specific password for notarization               |
| `APPLE_TEAM_ID`                      | Your Apple Developer Team ID                         |

**Note:** Apple signing secrets are optional but recommended for macOS distribution to avoid Gatekeeper warnings.

### 1.6 Release Artifacts

Each release will contain:

```
v0.2.0 Release
│
├── Installers (what users download manually)
│   ├── Moldable_0.2.0_aarch64.dmg         # macOS ARM
│   ├── Moldable_0.2.0_x64.dmg             # macOS Intel
│   ├── Moldable_0.2.0_amd64.deb           # Linux Debian
│   ├── Moldable_0.2.0_amd64.AppImage      # Linux AppImage
│   ├── Moldable_0.2.0_x64-setup.exe       # Windows installer
│   └── Moldable_0.2.0_x64_en-US.msi       # Windows MSI
│
├── Update bundles (for auto-updater)
│   ├── Moldable_0.2.0_aarch64.app.tar.gz
│   ├── Moldable_0.2.0_aarch64.app.tar.gz.sig
│   ├── Moldable_0.2.0_x64.app.tar.gz
│   ├── Moldable_0.2.0_x64.app.tar.gz.sig
│   ├── Moldable_0.2.0_amd64.AppImage.tar.gz
│   ├── Moldable_0.2.0_amd64.AppImage.tar.gz.sig
│   ├── Moldable_0.2.0_x64_en-US.msi.zip
│   └── Moldable_0.2.0_x64_en-US.msi.zip.sig
│
└── latest.json                             # Update manifest
```

### 1.7 Version Bumping

Before creating a release, update versions in:

1. `desktop/src-tauri/tauri.conf.json` → `version`
2. `desktop/src-tauri/Cargo.toml` → `version`
3. `desktop/package.json` → `version` (optional, for consistency)

**Release command sequence:**

```bash
# 1. Update versions (can be automated with a script)
# 2. Commit
git add .
git commit -m "chore: release v0.2.0"

# 3. Tag
git tag v0.2.0

# 4. Push (triggers the workflow)
git push origin main --tags
```

---

## 2. Shared Package Distribution

### 2.1 Packages to Publish

| Package                      | npm Name                         | Purpose                             | Publish          |
| ---------------------------- | -------------------------------- | ----------------------------------- | ---------------- |
| `packages/ui`                | `@moldable-ai/ui`                | Shared UI components, theme, shadcn | ✅ Yes           |
| `packages/editor`            | `@moldable-ai/editor`            | Lexical markdown editor             | ✅ Yes           |
| `packages/storage`           | `@moldable-ai/storage`           | File storage utilities              | ✅ Yes           |
| `packages/ai`                | `@moldable-ai/ai`                | AI utilities                        | ❌ No (internal) |
| `packages/ai-server`         | `@moldable-ai/ai-server`         | AI server                           | ❌ No (bundled)  |
| `packages/mcp`               | `@moldable-ai/mcp`               | MCP client                          | ❌ No (internal) |
| `packages/eslint-config`     | `@moldable-ai/eslint-config`     | ESLint config                       | ⚠️ Optional      |
| `packages/typescript-config` | `@moldable-ai/typescript-config` | TS config                           | ⚠️ Optional      |
| `packages/prettier-config`   | `@moldable-ai/prettier-config`   | Prettier config                     | ⚠️ Optional      |

### 2.2 Package Configuration

**Add to each published package's `package.json`:**

```json
{
  "name": "@moldable-ai/ui",
  "version": "0.1.0",
  "publishConfig": {
    "access": "public"
  },
  "repository": {
    "type": "git",
    "url": "https://github.com/moldable/moldable.git",
    "directory": "packages/ui"
  },
  "homepage": "https://github.com/moldable/moldable/tree/main/packages/ui",
  "bugs": {
    "url": "https://github.com/moldable/moldable/issues"
  },
  "license": "MIT"
}
```

### 2.3 Changesets for Version Management

**Install changesets:**

```bash
pnpm add -Dw @changesets/cli
pnpm changeset init
```

**Configure `.changeset/config.json`:**

```json
{
  "$schema": "https://unpkg.com/@changesets/config@3.0.0/schema.json",
  "changelog": "@changesets/cli/changelog",
  "commit": false,
  "fixed": [],
  "linked": [
    ["@moldable-ai/ui", "@moldable-ai/editor", "@moldable-ai/storage"]
  ],
  "access": "public",
  "baseBranch": "main",
  "updateInternalDependencies": "patch",
  "ignore": [
    "moldable-desktop",
    "@moldable-ai/ai",
    "@moldable-ai/ai-server",
    "@moldable-ai/mcp"
  ]
}
```

### 2.4 Package Publishing Workflow

**Create `.github/workflows/publish-packages.yml`:**

```yaml
name: Publish Packages

on:
  push:
    branches:
      - main
    paths:
      - 'packages/ui/**'
      - 'packages/editor/**'
      - 'packages/storage/**'
      - '.changeset/**'

concurrency: ${{ github.workflow }}-${{ github.ref }}

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 22
          registry-url: 'https://registry.npmjs.org'

      - name: Setup pnpm
        uses: pnpm/action-setup@v3
        with:
          version: 9

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Build packages
        run: pnpm build:packages

      - name: Create Release Pull Request or Publish
        id: changesets
        uses: changesets/action@v1
        with:
          publish: pnpm changeset publish
          version: pnpm changeset version
          commit: 'chore: release packages'
          title: 'chore: release packages'
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          NPM_TOKEN: ${{ secrets.NPM_TOKEN }}
```

### 2.5 Workflow for Package Changes

```bash
# 1. Make changes to a package
# 2. Create a changeset
pnpm changeset

# 3. Answer prompts:
#    - Which packages changed? (select @moldable-ai/ui)
#    - Is this a major/minor/patch? (select appropriate)
#    - Summary of changes

# 4. Commit the changeset
git add .
git commit -m "feat(ui): add new button variant"
git push

# 5. GitHub Action creates a "Release" PR
# 6. Merge the PR → packages are published to npm
```

---

## 3. Moldable Apps Distribution

### 3.1 App Source Code Location

**Key design decision:** App source code is **shared** across all workspaces, while app data is **workspace-scoped**:

- **Code** lives in `~/.moldable/shared/apps/{app}/` — installed once, used by all workspaces
- **Data** lives in `~/.moldable/workspaces/{ws}/apps/{app}/` — isolated per workspace

This means:

- Installing an app once makes it available to all workspaces
- Each workspace has its own isolated data for each app
- Updating an app updates it for all workspaces at once

```
~/.moldable/
├── workspaces.json
├── shared/
│   ├── .env                           # API keys
│   └── apps/                          # SHARED app source code
│       ├── scribo/
│       │   ├── moldable.json
│       │   ├── package.json
│       │   ├── node_modules/
│       │   └── src/
│       ├── meetings/
│       │   └── ...
│       └── todo/
│           └── ...
│
└── workspaces/
    ├── personal/
    │   ├── config.json                # Which apps are enabled, preferences
    │   ├── conversations/
    │   └── apps/                      # WORKSPACE-SCOPED app data
    │       ├── scribo/
    │       │   └── entries.db
    │       ├── meetings/
    │       │   ├── meetings.db
    │       │   └── recordings/
    │       └── todo/
    │           └── todos.db
    │
    └── work/
        ├── config.json
        └── apps/                      # Separate data for work workspace
            ├── scribo/
            │   └── entries.db         # Different entries than personal
            └── meetings/
                └── meetings.db        # Different meetings than personal
```

### 3.2 GitHub Repository Structure

```
GitHub:
├── moldable/moldable              # Main monorepo
│   ├── desktop/                   # Tauri desktop app
│   ├── packages/                  # Shared packages (published to npm)
│   │   ├── ui/
│   │   ├── editor/
│   │   └── storage/
│   └── prds/
│
└── moldable/apps                  # Separate apps repository (source only)
    ├── scribo/
    │   ├── moldable.json
    │   ├── package.json
    │   └── src/
    ├── meetings/
    ├── todo/
    ├── calendar/
    ├── git-flow/
    └── notes/
```

When a user installs an app, code goes to shared, data directories are created per-workspace:

- **Code:** `~/.moldable/shared/apps/{app-id}/`
- **Data:** `~/.moldable/workspaces/{workspace}/apps/{app-id}/data/` (created on first run per workspace)

### 3.3 App Package.json Changes

Apps in the `moldable/apps` repo use npm versions (not workspace references):

```json
{
  "name": "scribo",
  "version": "1.0.0",
  "dependencies": {
    "@moldable-ai/ui": "^0.1.0",
    "@moldable-ai/editor": "^0.1.0",
    "@moldable-ai/storage": "^0.1.0",
    "next": "15.5.7",
    "react": "19.1.2"
  }
}
```

This allows apps to be installed standalone without the monorepo.

### 3.4 Enhanced moldable.json Schema

The `moldable.json` file serves as both app manifest and package metadata (like `package.json`):

```json
{
  "$schema": "https://moldable.sh/schemas/moldable.json",

  // === Package Info (like package.json) ===
  "name": "Scribo Languages",
  "version": "1.2.0",
  "description": "Language learning journal with AI-powered translations",
  "author": "Moldable Team",
  "license": "MIT",
  "repository": "moldable/apps",
  "homepage": "https://moldable.sh/apps/scribo",

  // === Moldable-specific ===
  "icon": "📓",
  "iconPath": "public/icon.png",
  "widgetSize": "medium",
  "category": "productivity",
  "tags": ["languages", "translation", "learning"],

  // === Dependencies (declared, not installed) ===
  "moldableDependencies": {
    "@moldable-ai/ui": "^0.1.0",
    "@moldable-ai/editor": "^0.1.0"
  },

  // === Environment Requirements ===
  "env": [
    {
      "key": "DEEPL_API_KEY",
      "name": "DeepL API Key",
      "description": "Powers automatic translations between languages",
      "url": "https://www.deepl.com/en/your-account/keys",
      "required": true
    }
  ],

  // === Installation State (added after install) ===
  "upstream": {
    "repo": "moldable/apps",
    "path": "scribo",
    "installedVersion": "1.2.0",
    "installedCommit": "abc123def456789",
    "installedAt": "2026-01-15T12:00:00Z"
  },

  "modified": false,
  "modifiedAt": null
}
```

**Core Fields:**

| Field         | Type     | Description                              |
| ------------- | -------- | ---------------------------------------- |
| `name`        | string   | Display name                             |
| `version`     | string   | Semantic version (e.g., "1.2.0")         |
| `description` | string   | Short description                        |
| `icon`        | string   | Emoji icon                               |
| `iconPath`    | string   | Path to icon image                       |
| `widgetSize`  | string   | "small" \| "medium" \| "large" \| "wide" |
| `category`    | string   | App category for browsing                |
| `tags`        | string[] | Searchable tags                          |

**Installation State Fields (added after install):**

| Field                       | Type           | Description                         |
| --------------------------- | -------------- | ----------------------------------- |
| `upstream.repo`             | string         | Source repo (e.g., "moldable/apps") |
| `upstream.path`             | string         | Path within repo                    |
| `upstream.installedVersion` | string         | Version when installed              |
| `upstream.installedCommit`  | string         | Commit SHA when installed           |
| `upstream.installedAt`      | string         | ISO timestamp                       |
| `modified`                  | boolean        | Whether user has modified code      |
| `modifiedAt`                | string \| null | When first modified                 |

### 3.5 App Registry (Remote Manifest)

Instead of requiring users to clone the full `moldable/apps` repo, Moldable fetches a manifest file from GitHub that lists all available apps.

**Manifest URL:**

```
https://raw.githubusercontent.com/moldable/apps/main/manifest.json
```

**manifest.json structure:**

```json
{
  "$schema": "https://moldable.sh/schemas/manifest.json",
  "version": "1",
  "generatedAt": "2026-01-15T12:00:00Z",
  "registry": "moldable/apps",

  "apps": [
    {
      "id": "scribo",
      "name": "Scribo Languages",
      "version": "1.2.0",
      "description": "Language learning journal with AI-powered translations",
      "icon": "📓",
      "iconUrl": "https://raw.githubusercontent.com/moldable/apps/main/scribo/public/icon.png",
      "widgetSize": "medium",
      "category": "productivity",
      "tags": ["languages", "translation", "learning"],
      "path": "scribo",
      "requiredEnv": ["DEEPL_API_KEY"],
      "moldableDependencies": {
        "@moldable-ai/ui": "^0.1.0",
        "@moldable-ai/editor": "^0.1.0"
      },
      "downloadUrl": "https://github.com/moldable/apps/archive/refs/heads/main.zip",
      "commit": "abc123def456"
    },
    {
      "id": "meetings",
      "name": "Meeting Notes",
      "version": "1.1.0",
      "description": "Record, transcribe, and summarize meetings",
      "icon": "🎙️",
      "iconUrl": "https://raw.githubusercontent.com/moldable/apps/main/meetings/public/icon.png",
      "widgetSize": "large",
      "category": "productivity",
      "tags": ["meetings", "transcription", "audio"],
      "path": "meetings",
      "requiredEnv": ["DEEPGRAM_API_KEY"],
      "commit": "abc123def456"
    }
  ],

  "categories": [
    { "id": "productivity", "name": "Productivity", "icon": "⚡" },
    { "id": "finance", "name": "Finance", "icon": "💰" },
    { "id": "health", "name": "Health", "icon": "❤️" },
    { "id": "developer", "name": "Developer Tools", "icon": "🛠️" }
  ]
}
```

**How it works:**

1. **Desktop fetches manifest** on startup (cached, refreshed periodically)
2. **Browse Apps UI** shows available apps from manifest
3. **Install downloads only that app** (via GitHub archive API or sparse checkout)
4. **No full repo clone required**

**GitHub Archive Download:**

To download a single app folder, we can use GitHub's archive API and extract just the needed folder:

```typescript
async function downloadApp(appPath: string, commit: string): Promise<void> {
  // Download the repo archive for the specific commit
  const archiveUrl = `https://github.com/moldable/apps/archive/${commit}.zip`

  // Extract only the app folder (e.g., "moldable-apps-abc123/scribo/")
  const archive = await fetch(archiveUrl)
  const zip = await unzip(archive)

  // Copy just the app folder to the destination
  const appFolder = zip.find((f) => f.path.endsWith(`/${appPath}/`))
  await copyTo(appFolder, destinationPath)
}
```

**Alternative: GitHub API for individual files:**

For smaller apps or incremental updates, fetch files individually:

```typescript
async function fetchAppFiles(repo: string, path: string, commit: string) {
  const apiUrl = `https://api.github.com/repos/${repo}/contents/${path}?ref=${commit}`
  const files = await fetch(apiUrl).then((r) => r.json())

  for (const file of files) {
    if (file.type === 'file') {
      const content = await fetch(file.download_url).then((r) => r.text())
      await writeFile(file.path, content)
    } else if (file.type === 'dir') {
      await fetchAppFiles(repo, file.path, commit)
    }
  }
}
```

**Manifest Generation (CI):**

The manifest is auto-generated on each release via GitHub Actions:

```yaml
# .github/workflows/generate-manifest.yml
name: Generate Manifest

on:
  push:
    branches: [main]
  release:
    types: [published]

jobs:
  generate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Generate manifest
        run: node scripts/generate-manifest.js

      - name: Commit manifest
        run: |
          git config user.name github-actions
          git config user.email github-actions@github.com
          git add manifest.json
          git commit -m "chore: update manifest" || exit 0
          git push
```

**generate-manifest.js:**

```javascript
const fs = require('fs')
const path = require('path')

const apps = []
const appsDir = '.'

for (const dir of fs.readdirSync(appsDir)) {
  const manifestPath = path.join(appsDir, dir, 'moldable.json')
  if (fs.existsSync(manifestPath)) {
    const manifest = JSON.parse(fs.readFileSync(manifestPath))
    apps.push({
      id: dir,
      name: manifest.name,
      version: manifest.version,
      description: manifest.description,
      icon: manifest.icon,
      iconUrl: `https://raw.githubusercontent.com/moldable/apps/main/${dir}/${manifest.iconPath}`,
      widgetSize: manifest.widgetSize,
      category: manifest.category,
      tags: manifest.tags,
      path: dir,
      requiredEnv:
        manifest.env?.filter((e) => e.required).map((e) => e.key) || [],
      moldableDependencies: manifest.moldableDependencies || {},
    })
  }
}

const manifest = {
  $schema: 'https://moldable.sh/schemas/manifest.json',
  version: '1',
  generatedAt: new Date().toISOString(),
  registry: 'moldable/apps',
  apps,
  categories: [
    { id: 'productivity', name: 'Productivity', icon: '⚡' },
    { id: 'finance', name: 'Finance', icon: '💰' },
    { id: 'health', name: 'Health', icon: '❤️' },
    { id: 'developer', name: 'Developer Tools', icon: '🛠️' },
  ],
}

fs.writeFileSync('manifest.json', JSON.stringify(manifest, null, 2))
console.log(`Generated manifest with ${apps.length} apps`)
```

### 3.6 App Installation Flow

**Browse Apps Dialog:**

```
┌─────────────────────────────────────────────────────────────┐
│  Browse Apps                                         [×]    │
│  ─────────────────────────────────────────────────────────  │
│  [All] [Productivity] [Finance] [Health] [Developer]        │
│                                                             │
│  ┌─────────────────────┐  ┌─────────────────────┐          │
│  │ 📓 Scribo Languages │  │ 🎙️ Meeting Notes    │          │
│  │ v1.2.0              │  │ v1.1.0              │          │
│  │ Language learning   │  │ Record & transcribe │          │
│  │ journal             │  │ meetings            │          │
│  │        [Install]    │  │        [Install]    │          │
│  └─────────────────────┘  └─────────────────────┘          │
│                                                             │
│  ┌─────────────────────┐  ┌─────────────────────┐          │
│  │ ✅ Todo             │  │ 📅 Calendar         │          │
│  │ v1.0.0              │  │ v0.9.0              │          │
│  │ Simple task         │  │ Google Calendar     │          │
│  │ management          │  │ integration         │          │
│  │        [Install]    │  │        [Install]    │          │
│  └─────────────────────┘  └─────────────────────┘          │
└─────────────────────────────────────────────────────────────┘
```

**Install Confirmation:**

```
┌─────────────────────────────────────────────────────────────┐
│  Install Scribo Languages?                                  │
│  ─────────────────────────────────────────────────────────  │
│                                                             │
│  📓 Scribo Languages v1.2.0                                 │
│  Language learning journal with AI-powered translations     │
│                                                             │
│  ⚠️ Requires API Key:                                       │
│  • DeepL API Key (for translations)                        │
│                                                             │
│  [Cancel]                              [Install]            │
└─────────────────────────────────────────────────────────────┘
```

**Installation steps:**

1. **Fetch manifest** from `moldable-ai/apps` (cached)
2. **Download app archive** for specific commit
3. **Extract to** `~/.moldable/shared/apps/{app-id}/` (shared location)
4. **Update moldable.json** with `upstream` installation state
5. **Run** `pnpm install` in code directory
6. **Register** app as available
7. **Create data dir** `~/.moldable/workspaces/{active}/apps/{app-id}/data/` on first run
8. **Start app** and show in canvas

**Resulting structure:**

```
~/.moldable/
├── shared/
│   └── apps/
│       └── scribo/              # Downloaded source (shared)
│           ├── moldable.json    # Updated with upstream info
│           ├── package.json
│           ├── node_modules/    # After pnpm install
│           └── src/
│
└── workspaces/
    └── personal/
        └── apps/
            └── scribo/          # App data (workspace-scoped)
                └── (created on first run)
```

**Implementation:**

```typescript
// desktop/src/lib/app-installer.ts

interface AppManifestEntry {
  id: string
  name: string
  version: string
  description: string
  icon: string
  path: string
  commit: string
  requiredEnv: string[]
}

async function installApp(app: AppManifestEntry) {
  // Code is shared across all workspaces
  const codeDir = `~/.moldable/shared/apps/${app.id}`

  // 1. Download and extract to shared location
  await downloadAppFromGitHub('moldable-ai/apps', app.path, app.commit, codeDir)

  // 2. Update moldable.json with upstream info
  const moldableJson = await readJson(`${codeDir}/moldable.json`)
  moldableJson.upstream = {
    repo: 'moldable-ai/apps',
    path: app.path,
    installedVersion: app.version,
    installedCommit: app.commit,
    installedAt: new Date().toISOString(),
  }
  moldableJson.modified = false
  await writeJson(`${codeDir}/moldable.json`, moldableJson)

  // 3. Install dependencies
  await exec('pnpm install', { cwd: codeDir })

  // 4. Register app as available (not workspace-specific)
  await registerSharedApp({
    id: app.id,
    name: app.name,
    icon: app.icon,
    path: codeDir,
    // ... other fields
  })
}

// Data directory is created per-workspace on first app run
function getAppDataDir(appId: string, workspaceId: string): string {
  return `~/.moldable/workspaces/${workspaceId}/apps/${appId}/data`
}

async function downloadAppFromGitHub(
  repo: string,
  appPath: string,
  commit: string,
  destDir: string,
) {
  // Option 1: Download full archive and extract just the app folder
  const archiveUrl = `https://github.com/${repo}/archive/${commit}.zip`
  const archive = await fetch(archiveUrl)
  const zip = await decompress(await archive.arrayBuffer())

  // Find and extract just the app folder
  // Archive structure: moldable-apps-{commit}/{appPath}/...
  const prefix = `moldable-apps-${commit}/${appPath}/`
  for (const file of zip.files) {
    if (file.name.startsWith(prefix)) {
      const relativePath = file.name.slice(prefix.length)
      if (relativePath) {
        await writeFile(`${destDir}/${relativePath}`, file.content)
      }
    }
  }
}
```

### 3.7 Modification Detection

The desktop detects modifications by:

1. **File watching:** Monitor app `code/` directory for changes
2. **Git status:** If app code dir is a git repo, check for uncommitted changes
3. **Hash comparison:** Compare file hashes against known upstream state

**When modification is detected:**

```typescript
// desktop/src/lib/app-modifications.ts

interface ModificationCheck {
  modified: boolean
  changedFiles: string[]
  firstModifiedAt: string | null
}

async function checkAppModification(
  appId: string,
  workspaceId: string,
): Promise<ModificationCheck> {
  const appCodePath = `~/.moldable/workspaces/${workspaceId}/apps/${appId}/code`
  const moldableJson = await readMoldableJson(appCodePath)

  if (!moldableJson.upstream) {
    // App has no upstream (user-created via agent)
    return { modified: false, changedFiles: [], firstModifiedAt: null }
  }

  // Compare against upstream commit
  const upstreamFiles = await fetchUpstreamFileList(
    moldableJson.upstream.repo,
    moldableJson.upstream.path,
    moldableJson.upstream.commit,
  )

  const localFiles = await getLocalFileList(appCodePath)
  const changedFiles = compareFileLists(upstreamFiles, localFiles)

  return {
    modified: changedFiles.length > 0,
    changedFiles,
    firstModifiedAt: moldableJson.modifiedAt ?? null,
  }
}
```

**Update moldable.json on first modification:**

```typescript
async function markAsModified(appPath: string): Promise<void> {
  const moldableJson = await readMoldableJson(appPath)

  if (!moldableJson.modified) {
    moldableJson.modified = true
    moldableJson.modifiedAt = new Date().toISOString()
    await writeMoldableJson(appPath, moldableJson)
  }
}
```

### 3.8 Update Checking

**Check for app updates using the manifest:**

The manifest serves as the source of truth for latest versions. On each check:

1. Fetch manifest (cached for 1 hour)
2. Compare installed `upstream.installedVersion` with manifest `version`
3. Flag updates as breaking if major version changed

```typescript
// desktop/src/lib/app-updates.ts

interface AppUpdate {
  available: boolean
  currentVersion: string
  latestVersion: string
  latestCommit: string
  breaking: boolean
}

async function checkForAppUpdates(
  installedApps: RegisteredApp[],
): Promise<Map<string, AppUpdate>> {
  // Fetch latest manifest (cached)
  const manifest = await fetchAppRegistry()
  const updates = new Map<string, AppUpdate>()

  for (const app of installedApps) {
    const moldableJson = await readMoldableJson(app.path)

    if (!moldableJson.upstream) {
      continue // No upstream (agent-generated app)
    }

    // Find this app in the manifest
    const registryEntry = manifest.apps.find((a) => a.id === app.id)
    if (!registryEntry) {
      continue // App no longer in registry
    }

    const currentVersion = moldableJson.upstream.installedVersion
    const latestVersion = registryEntry.version

    if (currentVersion === latestVersion) {
      updates.set(app.id, {
        available: false,
        currentVersion,
        latestVersion,
        latestCommit: registryEntry.commit,
        breaking: false,
      })
    } else {
      // Check if major version changed (breaking)
      const [currentMajor] = currentVersion.split('.').map(Number)
      const [latestMajor] = latestVersion.split('.').map(Number)

      updates.set(app.id, {
        available: true,
        currentVersion,
        latestVersion,
        latestCommit: registryEntry.commit,
        breaking: latestMajor > currentMajor,
      })
    }
  }

  return updates
}

// React hook to check all installed apps for updates
function useAppUpdates() {
  const { data: apps } = useRegisteredApps()

  return useQuery({
    queryKey: ['app-updates'],
    queryFn: () => checkForAppUpdates(apps ?? []),
    enabled: !!apps,
    staleTime: 1000 * 60 * 60, // 1 hour
  })
}
```

**Updating an app:**

```typescript
async function updateApp(appId: string): Promise<void> {
  const manifest = await fetchAppRegistry()
  const registryEntry = manifest.apps.find((a) => a.id === appId)

  if (!registryEntry) {
    throw new Error('App not found in registry')
  }

  const appCodePath = getAppCodePath(appId)
  const moldableJson = await readMoldableJson(appCodePath)

  if (moldableJson.modified) {
    // App has local modifications - need to merge
    await mergeAppUpdate(appId, registryEntry)
  } else {
    // Clean update - just replace
    await replaceAppWithLatest(appId, registryEntry)
  }
}

async function replaceAppWithLatest(
  appId: string,
  registryEntry: AppRegistryEntry,
): Promise<void> {
  const appCodePath = getAppCodePath(appId)

  // Backup node_modules (avoid re-downloading)
  const nodeModulesBackup = `${appCodePath}/../.node_modules_backup`
  if (await fs.exists(`${appCodePath}/node_modules`)) {
    await fs.rename(`${appCodePath}/node_modules`, nodeModulesBackup)
  }

  // Remove old code
  await fs.rm(appCodePath, { recursive: true })

  // Download new version
  await downloadAppFromGitHub(
    'moldable/apps',
    registryEntry.path,
    registryEntry.commit,
    appCodePath,
  )

  // Restore node_modules
  if (await fs.exists(nodeModulesBackup)) {
    await fs.rename(nodeModulesBackup, `${appCodePath}/node_modules`)
  }

  // Update dependencies if package.json changed
  await exec('pnpm install', { cwd: appCodePath })

  // Update upstream info in moldable.json
  await updateMoldableJsonUpstream(appCodePath, registryEntry)
}
```

### 3.9 Update UI Components

**App card badge for updates:**

```tsx
// In widget-card.tsx or similar

function AppUpdateBadge({ app }: { app: MoldableApp }) {
  const { data: update } = useAppUpstreamUpdate(app.id)

  if (!update?.available) return null

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="absolute -right-1 -top-1 flex size-5 items-center justify-center">
            <span className="bg-primary absolute inline-flex size-full animate-ping rounded-full opacity-75" />
            <span className="bg-primary relative flex size-3 rounded-full" />
          </div>
        </TooltipTrigger>
        <TooltipContent>
          <p>Update available: v{update.latestVersion}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
```

**Update dialog for modified apps:**

```tsx
// desktop/src/components/app-upstream-update-dialog.tsx

interface AppUpstreamUpdateDialogProps {
  app: MoldableApp
  update: UpstreamUpdate
  onUpdate: () => void
  onSkip: () => void
  onDetach: () => void
}

export function AppUpstreamUpdateDialog({
  app,
  update,
  onUpdate,
  onSkip,
  onDetach,
}: AppUpstreamUpdateDialogProps) {
  const moldableJson = useMoldableJson(app.path)
  const isModified = moldableJson?.modified ?? false

  return (
    <Dialog>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span>{app.icon}</span>
            Update Available for {app.name}
          </DialogTitle>
          <DialogDescription>
            Version {update.latestVersion} is available
            {update.breaking && (
              <Badge variant="destructive" className="ml-2">
                Breaking Changes
              </Badge>
            )}
          </DialogDescription>
        </DialogHeader>

        {/* Changelog */}
        {update.changelog && (
          <div className="bg-muted rounded-md p-3">
            <p className="mb-1 text-sm font-medium">What's new:</p>
            <p className="text-muted-foreground whitespace-pre-wrap text-sm">
              {update.changelog}
            </p>
          </div>
        )}

        {/* Modified warning */}
        {isModified && (
          <Alert variant="warning">
            <AlertTriangle className="size-4" />
            <AlertTitle>You've modified this app</AlertTitle>
            <AlertDescription>
              Updating will attempt to merge upstream changes with your
              modifications. Some manual conflict resolution may be needed.
            </AlertDescription>
          </Alert>
        )}

        <DialogFooter className="flex-col gap-2 sm:flex-row">
          {isModified && (
            <Button variant="ghost" onClick={onDetach} className="sm:mr-auto">
              Detach from upstream
            </Button>
          )}
          <Button variant="outline" onClick={onSkip}>
            Skip this version
          </Button>
          <Button onClick={onUpdate}>
            {isModified ? 'Update & Merge' : 'Update'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
```

### 3.10 Update Strategies

| Scenario             | Strategy                   | User Action               |
| -------------------- | -------------------------- | ------------------------- |
| **Unmodified app**   | Replace with new version   | One-click update          |
| **Modified app**     | Git merge upstream changes | Review conflicts if any   |
| **Heavily modified** | Manual merge or detach     | Choose to merge or detach |
| **Detached app**     | No upstream tracking       | Manual updates only       |

**Implementation for modified apps:**

```typescript
async function updateModifiedApp(
  appPath: string,
  upstream: UpstreamInfo,
): Promise<UpdateResult> {
  // 1. Stash local changes
  await git.stash(appPath)

  // 2. Fetch upstream
  await git.fetch(appPath, 'upstream')

  // 3. Attempt merge
  const mergeResult = await git.merge(appPath, upstream.commit)

  if (mergeResult.conflicts.length > 0) {
    // 4a. Conflicts exist - restore stash and notify user
    await git.stashPop(appPath)
    return {
      success: false,
      conflicts: mergeResult.conflicts,
      message: 'Merge conflicts detected. Please resolve manually.',
    }
  }

  // 4b. Merge successful - apply stashed changes
  await git.stashPop(appPath)

  // 5. Update moldable.json
  await updateMoldableJson(appPath, {
    upstream: {
      ...upstream,
      version: upstream.latestVersion,
      commit: upstream.latestCommit,
    },
  })

  return {
    success: true,
    message: `Updated to v${upstream.latestVersion}`,
  }
}
```

### 3.11 Detaching from Upstream

When a user wants to fully own their fork:

```typescript
async function detachFromUpstream(
  appId: string,
  workspaceId: string,
): Promise<void> {
  const appCodePath = `~/.moldable/workspaces/${workspaceId}/apps/${appId}/code`
  const moldableJson = await readMoldableJson(appCodePath)

  // Remove upstream info
  delete moldableJson.upstream
  moldableJson.modified = false
  moldableJson.modifiedAt = null

  await writeMoldableJson(appCodePath, moldableJson)

  // Optional: Remove git remote
  await git.removeRemote(appCodePath, 'upstream')
}
```

### 3.12 Agent-Generated Apps

When the agent creates a new app, it generates code in the same structure:

```
User: "Build me a habit tracker app"

Agent creates:
~/.moldable/workspaces/personal/apps/habit-tracker/
├── code/
│   ├── moldable.json       # No upstream (user-created)
│   ├── package.json
│   ├── next.config.ts
│   └── src/
│       ├── app/
│       └── components/
└── data/                   # Empty, app will write here
```

**moldable.json for agent-generated apps:**

```json
{
  "name": "Habit Tracker",
  "icon": "✅",
  "description": "Track daily habits with streaks",
  "widgetSize": "medium",
  "generatedAt": "2026-01-15T12:00:00Z",
  "generatedBy": "moldable-agent"
}
```

Note: No `upstream` field means the app was created locally, not installed from a repo.

### 3.13 Desktop Backend Changes Required

The Rust backend needs updates to support:

1. New `code/` + `data/` directory structure
2. Remote manifest fetching (replaces local folder scanning)
3. App download and installation

**1. Update `RegisteredApp` struct:**

```rust
struct RegisteredApp {
    id: String,
    name: String,
    icon: String,
    icon_path: Option<String>,
    port: u16,
    // path now points to the code/ directory
    path: String,  // e.g., ~/.moldable/workspaces/personal/apps/scribo/code
    command: String,
    args: Vec<String>,
    widget_size: String,
    requires_port: bool,
    // New: track version for updates
    version: Option<String>,
}
```

**2. Replace `list_available_apps()` with manifest fetch:**

```rust
// OLD: Scan local folders
fn list_available_apps() -> Result<Vec<AvailableApp>, String> { ... }

// NEW: Fetch remote manifest
#[tauri::command]
async fn fetch_app_registry() -> Result<AppRegistry, String> {
    let manifest_url = "https://raw.githubusercontent.com/moldable/apps/main/manifest.json";

    // Check cache first (valid for 1 hour)
    if let Some(cached) = get_cached_manifest() {
        return Ok(cached);
    }

    let response = reqwest::get(manifest_url)
        .await
        .map_err(|e| format!("Failed to fetch manifest: {}", e))?;

    let manifest: AppRegistry = response.json()
        .await
        .map_err(|e| format!("Failed to parse manifest: {}", e))?;

    // Cache for next time
    cache_manifest(&manifest);

    Ok(manifest)
}

#[derive(serde::Deserialize, serde::Serialize)]
struct AppRegistry {
    version: String,
    generated_at: String,
    apps: Vec<AppRegistryEntry>,
    categories: Vec<Category>,
}

#[derive(serde::Deserialize, serde::Serialize)]
struct AppRegistryEntry {
    id: String,
    name: String,
    version: String,
    description: String,
    icon: String,
    icon_url: Option<String>,
    widget_size: String,
    category: String,
    tags: Vec<String>,
    path: String,
    required_env: Vec<String>,
    commit: String,
}
```

**3. Add app installation command:**

```rust
#[tauri::command]
async fn install_app_from_registry(
    app_id: String,
    app_path: String,
    commit: String,
) -> Result<RegisteredApp, String> {
    let workspaces_config = get_workspaces_config_internal()?;
    let home = std::env::var("HOME").map_err(|_| "Could not get HOME")?;

    let app_dir = format!(
        "{}/.moldable/workspaces/{}/apps/{}",
        home, workspaces_config.active_workspace, app_id
    );
    let code_dir = format!("{}/code", app_dir);
    let data_dir = format!("{}/data", app_dir);

    // 1. Download and extract app
    download_app_from_github("moldable/apps", &app_path, &commit, &code_dir).await?;

    // 2. Create data directory
    std::fs::create_dir_all(&data_dir)
        .map_err(|e| format!("Failed to create data dir: {}", e))?;

    // 3. Update moldable.json with upstream info
    update_moldable_json_upstream(&code_dir, &app_path, &commit)?;

    // 4. Run pnpm install
    run_pnpm_install(&code_dir).await?;

    // 5. Detect and register app
    let detected = detect_app_in_folder(code_dir.clone())?
        .ok_or("Failed to detect installed app")?;

    register_app(detected.clone())?;

    Ok(detected)
}

async fn download_app_from_github(
    repo: &str,
    app_path: &str,
    commit: &str,
    dest_dir: &str,
) -> Result<(), String> {
    let archive_url = format!("https://github.com/{}/archive/{}.zip", repo, commit);

    // Download archive
    let response = reqwest::get(&archive_url)
        .await
        .map_err(|e| format!("Download failed: {}", e))?;

    let bytes = response.bytes()
        .await
        .map_err(|e| format!("Read failed: {}", e))?;

    // Extract just the app folder using zip crate
    // Archive structure: moldable-apps-{commit}/{app_path}/...
    let prefix = format!("moldable-apps-{}/{}/", &commit[..7], app_path);

    // ... extraction logic

    Ok(())
}
```

**4. Update `start_app_internal()` for new paths:**

```rust
// App data dir is sibling to code dir
// Given path = ~/.moldable/workspaces/personal/apps/scribo/code
// Data dir = ~/.moldable/workspaces/personal/apps/scribo/data
let app_data_dir = if working_dir.ends_with("/code") {
    working_dir.replace("/code", "/data")
} else {
    format!("{}/data", working_dir.trim_end_matches('/'))
};
```

**5. Add manifest caching:**

```rust
fn get_manifest_cache_path() -> PathBuf {
    let home = std::env::var("HOME").unwrap();
    PathBuf::from(format!("{}/.moldable/cache/app-registry.json", home))
}

fn get_cached_manifest() -> Option<AppRegistry> {
    let cache_path = get_manifest_cache_path();
    if !cache_path.exists() {
        return None;
    }

    // Check if cache is less than 1 hour old
    let metadata = std::fs::metadata(&cache_path).ok()?;
    let modified = metadata.modified().ok()?;
    let age = std::time::SystemTime::now().duration_since(modified).ok()?;

    if age > std::time::Duration::from_secs(3600) {
        return None; // Cache expired
    }

    let content = std::fs::read_to_string(&cache_path).ok()?;
    serde_json::from_str(&content).ok()
}
```

---

## 4. Apps Repository Structure

### 4.1 Repository Layout

```
moldable/apps/
├── .github/
│   └── workflows/
│       └── release.yml           # Creates releases for all apps
├── scribo/
│   ├── moldable.json
│   ├── package.json
│   ├── next.config.ts
│   ├── tsconfig.json
│   ├── public/
│   ├── scripts/
│   │   └── moldable-dev.mjs
│   └── src/
├── meetings/
│   └── ...
├── todo/
│   └── ...
├── calendar/
│   └── ...
├── git-flow/
│   └── ...
├── notes/
│   └── ...
├── package.json                  # Root package.json for shared scripts
├── pnpm-workspace.yaml           # Workspace config
└── README.md
```

### 4.2 Root Package.json

```json
{
  "name": "moldable-apps",
  "version": "1.0.0",
  "private": true,
  "description": "Official Moldable apps collection",
  "scripts": {
    "lint": "turbo lint",
    "check-types": "turbo check-types",
    "build": "turbo build",
    "clean": "turbo clean"
  },
  "devDependencies": {
    "turbo": "^2.5.4"
  },
  "packageManager": "pnpm@9.0.0"
}
```

### 4.3 Apps Release Workflow

**`.github/workflows/release.yml`:**

```yaml
name: Release Apps

on:
  push:
    tags:
      - 'v*'

jobs:
  release:
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 22

      - name: Setup pnpm
        uses: pnpm/action-setup@v3
        with:
          version: 9

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Lint and type check
        run: |
          pnpm lint
          pnpm check-types

      - name: Create release
        uses: softprops/action-gh-release@v2
        with:
          generate_release_notes: true
          draft: false
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

### 4.4 App Version Manifest

Create a manifest file that the desktop can fetch to know about available apps:

**`apps-manifest.json` (generated and uploaded to releases):**

```json
{
  "version": "1.2.0",
  "updatedAt": "2026-01-15T12:00:00Z",
  "apps": [
    {
      "id": "scribo",
      "name": "Scribo Languages",
      "icon": "📓",
      "description": "Language learning journal with AI-powered translations",
      "path": "scribo",
      "version": "1.2.0",
      "commit": "abc123def456",
      "widgetSize": "medium",
      "requiredEnv": ["DEEPL_API_KEY"]
    },
    {
      "id": "meetings",
      "name": "Meeting Notes",
      "icon": "🎙️",
      "description": "Record, transcribe, and summarize meetings",
      "path": "meetings",
      "version": "1.2.0",
      "commit": "abc123def456",
      "widgetSize": "large",
      "requiredEnv": ["DEEPGRAM_API_KEY"]
    }
  ]
}
```

---

## 5. Migration Plan

### Phase 1: Update Directory Structure

1. **Update Rust backend** to use shared apps + workspace data structure
   - App code: `~/.moldable/shared/apps/{app}/`
   - App data: `~/.moldable/workspaces/{ws}/apps/{app}/`
   - Update `list_available_apps()` to scan shared apps directory
   - Update `start_app_internal()` to pass correct `MOLDABLE_APP_DATA_DIR` per workspace
   - Update `detect_app_in_folder()` to handle new structure
2. **Migrate existing installed apps** (if any) to shared location
3. **Update AGENTS.md** to document new structure for agent

### Phase 2: Prepare Packages for npm

1. Add `publishConfig` to `@moldable-ai/ui`, `@moldable-ai/editor`, `@moldable-ai/storage`
2. Set up changesets
3. Create npm organization `@moldable`
4. Test publishing workflow

### Phase 3: Create Apps Repository

1. Create `moldable/apps` repository
2. Copy apps from monorepo (without workspace references)
3. Update dependencies to use npm versions
4. Add `upstream` field to each `moldable.json`
5. Set up apps release workflow

### Phase 4: Desktop Update System

1. Add `tauri-plugin-updater` dependency
2. Generate signing keys
3. Configure `tauri.conf.json`
4. Implement update hook and UI
5. Set up release workflow with signing

### Phase 5: App Installation System

1. Implement app download/clone to `shared/apps/{app}/`
2. Run `pnpm install` in code directory
3. Auto-create `workspaces/{ws}/apps/{app}/` data dir on first run per workspace
4. Add "Browse Apps" UI in desktop
5. Connect to `moldable-ai/apps` repo for available apps

### Phase 6: App Update System

1. Implement `upstream` field support in desktop
2. Add modification detection for `code/` directory
3. Build update checking logic
4. Create update/merge UI
5. Implement detach functionality

---

## 6. Security Considerations

### 6.1 Desktop Updates

- All update bundles are **signed** with a private key
- Desktop verifies signatures before installing
- Keys stored securely in GitHub Secrets
- No unsigned updates can be installed

### 6.2 App Installation

- Apps are installed from known repository (`moldable/apps`)
- Users can inspect source before installing
- Required environment variables are declared upfront
- Network permissions are limited to declared endpoints

### 6.3 Third-Party Apps (Future)

When supporting third-party apps:

- Require verified publishers
- Scan for malicious code patterns
- Sandbox app filesystem access
- Audit network requests

---

## 7. User Experience

### 7.1 Desktop Update Flow

```
┌──────────────────────────────────────────────────────┐
│  User launches Moldable                              │
│                    ↓                                 │
│  Check for updates (background)                      │
│                    ↓                                 │
│  ┌─────────────────────────────────────────────────┐│
│  │ Update available? ────────────────────────────  ││
│  │       │                              │          ││
│  │       ▼ Yes                          ▼ No       ││
│  │  Show toast notification        Continue normal ││
│  │       │                                         ││
│  │       ▼                                         ││
│  │  User clicks "Update Now"                       ││
│  │       │                                         ││
│  │       ▼                                         ││
│  │  Download with progress                         ││
│  │       │                                         ││
│  │       ▼                                         ││
│  │  Verify & install                               ││
│  │       │                                         ││
│  │       ▼                                         ││
│  │  Relaunch automatically                         ││
│  └─────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────┘
```

### 7.2 App Update Flow

```
┌──────────────────────────────────────────────────────┐
│  App card shows update badge                         │
│                    ↓                                 │
│  User clicks badge or "Check for updates"            │
│                    ↓                                 │
│  ┌─────────────────────────────────────────────────┐│
│  │ App modified locally? ───────────────────────── ││
│  │       │                              │          ││
│  │       ▼ Yes                          ▼ No       ││
│  │  Show merge dialog              One-click update││
│  │       │                                         ││
│  │       ▼                                         ││
│  │  [Update & Merge] [Skip] [Detach]               ││
│  │       │                                         ││
│  │       ▼                                         ││
│  │  Attempt merge                                  ││
│  │       │                                         ││
│  │  ┌────┴────┐                                    ││
│  │  │         │                                    ││
│  │  ▼         ▼                                    ││
│  │Success   Conflicts                              ││
│  │  │         │                                    ││
│  │  ▼         ▼                                    ││
│  │Done    Show conflict                            ││
│  │        resolution UI                            ││
│  └─────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────┘
```

---

## 8. Success Metrics

| Metric                               | Target   |
| ------------------------------------ | -------- |
| Desktop update success rate          | > 99%    |
| Time from release to 50% adoption    | < 7 days |
| App update success rate (unmodified) | > 99%    |
| App merge success rate (modified)    | > 80%    |
| User satisfaction with update UX     | > 4/5    |

---

## Summary: Directory Structure

```
~/.moldable/
├── workspaces.json                              # Workspace list
├── shared/
│   └── .env                                     # Shared API keys
│
└── workspaces/
    └── {workspace-id}/                          # e.g., "personal"
        ├── config.json                          # App registry, preferences
        ├── .env                                 # Workspace-specific env overrides
        ├── conversations/                       # Chat history
        │
        └── apps/
            └── {app-id}/                        # e.g., "scribo"
                ├── code/                        # Source code (git-trackable)
                │   ├── moldable.json            # App manifest + upstream info
                │   ├── package.json
                │   ├── node_modules/
                │   └── src/
                │
                └── data/                        # Runtime data (gitignored)
                    ├── *.db                     # SQLite databases
                    └── uploads/                 # User files
```

| Item                      | Location                                       | Notes                           |
| ------------------------- | ---------------------------------------------- | ------------------------------- |
| Desktop app               | Standalone `.app`                              | Distributed via GitHub Releases |
| `@moldable-ai/*` packages | npm                                            | Published separately            |
| App source code           | `~/.moldable/shared/apps/{app}/`               | Shared across workspaces        |
| App runtime data          | `~/.moldable/workspaces/{ws}/apps/{app}/data/` | Workspace-scoped, gitignored    |
| Official apps repo        | `moldable-ai/apps` on GitHub                   | Source for installation         |
| Upstream tracking         | `moldable.json` in shared app dir              | For update detection            |

---

## 9. Open Questions

1. **App versioning:** Should each app have independent versions, or should all apps share the apps repo version?

2. **Conflict resolution UI:** How sophisticated should the merge conflict UI be? Simple "keep mine/take theirs" or full diff view?

3. **Rollback:** Should users be able to rollback desktop updates? App updates?

4. **Beta channel:** Should there be a beta update channel for early adopters?

5. **Offline updates:** How should we handle users who download updates manually (e.g., from a different machine)?
