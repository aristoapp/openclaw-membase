# Remember Reviewed X/Twitter Signals From TweetClaw

Use this workflow when the same OpenClaw workspace needs structured public X/Twitter data and persistent memory. TweetClaw gathers the public source material, then Membase stores reviewed summaries, source URLs, and follow-up decisions.

## Install The Plugins

```bash
openclaw plugins install clawhub:@xquik/tweetclaw
openclaw plugins install @membase/openclaw-membase
openclaw config set tools.alsoAllow '["explore", "tweetclaw", "openclaw-membase"]'
```

Keep credentials in the plugin that owns them:

- TweetClaw keeps `XQUIK_API_KEY` in its OpenClaw plugin configuration. Never
  paste the key into chats, prompts, logs, or memory.
- Membase keeps OAuth tokens in its `tokenFile`, outside the plugin directory.
- Do not store API keys, OAuth tokens, direct message contents, or raw private account exports in memory.

## Capture Public Signals

Use TweetClaw's free `explore` tool to identify the right endpoint, then use
the optional `tweetclaw` tool for public X/Twitter source material:

- Search tweets or search tweet replies for a launch, incident, competitor, keyword, or support topic.
- Monitor tweets and webhooks for recurring public mentions.
- Export public follower context or run user lookup when the audience or author matters.
- Record giveaway draw results with the source tweet URL and draw criteria.
- Use post tweets or post tweet replies only after the OpenClaw user approves the visible action.

## Store A Reviewed Wiki Document

After reviewing the TweetClaw result, use `membase_add_wiki` to store a compact
document in a Project such as `X Research`. Include:

- Source: `tweetclaw`
- Capture date
- Tweet URL or tweet ID
- Author handle when relevant
- Short summary
- Sentiment or category if useful
- Next action or decision

Example memory content:

```text
Source: TweetClaw
Captured: YYYY-MM-DD
Topic: billing launch feedback
Source URLs: https://x.com/example/status/123
Summary: Users asked whether annual plans include API credits.
Decision: Update the launch FAQ before the next announcement.
```

## Recall Later

Use `membase_search_wiki` to recover the reviewed X/Twitter context without
fetching every source again. `autoWikiRecall` can inject relevant Wiki context
automatically. Keep each document durable and compact: store facts, source URLs,
and decisions, not full timelines or private data.

Xquik is an independent third-party service. Not affiliated with X Corp.
"Twitter" and "X" are trademarks of X Corp.
