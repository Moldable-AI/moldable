# Moldable: Personal software. Built for change.

Your personal operating system for software that doesn't exist yet.

![Moldable AI](https://moldable.sh/hero.png)

## What is Moldable?

Moldable is for people who refuse to settle for software built for everyone else.

Instead of buying apps or hoping someone builds what you need, you describe it — and Moldable creates it. A meeting recorder that works exactly how you think. A candidate tracker that synthesizes resumes the way you evaluate them. A translation journal for the language you're learning. If you can dream it, you can build it.

**Everything runs locally on your machine.** Your apps, your data, your rules. Connect to APIs when you want the power of AI or cloud services — but the code and data live on your computer, not someone else's servers.

Organize your apps into **workspaces** — Personal, Work, Side Projects — each isolated with its own data and configuration. Switch instantly between contexts without losing state.

**Website**: [moldable.sh](https://moldable.sh)

## Repository Structure

This monorepo contains the **desktop app** and **shared packages**. Official apps are in a [separate repository](https://github.com/moldable-ai/apps).

```
moldable/
├── desktop/              # Tauri desktop app (Rust + React)
├── packages/
│   ├── ui/               # @moldable-ai/ui - Shared UI components
│   ├── editor/           # @moldable-ai/editor - Lexical markdown editor
│   ├── storage/          # @moldable-ai/storage - File storage utilities
│   ├── ai/               # AI utilities (internal)
│   ├── ai-server/        # AI server sidecar (internal)
│   ├── mcp/              # MCP client (internal)
│   ├── eslint-config/    # Shared ESLint config
│   ├── prettier-config/  # Shared Prettier config
│   └── typescript-config/# Shared TypeScript config
└── prds/                 # Product specifications
```

## Related Repositories

| Repository                                                      | Description                               |
| --------------------------------------------------------------- | ----------------------------------------- |
| [moldable-ai/moldable](https://github.com/moldable-ai/moldable) | Desktop app & shared packages (this repo) |
| [moldable-ai/apps](https://github.com/moldable-ai/apps)         | Official Moldable apps collection         |

## Packages

Published to npm under the `@moldable-ai` scope:

| Package                                                                      | Description                         |
| ---------------------------------------------------------------------------- | ----------------------------------- |
| [`@moldable-ai/ui`](https://www.npmjs.com/package/@moldable-ai/ui)           | UI components, theme system, shadcn |
| [`@moldable-ai/editor`](https://www.npmjs.com/package/@moldable-ai/editor)   | Rich text markdown editor (Lexical) |
| [`@moldable-ai/storage`](https://www.npmjs.com/package/@moldable-ai/storage) | Filesystem storage utilities        |

## Tech Stack

![Tauri](https://img.shields.io/badge/Tauri-v2-24C8D8?logo=tauri) ![React](https://img.shields.io/badge/React-19-61DAFB?logo=react) ![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript) ![Tailwind CSS](https://img.shields.io/badge/Tailwind-4-06B6D4?logo=tailwindcss) ![pnpm](https://img.shields.io/badge/pnpm-9-F69220?logo=pnpm) ![License](https://img.shields.io/badge/License-Elastic--2.0-blue)

- **Desktop**: Tauri v2 (Rust backend + React frontend)
- **Frontend**: Vite + React 19 + TypeScript
- **Generated Apps**: Next.js 15+ + React 19 + TypeScript
- **Styling**: Tailwind CSS 4 + shadcn/ui
- **Package Manager**: pnpm

## Prerequisites

- Node.js 22+
- pnpm 9+
- Rust (for Tauri desktop app)

## Getting Started

```bash
# Clone the repo
git clone https://github.com/moldable-ai/moldable.git
cd moldable

# Install dependencies
pnpm install

# Build shared packages
pnpm build:packages

# Run the desktop app
pnpm desktop
```

## Development

```bash
# Run desktop app in dev mode
pnpm desktop

# Build packages (required after changes)
pnpm build:packages

# Watch mode for packages (rebuilds on changes)
pnpm dev

# Run tests
pnpm test

# Lint & type check
pnpm lint
pnpm check-types
```

## Creating a Release

This repo uses [Changesets](https://github.com/changesets/changesets) for versioning:

```bash
# Create a changeset
pnpm changeset

# Version packages (automated via GitHub Actions)
pnpm version-packages

# Publish to npm (automated via GitHub Actions)
pnpm release
```

## License

[Elastic License 2.0 (ELv2)](LICENSE)
