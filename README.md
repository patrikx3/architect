[//]: #@corifeus-header

  [![NPM](https://img.shields.io/npm/v/p3x-architect.svg)](https://www.npmjs.com/package/p3x-architect)  [![Donate for PatrikX3 / P3X](https://img.shields.io/badge/Donate-PatrikX3-003087.svg)](https://paypal.me/patrikx3) [![Contact Corifeus / P3X](https://img.shields.io/badge/Contact-P3X-ff9900.svg)](https://www.patrikx3.com/en/front/contact) [![Corifeus @ Facebook](https://img.shields.io/badge/Facebook-Corifeus-3b5998.svg)](https://www.facebook.com/corifeus.software)  [![Uptime ratio (90 days)](https://network.corifeus.com/public/api/uptime-shield/31ad7a5c194347c33e5445dbaf8.svg)](https://network.corifeus.com/status/31ad7a5c194347c33e5445dbaf8)





# 📐 Multi-agent RUP pipeline — OpenAI + Claude take a requirement through Inception → Elaboration → Construction → Transition and emit a complete design + implementation under agents/slug/ v2026.4.102


  
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

A multi-agent **RUP** (Rational Unified Process) pipeline for software design.

You hand it a one-paragraph requirement from a stakeholder. It hands you back a complete design dossier and a working implementation under `agents/<slug>/` — produced by **eleven role-played AI agents** that alternate between OpenAI and Claude across the four classic RUP phases:

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

## Install

```bash
yarn global add p3x-architect
# or
npm install -g p3x-architect
```

Then drop your API keys into `secure/.env.architect` (or `secure/.env`):

```bash
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_MODEL=gpt-5.5
ANTHROPIC_MODEL=claude-opus-4-7
ARCHITECT_BUDGET_USD=25
```

The defaults are fine if you don't override them.

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

`p3x-architect-mcp` exposes the pipeline as a single Model Context Protocol tool, so you can run it from any MCP-compatible AI assistant.

### Claude Code

```bash
claude mcp add p3x-architect -- npx -y p3x-architect-mcp
```

Then in any conversation: *"Use p3x-architect to plan and implement this feature: …"*

### Configure in MCP-compatible clients (generic)

```json
{
  "mcpServers": {
    "p3x-architect": {
      "command": "npx",
      "args": ["-y", "p3x-architect-mcp"]
    }
  }
}
```

The MCP exposes one tool — `architect` — with these parameters:

- `requirement` (required) — plain-language requirement
- `slug` (optional) — folder under `agents/`
- `project_root` (optional) — absolute path; defaults to MCP server cwd
- `max_rounds` (optional) — defaults to 2
- `budget_usd` (optional) — defaults to `ARCHITECT_BUDGET_USD` or 5

The tool blocks for 30–120 seconds while the pipeline runs. Returns a JSON summary with the verdict, file count, total cost, and per-role token usage.

## Cost & timing

A typical run on default models (`gpt-5.5` at \$5 / \$30 per 1M tokens + `claude-opus-4-7` at \$15 / \$75 per 1M tokens) costs **roughly \$2–\$10** depending on spec length and how many critic↔reviser rounds fire. The default `--budget 5` (or 25 in `.env.architect`) is a hard ceiling — if a role's call would push cumulative spend over budget, the pipeline aborts cleanly with a clear error.

Wall-clock time is dominated by the implementer + reviser steps (Claude Opus generating the full file set). Expect 30–60 s on a small spec, 90–180 s on a large one.

You can dial cost down by:

- Setting `OPENAI_MODEL=gpt-5-mini` (cheap roles still work fine for vision/requirements/risks/critic)
- Setting `ANTHROPIC_MODEL=claude-sonnet-4-6` for the implementer
- Lowering `--max-rounds 1`

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


[**P3X-ARCHITECT**](https://corifeus.com/architect) Build v2026.4.102

 [![NPM](https://img.shields.io/npm/v/p3x-architect.svg)](https://www.npmjs.com/package/p3x-architect)  [![Donate for PatrikX3 / P3X](https://img.shields.io/badge/Donate-PatrikX3-003087.svg)](https://www.paypal.com/cgi-bin/webscr?cmd=_s-xclick&hosted_button_id=QZVM4V6HVZJW6)  [![Contact Corifeus / P3X](https://img.shields.io/badge/Contact-P3X-ff9900.svg)](https://www.patrikx3.com/en/front/contact) [![Like Corifeus @ Facebook](https://img.shields.io/badge/LIKE-Corifeus-3b5998.svg)](https://www.facebook.com/corifeus.software)





[//]: #@corifeus-footer:end
