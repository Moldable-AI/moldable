# Moldable Development Guidelines

## Project Overview

Moldable is a personal software factory - a desktop application where users prompt an AI agent to create, shape, and discard hyper-personalized applications directly on their local machine.

**Core concept**: Software is summoned, shaped, and discarded through natural language conversation.

**Key mechanics**:

- Users interact via a chat interface that hovers over all views
- The AI agent creates apps that run as local servers
- Apps are displayed within the desktop app via webviews
- Each app has a **widget view** (glanceable) and **full view** (expanded)
- Skills, MCPs, and sub-agents extend capabilities over time

See `prds/moldable.prd.md` for the complete product specification.

## Directory Structure

Moldable uses a **workspace-based** structure where data is isolated per workspace:

```
~/.moldable/                         # User data directory
├── workspaces.json                  # Workspace list + active workspace
│
├── shared/                          # Shared across ALL workspaces
│   ├── .env                         # Base environment variables (API keys)
│   ├── apps/                        # App source code (shared across workspaces)
│   │   ├── scribo/                  # Installed app source
│   │   │   ├── moldable.json
│   │   │   ├── package.json
│   │   │   └── src/
│   │   └── meetings/
│   ├── skills/                      # Skills library (instruction & executable)
│   │   └── {repo-name}/             # Skills grouped by source repo
│   │       └── {skill-name}/        # Individual skill (SKILL.md or bin/)
│   └── config/
│       └── mcp.json                 # Shared MCP servers
│
└── workspaces/                      # Per-workspace isolated data
    └── {workspace-id}/              # e.g., "personal", "work"
        ├── config.json              # Apps enabled, preferences
        ├── .env                     # Workspace-specific env overrides
        ├── apps/                    # App runtime data (workspace-scoped)
        │   ├── {app-id}/            # E.g. data for this app in this workspace
        │   │   └── data/            # App runtime data (SQLite, files, etc.)
        ├── conversations/           # Chat history
        └── config/
            ├── mcp.json             # Workspace-specific MCPs
            └── skills.json          # Which shared skills are enabled

/Users/{user}/moldable/              # Development workspace (monorepo)
├── desktop/                         # Tauri desktop app
├── packages/                        # Shared npm packages (@moldable-ai/*)
└── prds/                            # Product specifications

/Users/{user}/moldable-apps/         # Official apps repository (separate repo)
├── manifest.json                    # App registry for discovery
├── scribo/                          # Translation journal app
├── meetings/                        # Meeting recorder app
└── ...                              # Other official apps
```

### Workspaces

Workspaces allow isolating data between contexts (Personal, Work, Side Project, etc.):

- **Instant switching**: All apps from all workspaces run simultaneously
- **Shared apps**: App code is installed once in `shared/apps/`, data is per-workspace
- **Shared skills**: Skills are installed once, enabled per-workspace
- **Layered .env**: `shared/.env` provides base values, workspace `.env` overrides

## Tech Stack

### Desktop App

- **Framework**: Tauri v2 (Rust backend + Web frontend)
- **Frontend**: Vite + React 19 + TypeScript
- **Styling**: Tailwind CSS 4 + shadcn/ui
- **Package Manager**: pnpm

### Generated Apps (Default)

- **Framework**: Next.js 16 + React 19 + TypeScript
- **Styling**: Tailwind CSS 4 + shadcn/ui
- **Database**: SQLite (local) or Postgres (via Tilt/Docker)
- **API Layer**: tRPC (optional)
- **Package Manager**: pnpm

Note: The agent may use different stacks based on requirements (e.g., Python for data analysis).

## Development Commands

### Desktop

```bash
cd desktop
pnpm dev              # Run Vite dev server
pnpm tauri dev        # Run full Tauri app
pnpm tauri build      # Build for production
```

### Code Quality Checks

**IMPORTANT**: After completing code changes, ALWAYS run these from the repo root:

```bash
pnpm lint             # Run ESLint on all packages
pnpm check-types      # Run TypeScript compiler to check for errors
pnpm test             # Run tests (if applicable to the changed package)
```

Run these proactively to catch issues before the user does. Don't wait for errors to be reported.

## General Rules

- **kebab-case** for all file and directory names
- Split files into smaller parts - don't dump everything into single files
- Always install packages with `pnpm add` (or `pnpm add -D` for dev)
- **Prefer surgical edits over full rewrites** to minimize token costs

### What NOT to Do

- **NEVER start apps manually** - Moldable desktop handles app lifecycle (starting/stopping servers). The agent should only write code, not run dev servers.
- **NEVER use browser tools to test UI** - The user will test in Moldable's webviews. Don't use browser MCP tools to navigate or take screenshots.
- **NEVER run `pnpm dev` or similar** - Let the user start apps through Moldable's interface.

### Server/Client Code Separation

For library code that could be used on both server and client:

```
lib/
├── auth/
│   ├── server.ts      # Server-only (import "server-only")
│   └── react.ts       # Client-safe ("use client")
└── utils.ts           # Shared utilities
```

**Import patterns:**

```tsx
// ✅ Correct - explicit imports
import { getUser } from "@/lib/auth/server";
import { useAuth } from "@/lib/auth/react";

// ❌ Wrong - ambiguous
import { getUser } from "@/lib/auth";
```

### Type Safety

- Always use TypeScript with strict mode
- Define proper interfaces for all data structures
- Avoid using `any` type
- Use Zod for input validation

## UI Components (shadcn/ui)

- Use shadcn/ui components for consistent design
- Always use shadcn semantic colors (e.g., `bg-background`, `text-foreground`)
- Avoid raw Tailwind colors (e.g., `bg-gray-100`) - use semantic tokens
- Use Tailwind's `size-` where width and height are the same
- Utilize the `cn()` utility for conditional classes
- Keep components in `components/ui/` directory
- Install components: `pnpm dlx shadcn@latest add [component]`
- **All `<button>` elements MUST include `cursor-pointer` class** (unless disabled)

### Color Usage

```tsx
// ✅ Correct - semantic colors
<div className="bg-background text-foreground border-border" />
<button className="bg-primary text-primary-foreground" />
<p className="text-muted-foreground" />

// ❌ Wrong - raw colors
<div className="bg-white text-gray-900 border-gray-200" />
<div className="bg-zinc-950 text-zinc-100" />
```

### Icons

Use Lucide icons (installed with shadcn):

```tsx
import { Loader2, Plus, Settings } from 'lucide-react'
```

## UX Principles

### Design Philosophy

- Aspire to Linear's aesthetic: clean, minimal, focused
- Prioritize clarity and speed over decoration
- Use subtle animations and transitions sparingly
- Dense information display is fine - power users

### Theme System (Required)

All apps MUST use the shared theme system from `@moldable-ai/ui`:

1. **Wrap with ThemeProvider**: All apps must be wrapped with `<ThemeProvider>` from `@moldable-ai/ui`
2. **Use semantic colors**: Only use shadcn semantic color variables (e.g., `bg-background`, `text-foreground`) which auto-adapt to the theme
3. **Import shared styles**: Apps should `@import '@moldable-ai/ui/styles'` which contains both light and dark mode variable definitions

**Desktop app** (`main.tsx`):

```tsx
import { ThemeProvider } from '@moldable-ai/ui'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </React.StrictMode>,
)
```

**Next.js apps** (`app/layout.tsx`):

```tsx
import { ThemeProvider } from '@moldable-ai/ui'

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased">
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  )
}
```

**Using the theme** (in any component):

```tsx
import { useTheme } from '@moldable-ai/ui'

function MyComponent() {
  const { theme, resolvedTheme, setTheme } = useTheme()

  // theme: 'light' | 'dark' | 'system'
  // resolvedTheme: 'light' | 'dark' (actual applied theme)
  // setTheme: function to change theme

  return (
    <button
      onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
    >
      Toggle theme
    </button>
  )
}
```

**CSS setup** (`globals.css`):

```css
@import 'tailwindcss';
@import '@moldable-ai/ui/styles';
```

The `@moldable-ai/ui/styles` package defines CSS variables for both `:root` (light) and `.dark` (dark) themes. The ThemeProvider applies the appropriate class to the document and persists the user's preference to localStorage.

### Widget Views

- Glanceable information at a glance
- Touch-friendly (min 44x44px targets)
- Click/tap navigates to full app view

### Full App Views

- Fill the desktop container
- Provide full functionality
- Back navigation returns to canvas

## App Lifecycle

Apps run as separate processes managed by the desktop:

1. **Starting**: Desktop spawns the app server process
2. **Running**: App is accessible via its port
3. **Stopping**: Desktop terminates the process

The desktop polls app status and displays appropriate UI:

- Green dot = running
- Gray dot = stopped
- "Click to start" overlay when stopped

## Skills

Skills extend the agent's capabilities. They can be:

- **Instruction-based**: SKILL.md files that teach the agent how to perform tasks (synced from repos)
- **Executable**: CLI tools the agent can invoke directly

Skills are stored in the **shared** directory, grouped by source:

```
~/.moldable/shared/skills/
├── anthropic-skills/              # Synced from anthropics/skills repo
│   ├── pdf/
│   │   └── SKILL.md              # Instruction file
│   └── webapp-testing/
│       └── SKILL.md
└── custom-tools/                  # Custom executable skills
    └── translate-text/
        ├── skill.json            # Metadata
        ├── package.json          # Dependencies
        └── bin/translate.js      # Executable
```

Each workspace can enable/disable skills via `workspaces/{id}/config/skills.json`:

```json
{
  "enabledSkills": ["translate-text", "audio-transcribe"],
  "disabledSkills": ["company-internal-tool"]
}
```

**skill.json**:

```json
{
  "name": "translate-text",
  "description": "Translate text between languages",
  "version": "1.0.0",
  "input": {
    "type": "object",
    "properties": {
      "text": { "type": "string" },
      "from": { "type": "string" },
      "to": { "type": "string" }
    }
  }
}
```

**Usage**: `echo '{"text":"Hello","to":"fr"}' | translate-text`

## Configuration Files

### Workspaces Config (`~/.moldable/workspaces.json`)

Global workspace configuration:

```json
{
  "activeWorkspace": "personal",
  "workspaces": [
    {
      "id": "personal",
      "name": "Personal",
      "color": "#10b981",
      "createdAt": "2026-01-14T..."
    },
    {
      "id": "work",
      "name": "Work",
      "color": "#3b82f6",
      "createdAt": "2026-01-14T..."
    }
  ]
}
```

### Workspace Config (`~/.moldable/workspaces/{id}/config.json`)

Per-workspace app registry and settings:

```json
{
  "workspace": "/Users/rob/moldable",
  "apps": [
    {
      "id": "scribo",
      "name": "Scribo Languages",
      "icon": "✍️",
      "port": 3001,
      "path": "/Users/rob/moldable/apps/scribo",
      "command": "/opt/homebrew/bin/pnpm",
      "args": ["dev"],
      "widget_size": "medium",
      "requires_port": false
    }
  ]
}
```

**Note**: The `port` field is a _preferred_ starting port. At runtime, Moldable will:

1. Check if the port is available
2. If not, find the next free port automatically (unless `requires_port: true`)
3. Pass `-p <port> --hostname 127.0.0.1` to the app command

### Environment Variables

Moldable uses **layered environment variables**:

1. **Shared** (`~/.moldable/shared/.env`) — Base values for all workspaces
2. **Workspace** (`~/.moldable/workspaces/{id}/.env`) — Overrides for specific workspace

```bash
# shared/.env (API keys used everywhere)
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...

# workspaces/work/.env (work-specific overrides)
OPENAI_API_KEY=sk-work-...  # Override for work context
COMPANY_API_KEY=secret      # Work-only key
```

Apps declare required env vars in their `moldable.json` manifest.

## MCPs (Model Context Protocol)

Configure in `~/.moldable/shared/config/mcp.json` (shared) or `~/.moldable/workspaces/{id}/config/mcp.json` (workspace-specific):

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@anthropic-ai/mcp-filesystem", "/Users/me"]
    },
    "custom-api": {
      "command": "node",
      "args": ["~/.moldable/mcps/custom-api/index.js"]
    }
  }
}
```

## Git-Native Version Control

The `~/.moldable/` directory should be a Git repo:

- Agent auto-commits changes with descriptive messages
- Push to GitHub for backup/sync
- Create releases via tags
- Rollback via `git checkout`

## Branding

- **Domain**: `moldable.sh`
- **GitHub Org**: `moldable-ai`
- **npm Scope**: `@moldable-ai/*`

## References

- **Website**: https://moldable.sh
- **Full PRD**: `prds/moldable.prd.md`
- **Claude Agent SDK**: https://platform.claude.com/docs/en/agent-sdk/overview
- **Dynamic Context Discovery**: https://cursor.com/blog/dynamic-context-discovery
- **Tauri v2**: https://v2.tauri.app/
