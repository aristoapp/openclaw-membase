<h1 align="center">Membase Plugin for OpenClaw</h1>

[![Membase banner](https://github.com/user-attachments/assets/19393af8-7af0-4e8f-9967-b5c9d8119d83)](https://membase.so/?utm_source=github&utm_medium=openclaw-membase)

<p align="center">
  Persistent long-term memory for OpenClaw — hybrid vector search + knowledge graph.
</p>

<p align="center">
  <a href="https://x.com/intent/follow?screen_name=mem_base"><img src="https://img.shields.io/badge/Follow%20on%20X-000000?style=for-the-badge&logo=x&logoColor=white" alt="Follow on X"></a>
  <a href="https://www.linkedin.com/company/aristotechnologies"><img src="https://img.shields.io/badge/Follow%20on%20LinkedIn-0A66C2?style=for-the-badge&logo=linkedin&logoColor=white" alt="Follow on LinkedIn"></a>
  <a href="https://discord.gg/qfzXNdtmkv"><img src="https://img.shields.io/badge/Join%20Our%20Discord-5865F2?style=for-the-badge&logo=discord&logoColor=white" alt="Join Our Discord"></a>
</p>

<p align="center">
  <a href="https://membase.so/?utm_source=github&utm_medium=openclaw-membase">Website</a> · <a href="https://docs.membase.so">Docs</a> · <a href="https://app.membase.so">Dashboard</a> · <a href="https://github.com/aristoapp/openclaw-membase/issues">Issues</a>
</p>

---

Give your [OpenClaw](https://openclaw.ai/) agent persistent memory that survives across sessions. Membase uses hybrid vector search + knowledge graph to remember not just text, but entities, relationships, and facts.

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

```txt
User message
    │
    ▼
┌─────────────────────────┐
│  Auto-Recall            │  Searches Membase for relevant memories
│  (before_agent_start)   │  and injects them as context
└───────────┬─────────────┘
            ▼
┌─────────────────────────┐
│  AI Response            │  Agent can also call membase_search,
│                         │  membase_store, etc. autonomously
└───────────┬─────────────┘
            ▼
┌─────────────────────────┐
│  Auto-Capture           │  Buffers messages, flushes to Membase
│  (agent_end)            │  for entity/relationship extraction
└───────────┬─────────────┘
            ▼
┌─────────────────────────┐
│  Membase Backend        │  Hybrid vector search + knowledge graph
│  (api.membase.so)       │
└─────────────────────────┘
```

- **Auto-Recall** — Before every AI turn, searches your memories by semantic similarity and injects relevant context. Skips casual chat and short messages. Respects a `maxRecallChars` budget (default 4000) to avoid oversized context.
- **Auto-Capture** — After conversations, buffers messages and sends them to Membase for extraction. Entities and relationships are automatically extracted into a knowledge graph. Flushes after 5 minutes of silence or 20 messages.
- **Knowledge Graph** — Unlike simple vector-only memory, Membase uses hybrid vector search + knowledge graph to store entities, relationships, and facts. Search results include related nodes and edges for richer context.

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
| **Storage** | Flat embeddings | Hybrid: vector embeddings + knowledge graph |
| **Search** | Vector similarity only | Vector + graph traversal (entities, relationships, facts) |
| **Extraction** | Store raw text | AI-powered entity/relationship extraction |
| **Auth** | API key | OAuth 2.0 with PKCE (no secrets to manage) |
| **Ingest** | Synchronous | Async pipeline (~100ms response, background graph sync) |

## Development

```bash
git clone https://github.com/aristoapp/openclaw-membase.git
cd openclaw-membase
bun install
bun run check-types
bun run lint
bun run build
```

## Contributing

Contributions welcome — see [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines.

## Links

- [Membase](https://membase.so/?utm_source=github&utm_medium=openclaw-membase) — Website
- [Dashboard](https://app.membase.so) — Manage your memories
- [Docs](https://docs.membase.so) — Full documentation
- [OpenClaw](https://openclaw.ai/) — AI agent framework

## License

[MIT](./LICENSE)
