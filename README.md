[//]: #@corifeus-header

  [![NPM](https://img.shields.io/npm/v/p3x-architect.svg)](https://www.npmjs.com/package/p3x-architect)  [![Donate for PatrikX3 / P3X](https://img.shields.io/badge/Donate-PatrikX3-003087.svg)](https://paypal.me/patrikx3) [![Contact Corifeus / P3X](https://img.shields.io/badge/Contact-P3X-ff9900.svg)](https://www.patrikx3.com/en/front/contact) [![Corifeus @ Facebook](https://img.shields.io/badge/Facebook-Corifeus-3b5998.svg)](https://www.facebook.com/corifeus.software)  [![Uptime ratio (90 days)](https://network.corifeus.com/public/api/uptime-shield/31ad7a5c194347c33e5445dbaf8.svg)](https://network.corifeus.com/status/31ad7a5c194347c33e5445dbaf8)





# 📐 Multi-agent RUP pipeline — OpenAI + Claude take a requirement through Inception → Elaboration → Construction → Transition and emit a complete design + implementation under agents/slug/ v2026.4.104


  
🌌 **Bugs are evident™ - MATRIX️**  
🚧 **This project is under active development!**  
📢 **We welcome your feedback and contributions.**  
    



### NodeJS LTS is supported

### 🛠️ Built on NodeJs version

```txt
v24.15.0
```





# 📝 Description

                        
[//]: #@corifeus-header:end

A multi-agent **RUP** (Rational Unified Process) pipeline for software design — driven by your **Claude Code + ChatGPT subscriptions** (no API keys, no per-call cost).

You hand it a one-paragraph requirement from a stakeholder. It hands you back a complete design dossier and a working implementation under `agents/<slug>/` — produced by **eleven role-played AI agents** that alternate between OpenAI (via `codex` CLI) and Claude (via `claude` CLI) across the four classic RUP phases:

| Phase | Roles | Provider chain |
| --- | --- | --- |
| **1. Inception** | `vision`, `vision-reviewer` | OpenAI → Claude |
| **2. Elaboration** | `requirements-analyst`, `architect`, `risk-analyst`, `design-reviewer` | OpenAI → Claude → OpenAI → Claude |
| **3. Construction** | `implementer`, `critic` ↔ `reviser` (loop) | Claude, then OpenAI ↔ Claude |
| **4. Transition** | `acceptance-writer`, `deployment-writer` | OpenAI → Claude |

Each phase's outputs feed the next. The cross-provider chain catches blind spots a single model would miss — when OpenAI writes the requirements, Claude reviews them; when Claude writes the architecture, OpenAI flags the risks; when Claude implements, OpenAI critiques.

## What you get under `agents/<slug>/`

```text
agents/<slug>/
  README.md                  # navigation summary, cost, verdict, links to outputs
  pipeline.json              # per-role token usage + timing
  inception/
    vision.md
    vision-review-notes.md
  elaboration/
    requirements.json        # structured, MoSCoW-prioritized
    architecture.md
    file_tree.json
    risks.md
    design-review.md         # reviewer's prose review
    design-findings.json     # specific gaps + verdict
  construction/
    issues-round-1.json
    issues-round-2.json      # if a 2nd round was needed
    project/                 # the actual generated source code
  transition/
    acceptance.md            # test scenarios + manual checklist
    deploy.md                # local + production deploy + ops runbook
```

## Cheapest path: subscriptions, not API keys

`p3x-architect` does **not** call the OpenAI or Anthropic HTTP APIs. It spawns the **`claude` CLI** (your Claude Code subscription) and the **`codex` CLI** (your ChatGPT subscription) as subprocesses and uses their structured-output flags (`--json-schema` for claude, `--output-schema` for codex).

This is **deliberate, and it's the whole point**:

- A single API run with `gpt-5.5` ($5 / $30 per 1M tok) + `claude-opus-4-7` ($15 / $75 per 1M tok) costs **$2–$10**. Ten runs a month → $20–$100 in API bills.
- A Claude Pro subscription is ~$20/month flat. ChatGPT Plus is ~$20/month flat. **You already pay for these.** Running the architect against them is **$0 marginal cost.**
- Trade-off: the CLI route is slower (5–15s per role × 11 roles = 1–3 min per pipeline run) and the model is whatever your subscription tier gives you. For the "boss handed me a feature, lay it out" use case, that's fine.

### Prerequisites — install both CLIs and log in once

#### 1. `claude` (Claude Code) — your Anthropic subscription

Both ship as Node packages, so install is the same on **Linux, macOS, and Windows** (anywhere Node.js ≥ 18 runs):

```bash
npm install -g @anthropic-ai/claude-code
# or, on macOS/Linux: curl -fsSL https://claude.ai/install.sh | bash
```

Then run `claude` once interactively — it opens a browser to OAuth into your **Claude Pro / Max** subscription. After that, `claude --print` works headlessly without prompts.

#### 2. `codex` (Codex CLI) — your ChatGPT subscription

```bash
npm install -g @openai/codex
# or, on macOS:  brew install codex
# or grab a release binary from https://github.com/openai/codex/releases
```

Then run `codex login` once — opens a browser to attach your **ChatGPT Plus / Pro** subscription. After that, `codex exec` works headlessly without prompts.

> Both CLIs put their auth in your home directory (`~/.claude/`, `~/.codex/`), so once you've logged in any subprocess spawned by `p3x-architect` picks it up.

#### 3. `p3x-architect` itself

```bash
yarn global add p3x-architect
# or
npm install -g p3x-architect
```

If you don't want a global install, the MCP entry works on-demand via `npx -y -p p3x-architect p3x-architect-mcp` — `npx` pulls the `p3x-architect` package and runs its `p3x-architect-mcp` bin. **There is no separate `p3x-architect-mcp` package on npm**; both binaries ship inside `p3x-architect`.

### Model selection

Models are picked automatically by the CLIs: `claude` defaults to `opus`, `codex` picks the highest model your account is entitled to (`gpt-5.5` as of 2026-04). To override:

```bash
ANTHROPIC_MODEL=sonnet            # opus | sonnet | haiku
CODEX_MODEL=gpt-5.5               # only set if you need to force a specific codex model
```

### What if you'd rather use API keys?

You can't, in this version. The HTTP-API providers were removed in favor of the CLI subprocess approach. If that ever needs to come back, it would land behind a flag (e.g. `--via-api`) — but no plans to do so.

## CLI usage

From the project where you want the `agents/<slug>/` folder created:

```bash
# from a Markdown spec
p3x-architect docs/feature-x.md --name feature-x

# inline text
p3x-architect --text "Build a simple REST API for tasks with create/list/update/delete and a SQLite store" --name task-api

# pipe via stdin
cat requirement.md | p3x-architect --name nightly-report

# tighten budget and rounds
p3x-architect spec.md --name auth --budget 3 --max-rounds 1
```

All flags:

| Flag | Purpose |
| --- | --- |
| `[input]` | path to a Markdown file containing the requirement |
| `-t, --text <s>` | inline requirement (alternative to a file) |
| `-n, --name <slug>` | folder name under `agents/` (auto-derived if omitted) |
| `-o, --output <dir>` | override output directory |
| `-r, --max-rounds <n>` | maximum critic↔reviser rounds (default `2`) |
| `-b, --budget <usd>` | cumulative USD budget across all roles (default `5`, `0` = unlimited) |
| `--cwd <dir>` | project root for `agents/<slug>/` (defaults to `process.cwd()`) |

## MCP usage (Claude Code, Cursor, VS Code, …)

The `p3x-architect` package ships **two binaries**:

| Binary | Purpose |
| --- | --- |
| `p3x-architect` | the CLI you saw above |
| `p3x-architect-mcp` | a Model Context Protocol server (stdio) that exposes the pipeline as a single `architect` tool |

Both live in the same package — there is no separate `p3x-architect-mcp` package. Wherever the docs below say `npx -y -p p3x-architect p3x-architect-mcp`, the `-p` flag tells `npx` "install the `p3x-architect` package, then run the `p3x-architect-mcp` bin from it."

### Claude Code (terminal **or** VS Code extension)

The Anthropic `claude` CLI and the **Claude Code VS Code extension** share the same MCP registry (`~/.claude.json`), so a single `claude mcp add` invocation registers the server for both. Run it once from any terminal:

```bash
# global install — short form
yarn global add p3x-architect
claude mcp add p3x-architect -- p3x-architect-mcp

# no global install — npx runs it on demand
claude mcp add p3x-architect -- npx -y -p p3x-architect p3x-architect-mcp

# per-workspace registration (lives in .mcp.json next to your project, scoped to that repo)
claude mcp add --scope project p3x-architect -- npx -y -p p3x-architect p3x-architect-mcp
```

Restart the Claude Code panel in VS Code (or re-open the chat in the terminal) and the `architect` tool will appear in the tool list. Then ask: *"Use p3x-architect to plan and implement this feature: …"*

### VS Code native MCP (no Claude Code extension)

VS Code 1.95+ ships native MCP support for any MCP-aware extension. Add the file `.vscode/mcp.json` at your workspace root:

```json
{
    "servers": {
        "p3x-architect": {
            "command": "npx",
            "args": ["-y", "-p", "p3x-architect", "p3x-architect-mcp"]
        }
    }
}
```

### Generic MCP clients (Cursor, Continue, Zed, …)

```json
{
    "mcpServers": {
        "p3x-architect": {
            "command": "npx",
            "args": ["-y", "-p", "p3x-architect", "p3x-architect-mcp"]
        }
    }
}
```

### Local (unpublished) testing

If you cloned this repo and want to drive the MCP from VS Code Claude Code without publishing first, point at the local bin directly:

```bash
claude mcp add p3x-architect -- node /absolute/path/to/architect/bin/architect-mcp.js
```

The MCP exposes one tool — `architect` — with these parameters:

- `requirement` (required) — plain-language requirement
- `slug` (optional) — folder under `agents/`
- `project_root` (optional) — absolute path; defaults to MCP server cwd
- `max_rounds` (optional) — defaults to 2
- `budget_usd` (optional) — defaults to `ARCHITECT_BUDGET_USD` or 5

The tool blocks for 30–120 seconds while the pipeline runs. Returns a JSON summary with the verdict, file count, total cost, and per-role token usage.

## Cost & timing

Because every role spawns your local `claude` / `codex` CLI, **runtime cost is $0** beyond your existing subscriptions. The `--budget` flag and `usd` fields in `pipeline.json` are kept for forward compatibility with an API-mode that may return later — they will all read `0` in CLI mode.

Wall-clock time is dominated by `claude` startup (each invocation re-loads its tooling) plus inference latency. Expect:

- 5–15 seconds per role
- 1–3 minutes for the full 11-role pipeline on a small spec
- 3–6 minutes on a large one with two critic↔reviser rounds

You can dial down latency with:

- `ANTHROPIC_MODEL=sonnet` (faster than opus, still strong)
- `--max-rounds 1` (skip the second critic round)

## Project structure

```text
src/
  orchestrator.mjs       # the 4-phase pipeline, budget enforcement, output writing
  index.mjs              # public ESM entry — exports architect() and every role
  mcp.mjs                # MCP server (stdio transport)
  providers/
    openai.mjs           # OpenAI client with structured outputs + cost tracking
    anthropic.mjs        # Anthropic client with tool-use schemas + cost tracking
    schema.mjs           # Zod 4 → JSON Schema (strict, additionalProperties:false)
  roles/
    vision.mjs                # Phase 1 — OpenAI
    vision-reviewer.mjs       # Phase 1 — Claude
    requirements-analyst.mjs  # Phase 2 — OpenAI
    architect.mjs             # Phase 2 — Claude
    risk-analyst.mjs          # Phase 2 — OpenAI
    design-reviewer.mjs       # Phase 2 — Claude
    implementer.mjs           # Phase 3 — Claude
    critic.mjs                # Phase 3 — OpenAI
    reviser.mjs               # Phase 3 — Claude
    acceptance-writer.mjs     # Phase 4 — OpenAI
    deployment-writer.mjs     # Phase 4 — Claude
bin/
  architect.js            # CLI entry
  architect-mcp.js        # MCP server entry
secure/
  .env.example            # template — copy to .env or .env.architect
example/
  spec.md                 # tiny CRUD spec for a first end-to-end run
```

## Programmatic API

```js
import { architect } from 'p3x-architect';

const result = await architect({
    requirement: 'Build a CRUD task API in Node.js with SQLite',
    slug: 'task-api',
    projectRoot: process.cwd(),
    maxRounds: 2,
    budgetUsd: 5,
    log: console.log,
});

console.log(result.verdict);       // ready-to-build | fix-then-build | redesign
console.log(result.files.length);
console.log(result.usage.totalUsd);
```

Every role is also exported individually if you want to run a single phase.

## Homepage

[https://corifeus.com/architect](https://corifeus.com/architect)

[//]: #@corifeus-footer

---

# 🌐 Meet Assistant SaaS — meeting.corifeus.com

Don't want to install anything? Try the **hosted version** at **[meeting.corifeus.com](https://meeting.corifeus.com)** — full meeting workflow built for European businesses, no setup, no API key, no command line.

What the hosted version offers:

- **21-language live translation** during the meeting
- **AI summaries, action items, decisions, attendees, key quotes** auto-generated after every meeting
- **Custom vocabulary** — your client / company / industry terms corrected automatically (Pro+ tier)
- **Searchable meeting library** — find any decision or promise across all your past meetings
- **Shareable read-only links** — send a clean meeting summary to a client or teammate, no signup needed on their end
- **One-click email summary** after each meeting
- **Premium engine on every plan** — no downgraded model, ever
- **EU billing** — Stripe Tax + VAT-compliant + EUR-priced (Solo €19.99 / Pro €39.99 / Business €99.99 per month, no lock-in)
- **GDPR-compliant by default** — browser-language auto-detection, no tracking cookies, your meetings stored encrypted

Try the live demo (1 minute free, no signup) or browse the **public sample meeting** at [meeting.corifeus.com/sample](https://meeting.corifeus.com/sample).

---

# Corifeus Network

AI-powered network & email toolkit — free, no signup.

**Web** · [network.corifeus.com](https://network.corifeus.com)  **MCP** · [`npm i -g p3x-network-mcp`](https://www.npmjs.com/package/p3x-network-mcp)

- **AI Network Assistant** — ask in plain language, get a full domain health report
- **Network Audit** — DNS, SSL, security headers, DNSBL, BGP, IPv6, geolocation in one call
- **Diagnostics** — DNS lookup & global propagation, WHOIS, reverse DNS, HTTP check, my-IP
- **Mail Tester** — live SPF/DKIM/DMARC + spam score + AI fix suggestions, results emailed (localized)
- **Monitoring** — TCP / HTTP / Ping with alerts and public status pages
- **MCP server** — 17 tools exposed to Claude Code, Codex, Cursor, any MCP client
- **Install** — `claude mcp add p3x-network -- npx p3x-network-mcp`
- **Try** — *"audit example.com"*, *"why do my emails land in spam? test me@example.com"*
- **Source** — [patrikx3/network](https://github.com/patrikx3/network) · [patrikx3/network-mcp](https://github.com/patrikx3/network-mcp)
- **Contact** — [patrikx3.com](https://www.patrikx3.com/en/front/contact) · [donate](https://paypal.me/patrikx3)

---

## ❤️ Support Our Open-Source Project  
If you appreciate our work, consider ⭐ starring this repository or 💰 making a donation to support server maintenance and ongoing development. Your support means the world to us—thank you!  

---

### 🌍 About My Domains  
All my domains, including [patrikx3.com](https://patrikx3.com), [corifeus.eu](https://corifeus.eu), and [corifeus.com](https://corifeus.com), are developed in my spare time. While you may encounter minor errors, the sites are generally stable and fully functional.  

---

### 📈 Versioning Policy  
**Version Structure:** We follow a **Major.Minor.Patch** versioning scheme:  
- **Major:** 📅 Corresponds to the current year.  
- **Minor:** 🌓 Set as 4 for releases from January to June, and 10 for July to December.  
- **Patch:** 🔧 Incremental, updated with each build.  

**🚨 Important Changes:** Any breaking changes are prominently noted in the readme to keep you informed.


[**P3X-ARCHITECT**](https://corifeus.com/architect) Build v2026.4.104

 [![NPM](https://img.shields.io/npm/v/p3x-architect.svg)](https://www.npmjs.com/package/p3x-architect)  [![Donate for PatrikX3 / P3X](https://img.shields.io/badge/Donate-PatrikX3-003087.svg)](https://www.paypal.com/cgi-bin/webscr?cmd=_s-xclick&hosted_button_id=QZVM4V6HVZJW6)  [![Contact Corifeus / P3X](https://img.shields.io/badge/Contact-P3X-ff9900.svg)](https://www.patrikx3.com/en/front/contact) [![Like Corifeus @ Facebook](https://img.shields.io/badge/LIKE-Corifeus-3b5998.svg)](https://www.facebook.com/corifeus.software)





[//]: #@corifeus-footer:end
