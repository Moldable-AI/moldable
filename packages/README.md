# @moldable-ai packages

This directory contains the shared npm packages published under the `@moldable-ai` scope.

## Packages

| Package                  | Description                                 |
| ------------------------ | ------------------------------------------- |
| `@moldable-ai/ai`        | AI client, providers, and tool definitions  |
| `@moldable-ai/ai-server` | Server-side AI utilities                    |
| `@moldable-ai/editor`    | Lexical-based markdown editor components    |
| `@moldable-ai/mcp`       | Model Context Protocol client and utilities |
| `@moldable-ai/storage`   | Local storage utilities                     |
| `@moldable-ai/ui`        | Shared React components and theme system    |

Internal packages (not published to npm):

- `eslint-config` - Shared ESLint configuration
- `prettier-config` - Shared Prettier configuration
- `typescript-config` - Shared TypeScript configuration

## Publishing

Packages are published automatically via GitHub Actions using [Changesets](https://github.com/changesets/changesets).

### How it works

1. **Create a changeset** when making changes:

   ```bash
   pnpm changeset
   ```

   This creates a markdown file in `.changeset/` describing your change.

2. **Merge to main** — the workflow creates a "Version Packages" PR that:
   - Bumps versions in `package.json` files
   - Updates `CHANGELOG.md` files
   - Deletes the changeset files

3. **Merge the Version PR** — packages are published to npm automatically.

### npm Authentication

We use **npm Trusted Publishing** (OIDC) for secure, tokenless authentication from GitHub Actions.

#### Initial Setup (first-time publish)

New packages can't use Trusted Publishing until they exist on npm. Bootstrap with a temporary token:

1. Create a [Granular Access Token](https://www.npmjs.com/settings/~/tokens) on npm:
   - Scope: `@moldable-ai/*`
   - Permissions: Read and write
   - Expiration: 7 days (short-lived for security)

2. Add as `NPM_TOKEN` secret in GitHub repo settings

3. Trigger the release workflow

4. After packages are published, configure Trusted Publishing (see below)

5. Delete the `NPM_TOKEN` secret from GitHub

#### Configuring Trusted Publishing

For each published package on npmjs.com:

1. Go to the package → **Settings** → **Publishing access**
2. Under **Trusted publishing**, click **Add trusted repository**
3. Configure:
   - **Repository owner**: `moldable-ai`
   - **Repository name**: `moldable`
   - **Workflow filename**: `release-packages.yml`
   - **Environment**: (leave blank)

Once configured for all packages, the workflow authenticates via OIDC without needing any stored tokens.

### Manual Publishing (emergency)

If you need to publish manually:

```bash
# Build all packages
pnpm build:packages

# Publish (requires npm login with 2FA)
pnpm -r publish --access public
```

## Development

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build:packages

# Run tests
pnpm test

# Type check
pnpm check-types

# Lint
pnpm lint
```
