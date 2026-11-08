# RapidTextAI MCP Server

![Node 18+](https://img.shields.io/badge/node-%3E%3D18-brightgreen) ![Dependencies](https://img.shields.io/badge/dependencies-0-blue) ![MCP](https://img.shields.io/badge/protocol-MCP-black)

Give your AI assistant a research desk. This [Model Context Protocol](https://modelcontextprotocol.io) server lets **Claude, Cursor, Windsurf and any MCP client** write researched articles and run SEO checks through your own [RapidTextAI](https://app.rapidtextai.com) API key.

> "Find what's missing from the top results for *project management software*, write the article from that outline, then fact-check it."

With this server connected, the assistant can do exactly that in one conversation.

## Why use it

- **Agents that can actually research and publish.** Live web research, cited sources and fact checking, not just a language model's memory.
- **Chain tools in plain English.** Ask for gap analysis, then an article from that outline, then a fact check and originality check. The assistant decides the order.
- **Safe by design.** Input is validated before any request units are spent, SEO tools are marked read-only, and costs are stated in every tool description so the assistant can tell you before it spends.
- **Works everywhere MCP does.** Standard stdio transport. Progress updates are streamed while long jobs run (articles take 1-3 minutes), and cancelling from the client aborts the request.
- **Zero dependencies.** Plain Node.js, one small codebase you can read in ten minutes.

## Tools

| Tool | What it does | Units |
|---|---|---|
| `generate_article` | Researched, SEO-ready article with FAQ and cited sources | 6 |
| `competitor_gap` | Outline, target length and gaps from the top-ranking pages for a keyword | 5 |
| `content_refresh` | Find outdated statements in a post and propose cited updates | 6 |
| `fact_check` | Verify up to 10 claims against live evidence, with a 0-100 score | 6 |
| `originality_check` | Spot-check for text copied from existing pages | 3 |
| `brand_from_url` | Suggest a brand voice profile from a website | 2 |
| `find_embeds` | Verified tweets and videos to embed under given headings | 1 |
| `list_models` | Models available to your key | free |
| `check_capabilities` | Which features your server has enabled | free |

## Requirements

- [Node.js](https://nodejs.org) 18 or newer
- A RapidTextAI account and API key (<https://app.rapidtextai.com>)

## Install

```bash
git clone https://github.com/alisaleem252/rapidtextai-mcp.git
cd rapidtextai-mcp
```

No `npm install` is needed. Note the full path to `bin/server.js`; you'll use it below.

## Connect your client

Pass the key through the client's `env` setting (clients start the server from their own working directory, so a local `.env` file is not reliable here).

**Claude Desktop** (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "rapidtextai": {
      "command": "node",
      "args": ["/absolute/path/to/rapidtextai-mcp/bin/server.js"],
      "env": { "RAPIDTEXTAI_API_KEY": "your-api-key-here" }
    }
  }
}
```

**Claude Code:**

```bash
claude mcp add rapidtextai --env RAPIDTEXTAI_API_KEY=your-api-key-here -- node /absolute/path/to/rapidtextai-mcp/bin/server.js
```

**Cursor** (`.cursor/mcp.json`) and other clients use the same `command` / `args` / `env` shape as the Claude Desktop example.

Restart the client, then ask it something like *"Run a competitor gap analysis for 'standing desks'"*.

## Good to know

- **Units are spent.** Each paid tool consumes RapidTextAI request units (see the table). Failed requests are refunded by the API. Consider telling your assistant to confirm before running costly tools.
- **One job at a time.** RapidTextAI allows one generation or SEO job per account at once, so this server queues tool calls instead of letting them fail with HTTP 429.
- **Long jobs.** An article takes 1-3 minutes. Clients that support progress tokens show live updates.
- **Spot checks.** Fact check and originality are spot checks. Review before publishing.
- **Server features.** If web search isn't configured on the RapidTextAI server, the SEO tools return 503. `check_capabilities` shows what's enabled.
- **Privacy.** The server only talks to the RapidTextAI API (`https://app.rapidtextai.com/openai`, override with `RAPIDTEXTAI_BASE_URL`). Logs go to stderr; nothing is written to disk.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Server exits immediately with `Missing API key` | Add `RAPIDTEXTAI_API_KEY` to the client's `env` block. |
| Tools don't appear | Use an absolute path to `bin/server.js`, check Node is 18+, restart the client, and look at the client's MCP log (our messages go to stderr). |
| `429` | Another RapidTextAI job is already running on your account. |
| `401` | The key is wrong or revoked. |

## Development

```bash
npm test      # protocol and tool tests against a fake API, no key needed
```

Layout: `src/server.js` (MCP JSON-RPC over stdio), `src/tools.js` (tool definitions and execution), `src/seo-tools.js` (input validation), `src/report.js` (Markdown results), `src/api.js` (RapidTextAI client).

## License

No license has been chosen yet; add one before accepting contributions.
