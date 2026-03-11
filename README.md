<p align="center">
  <img src="https://membase.so/icon.png" alt="Membase" width="80" />
</p>

<h1 align="center">Membase for OpenClaw</h1>

<p align="center">
  Persistent long-term memory for AI agents, powered by a hybrid vector + knowledge graph engine.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@membase/openclaw-membase"><img src="https://img.shields.io/npm/v/@membase/openclaw-membase.svg" alt="npm version" /></a>
  <a href="https://github.com/membase-ai/openclaw-membase/blob/main/LICENSE"><img src="https://img.shields.io/npm/l/@membase/openclaw-membase.svg" alt="license" /></a>
  <a href="https://www.npmjs.com/package/@membase/openclaw-membase"><img src="https://img.shields.io/npm/dm/@membase/openclaw-membase.svg" alt="downloads" /></a>
</p>

<p align="center">
  <a href="https://membase.so">Website</a> · <a href="https://docs.membase.so">Docs</a> · <a href="https://app.membase.so">Dashboard</a> · <a href="https://github.com/membase-ai/openclaw-membase/issues">Issues</a>
</p>

---

Give your [OpenClaw](https://openclaw.com) AI agent persistent memory that survives across sessions. Unlike simple vector stores, Membase combines **semantic vector search** with a **Neo4j knowledge graph** — so your agent remembers not just text, but entities, relationships, and facts.

## Features

- **Auto-Recall** — Relevant memories are injected before every AI turn, silently enriching responses
- **Auto-Capture** — Conversations are automatically extracted into entities, relationships, and facts
- **Knowledge Graph** — Hybrid vector + graph search via [Graphiti](https://github.com/getzep/graphiti) and Neo4j
- **OAuth PKCE** — Secure authentication with no API keys to manage
- **4 AI Tools** — `membase_search`, `membase_store`, `membase_forget`, `membase_profile`

## Quick Start

```bash
# Install the plugin
openclaw plugins install @membase/openclaw-membase

# Authenticate (opens browser)
openclaw membase login
```

Restart OpenClaw after installing. That's it — memory works automatically.

## How It Works

```
User message
    │
    ▼
┌─────────────────────┐
│  Auto-Recall Hook   │  Searches memories, injects relevant context
│  (before_agent_start)│  before the AI responds
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│     AI Response      │  Agent can also call membase_search,
│                      │  membase_store, etc. autonomously
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│  Auto-Capture Hook  │  Buffers conversation, flushes to Membase
│  (agent_end)        │  for entity/relationship extraction
└─────────────────────┘
          │
          ▼
┌─────────────────────┐
│  Membase Backend    │  Vector embeddings + Neo4j knowledge graph
│  (api.membase.so)   │  via Graphiti extraction pipeline
└─────────────────────┘
```

## AI Tools

The agent uses these tools autonomously during conversations:

| Tool | Description |
| --- | --- |
| `membase_search` | Semantic search across stored memories. Returns episode bundles with related entities and facts. |
| `membase_store` | Save important information to long-term memory. Proactively stores preferences, goals, and context. |
| `membase_forget` | Delete a memory. Two-step: shows matches first, then deletes after user confirmation. |
| `membase_profile` | Retrieve user profile and related memories for session context. |

## CLI Commands

```bash
openclaw membase login              # OAuth login (PKCE) — opens browser
openclaw membase logout             # Remove stored tokens
openclaw membase search <query>     # Search memories from terminal
openclaw membase status             # Check API connectivity
```

## Configuration

All configuration is managed through OpenClaw's plugin settings or `~/.openclaw/openclaw.json`:

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `apiUrl` | string | `https://api.membase.so` | Membase API URL. Override for self-hosted. |
| `autoRecall` | boolean | `true` | Inject relevant memories before every AI turn. |
| `autoCapture` | boolean | `true` | Automatically store conversations to memory. |
| `maxRecallChars` | number | `4000` | Max characters of memory context per turn (500–16000). |
| `debug` | boolean | `false` | Enable verbose debug logs. |

```json
{
  "plugins": {
    "entries": {
      "openclaw-membase": {
        "enabled": true,
        "config": {
          "autoRecall": true,
          "autoCapture": true,
          "maxRecallChars": 4000
        }
      }
    }
  }
}
```

## How Membase Differs

| | Simple vector memory | **Membase** |
| --- | --- | --- |
| **Storage** | Flat embeddings | Hybrid: vector embeddings + Neo4j knowledge graph |
| **Search** | Vector similarity only | Vector + graph traversal (entities, relationships, facts) |
| **Extraction** | Store raw text | AI-powered entity/relationship extraction via Graphiti |
| **Auth** | API key | OAuth 2.0 with PKCE (no secrets to manage) |
| **Ingest** | Synchronous | Async pipeline (~100ms response, background graph sync) |

## Development

```bash
# Clone
git clone https://github.com/membase-ai/openclaw-membase.git
cd openclaw-membase

# Install dependencies
bun install

# Type check
bun run check-types

# Lint
bun run lint

# Build
bun run build
```

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines.

## Links

- [Membase App](https://app.membase.so) — Dashboard for managing memories
- [Membase Docs](https://docs.membase.so) — Full documentation
- [OpenClaw](https://openclaw.com) — AI agent framework

## License

[MIT](./LICENSE)
