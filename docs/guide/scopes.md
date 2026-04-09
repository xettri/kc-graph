# Scoped Environments

Scopes let you maintain separate indexed snapshots of your projects per environment. Index your `develop` branches into one scope, `prod` into another, and query them independently through the MCP server.

## Why Scopes

Without scopes, `kc-graph init` creates one graph per project. When you switch branches and sync, the graph overwrites. With scopes, each environment gets its own isolated storage:

```bash
# Index the same project under two scopes
git checkout develop
kc-graph init --global --scope develop

git checkout main
kc-graph init --global --scope prod
```

Now you have two independent graphs for the same project. The AI connected to the `develop` scope sees only develop code. No cross-contamination.

## Quick Start

```bash
# Set your active scope
kc-graph scope use develop

# Index projects (scope is inherited from active scope)
kc-graph init --global ~/work/api-gateway
kc-graph init --global ~/work/auth-service
kc-graph init --global ~/work/web-app

# Start MCP server for this scope
kc-graph mcp --global
```

Or pass `--scope` explicitly on each command:

```bash
kc-graph init --global --scope develop ~/work/api-gateway
kc-graph mcp --global --scope develop
```

Configure Claude Code:

```bash
claude mcp add kc-graph -- kc-graph mcp --global --scope develop
```

## Scope Resolution

When you run any command, kc-graph determines the scope using this priority:

| Priority | Source | Example |
|----------|--------|---------|
| 1 (highest) | `--scope` flag | `kc-graph sync --scope prod` |
| 2 | `KC_GRAPH_SCOPE` env var | `KC_GRAPH_SCOPE=staging kc-graph sync` |
| 3 | Active scope in `config.json` | Set via `kc-graph scope use develop` |
| 4 (lowest) | Default | `"default"` |

If you never use `--scope` and never set an active scope, everything goes into the `default` scope. This is identical to how kc-graph worked before scopes existed.

## Managing Scopes

### Show active scope

```bash
kc-graph scope
# Active scope: develop
```

### Set active scope

```bash
kc-graph scope use develop
# Active scope set to: develop
```

All subsequent commands use `develop` unless overridden with `--scope`.

### Reset to default

```bash
kc-graph scope reset
# Active scope reset to: default
```

Or equivalently:

```bash
kc-graph scope use default
```

### List scopes

```bash
kc-graph scope list --global
```

Output:

```
  SCOPE       PROJECTS  LAST SYNC
* develop     5         10m ago
  staging     3         1d ago
  default     5         2h ago
```

`*` marks the active scope.

Without `--global`, lists local scopes in the current project's `.kc-graph/`.

### Delete a scope

```bash
kc-graph scope delete staging --global --force
# Scope 'staging' deleted.
```

`--force` is required to confirm deletion. The `default` scope cannot be deleted.

## Scope Naming

Scope names must:

- Start with a lowercase letter
- Contain only lowercase letters, numbers, and hyphens
- Be 1-50 characters

Valid: `develop`, `prod`, `feature-x`, `release-v2`

Invalid: `Develop`, `my_scope`, `2024-release`, `my scope`

## Storage Layout

Each scope is a self-contained directory:

```
~/.kc-graph/                    # global root
  config.json                   # { "activeScope": "develop" }
  default/
    scope.json
    registry.json
    projects/<id>/chunks/...
  develop/
    scope.json
    registry.json
    projects/<id>/chunks/...
```

Local storage follows the same pattern:

```
.kc-graph/
  default/
    scope.json
    meta.json, map.json, chunks/
  develop/
    scope.json
    meta.json, map.json, chunks/
```

## Scope + Global/Local Matrix

Scopes work with both local and global storage:

| Command | Storage Location |
|---------|-----------------|
| `kc-graph init` | `.kc-graph/default/` |
| `kc-graph init --scope develop` | `.kc-graph/develop/` |
| `kc-graph init --global` | `~/.kc-graph/default/projects/<id>/` |
| `kc-graph init --global --scope develop` | `~/.kc-graph/develop/projects/<id>/` |

Same for `sync`, `mcp`, `view`, `watch`, `status`, `setup`.

## Strict Isolation

Scopes are strictly isolated. An MCP server running under `develop` scope has zero visibility into `default` or any other scope. No fallback, no mixing.

```bash
# This MCP server ONLY sees projects indexed under 'develop'
kc-graph mcp --global --scope develop
```

If a project exists in `default` but not in `develop`, it simply doesn't exist for that MCP server.

## Bulk Sync

Sync all projects in a scope at once without specifying paths:

```bash
# Sync all globally registered projects in the active scope
kc-graph sync --global

# Sync all projects in a specific scope
kc-graph sync --global --scope develop
```

Output:

```
[scope: develop] Syncing 5 projects...
[scope: develop]   api-gateway: +2, ~1
[scope: develop]   auth-service: up to date
[scope: develop]   payment-service: ~3
[scope: develop]   web-app: +1
[scope: develop]   admin-panel: up to date
[scope: develop] Done. +3 added, ~4 updated, -0 removed
```

To sync a single project, pass the path:

```bash
kc-graph sync --global --scope develop ~/work/api-gateway
```

## Branch Safety

When you index a project, kc-graph records the current git branch. On sync, if the branch has changed, you get a warning:

```
Warning: api-gateway was indexed on 'develop' but is currently on 'main'
Use --force to sync anyway, or switch to 'develop' first.
```

This prevents accidentally indexing the wrong branch into a scope. Use `--force` to override:

```bash
kc-graph sync --global --scope develop --force
```

Non-git projects skip this check entirely.

## Output Prefix

When using a non-default scope, all command output is prefixed with the scope name:

```
[scope: develop] Indexing ~/work/api-gateway ...
[scope: develop] Done in 1.2s
```

When the scope is `default`, no prefix is shown. This way existing output is unchanged for users who don't use scopes.

## Environment Variable

Set `KC_GRAPH_SCOPE` to override the active scope for a session or in CI:

```bash
export KC_GRAPH_SCOPE=staging
kc-graph sync --global    # uses 'staging' scope
kc-graph mcp --global     # serves 'staging' scope
```

`--scope` flag still takes highest priority if both are set.

## Removing Projects

Remove a project's indexed data from a scope:

```bash
# Remove local project
kc-graph remove --force

# Remove a specific global project
kc-graph remove ~/work/api-gateway --global --scope develop --force

# Remove entire scope (all projects)
kc-graph scope delete develop --global --force
```

`--force` is required for both commands.

## Static MCP Mode

If your indexed projects are stable and won't change, disable the auto-reload check for zero overhead:

```bash
kc-graph mcp --global --no-reload
```

The MCP server loads graphs once at startup and never checks for updates. Use this in CI or when serving a fixed snapshot.

## Programmatic API

All scope functions are exported from the `kc-graph` package:

```typescript
import {
  resolveScope,
  validateScopeName,
  getActiveScope,
  setActiveScope,
  resetActiveScope,
  listScopes,
  scopeExists,
  deleteScope,
  ensureScopeDir,
  scopePath,
  detectGitBranch,
  DEFAULT_SCOPE,
} from 'kc-graph';
```

### Resolve scope with priority chain

```typescript
const scope = resolveScope('develop');  // explicit
const scope = resolveScope();           // env > config > "default"
```

### Manage active scope

```typescript
setActiveScope('develop');
console.log(getActiveScope()); // "develop"
resetActiveScope();
console.log(getActiveScope()); // "default"
```

### List and inspect scopes

```typescript
const scopes = listScopes(true); // global scopes
for (const s of scopes) {
  console.log(`${s.name}: ${s.projectCount} projects, active=${s.active}`);
}
```

### Use with storage APIs

```typescript
import { initProject, syncProject, resolveStore, loadAllGlobalProjects } from 'kc-graph';

// Init with scope
await initProject({ root: '/path/to/project', global: true, scope: 'develop' });

// Sync with scope
await syncProject({ root: '/path/to/project', global: true, scope: 'develop' });

// Load all projects in a scope
const projects = loadAllGlobalProjects('develop');
```
