[//]: #@corifeus-header

  [![NPM](https://img.shields.io/npm/v/p3x-architect.svg)](https://www.npmjs.com/package/p3x-architect)  [![Donate for PatrikX3 / P3X](https://img.shields.io/badge/Donate-PatrikX3-003087.svg)](https://paypal.me/patrikx3) [![Contact Corifeus / P3X](https://img.shields.io/badge/Contact-P3X-ff9900.svg)](https://www.patrikx3.com/en/front/contact) [![Corifeus @ Facebook](https://img.shields.io/badge/Facebook-Corifeus-3b5998.svg)](https://www.facebook.com/corifeus.software)  [![Uptime ratio (90 days)](https://network.corifeus.com/public/api/uptime-shield/31ad7a5c194347c33e5445dbaf8.svg)](https://network.corifeus.com/status/31ad7a5c194347c33e5445dbaf8)





# 📐 P3X Architect — DESIGN-ONLY dossier generator. Two AIs (Claude + Codex) cross-check each other across the RUP phases to produce a written design dossier (conventions, vision, requirements, architecture, file_tree, risks, design-findings). NEVER writes code into your project. Hand the dossier to your implementer (Claude Code, Cursor, you, your team). Default = pair mode (scout + planner, ~30-60s). Add --rup (CLI) or rup:true (MCP) for the full 7-role dossier (Inception → Elaboration, ~1-3 min). Dossier lands under agents/<slug>/. v2026.4.117


  
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

**Design-only.** p3x-architect produces a written **design dossier** for a feature or change. It NEVER writes code into your project. Two AIs (Claude + Codex) cross-check each other across the RUP design phases; you hand the dossier to your implementer (Claude Code, Cursor, you, your team) to actually build.

Driven by your **Claude Code + ChatGPT subscriptions** — no API keys, no per-call cost.

You hand it a one-paragraph requirement. It scans the project root for layout conventions (or detects greenfield), runs the design phases, and drops the dossier under `agents/<slug>/`. Your code stays exactly as it was.

## Why design-only?

Earlier versions of this tool tried to do everything — design AND implement. In practice the implementation half added more risk than value:

- **Implementers without a feedback loop are blind.** They can't run the code, see errors, or iterate. Claude Code working with you interactively can.
- **One-shot implementers nuke files.** Lang dictionaries, registry files, large fixtures — replaced with stubs because the model forgot the rest.
- **The construction phase competed with Claude Code.** You already have a great implementer; you don't need a second one that can't see what's broken.

The DESIGN half is what's actually unique: two top-tier models cross-checking each other's vision, requirements, architecture, and risk analysis, in a fixed RUP pipeline, with explicit per-phase artifacts. That's the part you can't easily reproduce with a single chat.

## Two modes

### `pair` mode — default (quick design pass, 2 AIs)

For most feature work you don't need a full RUP dossier — you need a quick plan with an opinion. Pair mode is just enough:

| Step | Role | Provider |
| --- | --- | --- |
| 0 | `scout` — discovers project conventions (existing codebases only) | **Codex** |
| 1 | `pair-planner` — drafts plan + file_tree referencing those conventions | **Claude** |

Wall-clock: ~30-60s on small specs. Output is `plan.md` + `file_tree.json` (+ `conventions.md` when there's existing code).

### `rup` mode — `--rup` (full design dossier, 7 roles, 1-3 min)

When you're designing something big enough to need a real dossier — a new subsystem, a migration, an architectural decision — pass `--rup` (CLI) or `rup: true` (MCP). The two RUP design phases run end to end:

| Phase | Roles | Provider chain |
| --- | --- | --- |
| **1. Inception** | `scout`, `vision`, `vision-reviewer` | Codex → Codex → Claude |
| **2. Elaboration** | `requirements-analyst`, `architect`, `risk-analyst`, `design-reviewer` | Codex → Claude → Codex → Claude |

Each phase's output feeds the next. You end up with vision, requirements, architecture, file_tree, risks, design-review, design-findings — a real dossier the implementer reads before touching any code.

## What you get

p3x-architect writes only to `agents/<slug>/`. Your project root stays untouched.

### Pair mode output (default)

```text
agents/<slug>/
  README.md                   # summary, role split, file_tree counts
  plan.md                     # Claude planner's rationale (greenfield vs modify, layout choices)
  file_tree.json              # path + purpose + mode + change_notes for the implementer
  conventions.md              # scout's project-convention notes (existing codebases only)
  pipeline.json               # per-role token usage + timing
```

### RUP mode output (`--rup`)

```text
agents/<slug>/
  README.md                   # navigation summary, target mode, file_tree counts, verdict
  pipeline.json               # per-role token usage + timing
  inception/
    conventions.md            # scout — existing project's actual conventions, with code snippets
    vision.md                 # purpose, stakeholders, success criteria, scope, use cases
    vision-review-notes.md    # what the reviewer changed and why
  elaboration/
    requirements.json         # structured, MoSCoW-prioritized
    architecture.md           # components, tech choices, data flow
    file_tree.json            # every file the architect proposed (mode + change_notes)
    risks.md                  # risk register with mitigations
    design-review.md          # reviewer's prose review + verdict
    design-findings.json      # specific gaps to fix before construction starts
```

The dossier studies your existing folder layout (`src/`, `src-server/`, `client/server/`, monorepo workspaces, …) before recommending where new files go. New backend code lands next to existing backend code in the **plan**; new frontend code next to the frontend; new admin endpoints next to existing admin endpoints. The plan tells your implementer what to do — but the implementer is you, not p3x-architect.

## Cheapest path: subscriptions, not API keys

`p3x-architect` does **not** call the OpenAI or Anthropic HTTP APIs. It spawns the **`claude` CLI** (your Claude Code subscription) and the **`codex` CLI** (your ChatGPT subscription) as subprocesses and uses their structured-output flags (`--json-schema` for claude, `--output-schema` for codex).

This is **deliberate, and it's the whole point**:

- A single API run with `gpt-5.5` ($5 / $30 per 1M tok) + `claude-opus-4-7` ($15 / $75 per 1M tok) costs **$2–$10** in RUP mode. Ten runs a month → $20–$100 in API bills.
- A Claude Pro subscription is ~$20/month flat. ChatGPT Plus is ~$20/month flat. **You already pay for these.** Running the architect against them is **$0 marginal cost.**
- Trade-off: the CLI route is slower (5–15s per role) and the model is whatever your subscription tier gives you. For the "boss handed me a feature, lay it out" use case, that's fine.
- Pair mode runs 2 roles → ~30-60s on small specs. RUP mode runs 7 roles → 1-3 min. Both are $0 on subscriptions.

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

`claude` defaults to **`claude-opus-4-7[1m]`** — the 1M-context Opus variant — so the scan + conventions + intermediate dossier artifacts fit comfortably even on real codebases. `codex` picks the highest model your account is entitled to (`gpt-5.5` as of 2026-04). To override:

```bash
ANTHROPIC_MODEL=opus              # forces the standard 200k-context Opus
ANTHROPIC_MODEL=sonnet            # faster, still strong
ANTHROPIC_MODEL=haiku             # smallest / fastest
CODEX_MODEL=gpt-5.5               # only set if you need to force a specific codex model
ARCHITECT_SUBPROCESS_TIMEOUT_MS=900000   # per-CLI-call timeout (default 15 min)
```

### What if you'd rather use API keys?

You can't, in this version. The HTTP-API providers were removed in favor of the CLI subprocess approach. If that ever needs to come back, it would land behind a flag (e.g. `--via-api`) — but no plans to do so.

## CLI usage

From the project where you want the `agents/<slug>/` dossier created:

```bash
# pair mode (default — fast)
p3x-architect docs/feature-x.md --name feature-x

# inline text in pair mode
p3x-architect --text "Add a /healthz endpoint that returns 200 with the current git sha" --name healthz

# pipe via stdin in pair mode
cat requirement.md | p3x-architect --name nightly-report

# RUP mode — full 7-role design dossier
p3x-architect docs/big-redesign.md --name big-redesign --rup
```

All flags:

| Flag | Purpose |
| --- | --- |
| `[input]` | path to a Markdown file containing the requirement |
| `-t, --text <s>` | inline requirement (alternative to a file) |
| `-n, --name <slug>` | folder name under `agents/` (auto-derived if omitted) |
| `-o, --output <dir>` | override output directory |
| `--rup` | run the full 7-role RUP design dossier (default off → fast pair mode) |
| `-b, --budget <usd>` | cumulative USD budget across all roles (default `5`, `0` = unlimited; CLI subscription mode is $0 anyway) |
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

Restart the Claude Code panel in VS Code (or re-open the chat in the terminal) and the `architect` tool will appear in the tool list. Then ask: *"Use p3x-architect to design this feature: …"* — and once the dossier is ready, ask Claude Code to implement against it.

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
- `rup` (optional, boolean) — set `true` to run the full 7-role RUP design dossier; default `false` = fast pair mode
- `slug` (optional) — folder under `agents/`
- `project_root` (optional) — absolute path; defaults to MCP server cwd
- `budget_usd` (optional) — defaults to `ARCHITECT_BUDGET_USD` or 5 (subscription mode is $0 anyway)

Pair mode blocks for ~30–60 seconds on small specs; RUP mode for 1–3 minutes. Returns a JSON summary with the pipeline mode, file_tree entry count, total cost, and per-role token usage (verdict only in RUP mode).

## Cost & timing

Because every role spawns your local `claude` / `codex` CLI, **runtime cost is $0** beyond your existing subscriptions. The `--budget` flag and `usd` fields in `pipeline.json` are kept for forward compatibility with an API-mode that may return later — they will all read `0` in CLI mode.

Wall-clock time is dominated by `claude` / `codex` startup (each invocation re-loads its tooling) plus inference latency. Expect:

- 5–20 seconds per role
- **Pair mode (default):** ~30–60s on a small spec (Codex scout + Claude planner)
- **RUP mode (`--rup`):** 1–3 minutes for the full 7-role design dossier on a small spec; up to ~5 min on a larger codebase

You can dial down latency with:

- `ANTHROPIC_MODEL=sonnet` (faster than opus, still strong)
- Use the default pair mode unless the change genuinely needs the full RUP dossier

Each CLI subprocess has a 15-minute hard timeout (override via `ARCHITECT_SUBPROCESS_TIMEOUT_MS`) — a stuck role can't hang the pipeline indefinitely.

## Project structure

```text
src/
  orchestrator.mjs       # mode dispatcher (pair | rup), budget enforcement, dossier writing
  index.mjs              # public ESM entry — exports architect() and every role
  mcp.mjs                # MCP server (stdio transport)
  scan-project.mjs       # walks the project root and embeds smart-picked exemplars for the roles
  providers/
    openai.mjs           # codex CLI subprocess with structured outputs (15-min timeout)
    anthropic.mjs        # claude CLI subprocess with tool-use schemas (15-min timeout, 1M-context Opus default)
    schema.mjs           # Zod 4 → JSON Schema (strict, additionalProperties:false)
    log-context.mjs      # AsyncLocalStorage for streaming sub-CLI output to the orchestrator
  roles/
    scout.mjs                 # runs first on existing codebases — discovers conventions (Codex)
    pair-planner.mjs          # pair mode — Claude (plan + file_tree, no content)
    vision.mjs                # RUP Phase 1 — Codex
    vision-reviewer.mjs       # RUP Phase 1 — Claude
    requirements-analyst.mjs  # RUP Phase 2 — Codex
    architect.mjs             # RUP Phase 2 — Claude
    risk-analyst.mjs          # RUP Phase 2 — Codex
    design-reviewer.mjs       # RUP Phase 2 — Claude
bin/
  architect.js            # CLI entry
  architect-mcp.js        # MCP server entry
example/
  spec.md                 # tiny CRUD spec for a first dossier run
```

## Programmatic API

```js
import { architect } from 'p3x-architect';

// pair mode (default — fast design pass)
const result = await architect({
    requirement: 'Add a /healthz endpoint that returns 200 with the current git sha',
    slug: 'healthz',
    projectRoot: process.cwd(),
    log: console.log,
});

console.log(result.pipelineMode);     // 'pair'
console.log(result.fileTree.length);  // number of planned files (created or modified)
console.log(result.usage.totalUsd);

// RUP mode — full design dossier
const big = await architect({
    requirement: 'Migrate the auth layer from session cookies to JWT...',
    slug: 'auth-migration',
    projectRoot: process.cwd(),
    mode: 'rup',           // or pass rup: true
    budgetUsd: 5,
    log: console.log,
});

console.log(big.verdict);             // ready-to-build | fix-then-build | redesign  (RUP mode only)
console.log(big.findings.length);     // design-findings the implementer must address first
```

Every design role is also exported individually if you want to run a single one (e.g. `scoutRole`, `architectRole`, `designReviewerRole`).

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


[**P3X-ARCHITECT**](https://corifeus.com/architect) Build v2026.4.117

 [![NPM](https://img.shields.io/npm/v/p3x-architect.svg)](https://www.npmjs.com/package/p3x-architect)  [![Donate for PatrikX3 / P3X](https://img.shields.io/badge/Donate-PatrikX3-003087.svg)](https://www.paypal.com/cgi-bin/webscr?cmd=_s-xclick&hosted_button_id=QZVM4V6HVZJW6)  [![Contact Corifeus / P3X](https://img.shields.io/badge/Contact-P3X-ff9900.svg)](https://www.patrikx3.com/en/front/contact) [![Like Corifeus @ Facebook](https://img.shields.io/badge/LIKE-Corifeus-3b5998.svg)](https://www.facebook.com/corifeus.software)





[//]: #@corifeus-footer:end
