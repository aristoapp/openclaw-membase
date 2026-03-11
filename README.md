<p align="center">
  <img src="https://membase.so/icon.png" alt="Membase" width="80" />
</p>

<h1 align="center">Membase for OpenClaw</h1>

<p align="center">
  Persistent long-term memory for AI agents — hybrid vector search + knowledge graph.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@membase/openclaw-membase"><img src="https://img.shields.io/npm/v/@membase/openclaw-membase.svg" alt="npm" /></a>
  <a href="https://www.npmjs.com/package/@membase/openclaw-membase"><img src="https://img.shields.io/npm/dm/@membase/openclaw-membase.svg" alt="downloads" /></a>
  <a href="https://github.com/membase-ai/openclaw-membase/blob/main/LICENSE"><img src="https://img.shields.io/npm/l/@membase/openclaw-membase.svg" alt="license" /></a>
</p>

<p align="center">
  <a href="https://membase.so">Website</a> · <a href="https://docs.membase.so">Docs</a> · <a href="https://app.membase.so">Dashboard</a> · <a href="https://github.com/membase-ai/openclaw-membase/issues">Issues</a>
</p>

---

Give your [OpenClaw](https://openclaw.com) agent persistent memory that survives across sessions. Unlike simple vector stores, Membase combines **semantic vector search** with a **Neo4j knowledge graph** — so your agent remembers not just text, but entities, relationships, and facts.

> **Free to start** — Sign up at [app.membase.so](https://app.membase.so) and connect in under a minute.

## Install

```bash
openclaw plugins install @membase/openclaw-membase
```

Restart OpenClaw after installing.

## Setup

```bash
openclaw membase login
```

Opens a browser for OAuth authentication. Tokens are saved automatically — no API keys to copy-paste. That's it, memory works automatically from here.

## How It Works

Once installed, the plugin runs two hooks behind the scenes:

```
User message
    │
    ▼
┌─────────────────────────┐
│  Auto-Recall             │  Searches Membase for relevant memories
│  (before_agent_start)    │  and injects them as context
└───────────┬─────────────┘
            ▼
┌─────────────────────────┐
│  AI Response             │  Agent can also call membase_search,
│                          │  membase_store, etc. autonomously
└───────────┬─────────────┘
            ▼
┌─────────────────────────┐
│  Auto-Capture            │  Buffers messages, flushes to Membase
│  (agent_end)             │  for entity/relationship extraction
└───────────┬─────────────┘
            ▼
┌─────────────────────────┐
│  Membase Backend         │  Vector embeddings + Neo4j graph
│  (api.membase.so)        │  via Graphiti extraction pipeline
└─────────────────────────┘
```

- **Auto-Recall** — Before every AI turn, searches your memories by semantic similarity and injects relevant context. Skips casual chat and short messages. Respects a `maxRecallChars` budget (default 4000) to avoid oversized context.
- **Auto-Capture** — After conversations, buffers messages and sends them to Membase for extraction. Entities and relationships are automatically extracted into a knowledge graph via [Graphiti](https://github.com/getzep/graphiti). Flushes after 5 minutes of silence or 20 messages.
- **Knowledge Graph** — Unlike simple vector-only memory, Membase stores entities, relationships, and facts in Neo4j. Search results include related nodes and edges for richer context.

## AI Tools

The agent uses these tools autonomously during conversations:

| Tool | Description |
| --- | --- |
| `membase_search` | Search memories by semantic similarity. Returns episode bundles with related facts. |
| `membase_store` | Save important information to long-term memory. Proactively stores preferences, goals, and context. |
| `membase_forget` | Delete a memory. Shows matches first, then deletes after user confirmation (two-step). |
| `membase_profile` | Retrieve user profile and related memories for session context. |

## CLI Commands

```bash
openclaw membase login              # OAuth login (PKCE) — opens browser
openclaw membase logout             # Remove stored tokens
openclaw membase search <query>     # Search memories
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

OAuth tokens (`accessToken`, `refreshToken`, `clientId`) are managed automatically by `openclaw membase login`.

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
git clone https://github.com/membase-ai/openclaw-membase.git
cd openclaw-membase
bun install
bun run check-types
bun run lint
bun run build
```

## Contributing

Contributions welcome — see [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines.

## Links

- [Membase](https://membase.so) — Website
- [Dashboard](https://app.membase.so) — Manage your memories
- [Docs](https://docs.membase.so) — Full documentation
- [OpenClaw](https://openclaw.com) — AI agent framework

## License

[MIT](./LICENSE)
