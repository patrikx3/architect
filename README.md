[//]: #@corifeus-header

  [![NPM](https://img.shields.io/npm/v/p3x-architect.svg)](https://www.npmjs.com/package/p3x-architect)  [![Donate for PatrikX3 / P3X](https://img.shields.io/badge/Donate-PatrikX3-003087.svg)](https://paypal.me/patrikx3) [![Contact Corifeus / P3X](https://img.shields.io/badge/Contact-P3X-ff9900.svg)](https://www.patrikx3.com/en/front/contact) [![Corifeus @ Facebook](https://img.shields.io/badge/Facebook-Corifeus-3b5998.svg)](https://www.facebook.com/corifeus.software)  [![Uptime ratio (90 days)](https://network.corifeus.com/public/api/uptime-shield/31ad7a5c194347c33e5445dbaf8.svg)](https://network.corifeus.com/status/31ad7a5c194347c33e5445dbaf8)





# 📐 P3X Architect — Pair-programming AI by default (Claude implements + Codex critiques, ~30-60s on small specs). Add --rup (CLI) or rup:true (MCP) to run the full multi-agent RUP design pipeline (vision, requirements, architecture, risks, acceptance, deploy → 11 roles, 1-3 min) when you actually need a design dossier. Scans your project root and either creates a new project (greenfield) or modifies existing code in place — matching your layout (src/, src-server/, client/server/, monorepo). Code lands at the project root; design artifacts under agents/slug/. v2026.4.114


  
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

Pair-programming AI for code changes — driven by your **Claude Code + ChatGPT subscriptions** (no API keys, no per-call cost).

You hand it a one-paragraph requirement. It scans the project root, decides whether you're greenfield or extending an existing codebase, and either **creates a new project at the root** or **modifies the existing files in place** — matching your existing layout (`src/`, `src-server/`, `client/`, `server/`, monorepo workspaces, …). The actual code lands where it would normally live; a small design artifact (`plan.md` in pair mode, full dossier in `--rup` mode) lands under `agents/<slug>/`.

## Two modes

### `pair` mode — default (1 task, 2 AIs, fixed role split)

For 90% of feature work you don't need a multi-phase design dossier — you need code, and a second pair of eyes on it. Pair mode does exactly that. Roles are FIXED per AI to play to each model's strengths:

- **Claude** = architect, planner, reviewer, risk checker. NEVER writes file content.
- **Codex** = implementer, refactoring assistant, test writer, code worker. NEVER plans architecture.
- **You** (human) = final architect + approval authority.

| Step | Role | Provider |
| --- | --- | --- |
| 1 | `pair-planner` — produces plan + file_tree (paths + change_notes, no content) | **Claude** |
| 2 | `pair-implementer` — writes the full content of every file from Claude's plan | **Codex** |
| 3 | `pair-reviewer` — produces structured issues list (severity / file / fix_hint) | **Claude** |
| 4 | `pair-reviser` — applies fixes if there are blocking issues (skipped otherwise) | **Codex** |

Wall-clock: ~30-90s on small specs depending on whether step 4 fires. The cross-provider review catches blind spots a single model would miss — and the role split lets each AI do what it's actually good at instead of asking one to wear every hat. RUP's vision / requirements / architecture / risks / acceptance / deploy phases are skipped here.

### `rup` mode — `--rup` (full design dossier, 11 roles, 1-3 min)

When you're designing something complex enough to warrant a real design dossier — a new subsystem, a non-trivial migration, an architectural decision — pass `--rup` (CLI) or `rup: true` (MCP). The full **RUP** (Rational Unified Process) pipeline runs across the four classic phases:

| Phase | Roles | Provider chain |
| --- | --- | --- |
| **1. Inception** | `vision`, `vision-reviewer` | OpenAI → Claude |
| **2. Elaboration** | `requirements-analyst`, `architect`, `risk-analyst`, `design-reviewer` | OpenAI → Claude → OpenAI → Claude |
| **3. Construction** | `implementer`, `critic` ↔ `reviser` (loop) | Claude, then OpenAI ↔ Claude |
| **4. Transition** | `acceptance-writer`, `deployment-writer` | OpenAI → Claude |

Each phase's outputs feed the next. You get the full dossier (vision, requirements, architecture, risks, acceptance, deploy) under `agents/<slug>/` — useful even if you discard the generated code and re-implement by hand.

## What you get

Both modes write to **two places**:

1. **The project root itself** — actual code. Greenfield projects get a fresh tree at the root; existing codebases get in-place edits matching their layout. Review it with `git diff`.
2. **`agents/<slug>/`** — the design artifact: small in pair mode, full dossier in `--rup` mode.

### Pair mode output (default)

```text
<project root>/                # ← actual code lands here in place
  ...modified existing files / new files next to siblings...
  agents/<slug>/
    README.md                   # quick summary, role split, mode, file counts, blocking-issue count
    plan.md                     # Claude planner's rationale (greenfield vs modify, layout choices)
    file_tree.json              # what Claude planned for Codex to implement
    changes.json                # { created: [...], modified: [...] }
    issues-round-1.json         # Claude reviewer findings (one round by default; empty array = clean)
    pipeline.json               # per-role token usage + timing
```

### RUP mode output (`--rup`)

```text
<project root>/                # ← actual code lands here in place
  ...your existing files (modified in place)...
  ...new files (created next to their existing siblings)...
  agents/<slug>/                # ← design dossier only, no nested project copy
    README.md                   # navigation summary, mode (greenfield|modify-in-place), file counts, verdict
    pipeline.json               # per-role token usage + timing + created/modified paths
    inception/
      vision.md
      vision-review-notes.md
    elaboration/
      requirements.json         # structured, MoSCoW-prioritized
      architecture.md
      file_tree.json            # each entry has mode: "create" | "modify" + change_notes
      risks.md
      design-review.md          # reviewer's prose review
      design-findings.json      # specific gaps + verdict
    construction/
      changes.json              # { created: [...], modified: [...] } at the project root
      issues-round-1.json       # critic findings per round
      issues-round-2.json
    transition/
      acceptance.md             # test scenarios + manual checklist
      deploy.md                 # local + production deploy + ops runbook
```

In both modes, the implementer studies your existing folder layout (`src/`, `src-server/`, `client/server/`, monorepo workspaces, …) before deciding where new files go. New backend code lands next to existing backend code; new frontend code next to the frontend; new admin endpoints next to existing admin endpoints. **No nested `construction/project/` copy of your repo.**

## Cheapest path: subscriptions, not API keys

`p3x-architect` does **not** call the OpenAI or Anthropic HTTP APIs. It spawns the **`claude` CLI** (your Claude Code subscription) and the **`codex` CLI** (your ChatGPT subscription) as subprocesses and uses their structured-output flags (`--json-schema` for claude, `--output-schema` for codex).

This is **deliberate, and it's the whole point**:

- A single API run with `gpt-5.5` ($5 / $30 per 1M tok) + `claude-opus-4-7` ($15 / $75 per 1M tok) costs **$2–$10** in RUP mode. Ten runs a month → $20–$100 in API bills.
- A Claude Pro subscription is ~$20/month flat. ChatGPT Plus is ~$20/month flat. **You already pay for these.** Running the architect against them is **$0 marginal cost.**
- Trade-off: the CLI route is slower (5–15s per role) and the model is whatever your subscription tier gives you. For the "boss handed me a feature, lay it out" use case, that's fine.
- Pair mode runs 2-3 roles → ~30-60s on small specs. RUP mode runs 11 roles → 1-3 min. Both are $0 on subscriptions.

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
# pair mode (default — fast)
p3x-architect docs/feature-x.md --name feature-x

# inline text in pair mode
p3x-architect --text "Add a /healthz endpoint that returns 200 with the current git sha" --name healthz

# pipe via stdin in pair mode
cat requirement.md | p3x-architect --name nightly-report

# RUP mode — full multi-agent design pipeline
p3x-architect docs/big-redesign.md --name big-redesign --rup

# RUP mode with tighter rounds
p3x-architect spec.md --name auth --rup --max-rounds 1
```

All flags:

| Flag | Purpose |
| --- | --- |
| `[input]` | path to a Markdown file containing the requirement |
| `-t, --text <s>` | inline requirement (alternative to a file) |
| `-n, --name <slug>` | folder name under `agents/` (auto-derived if omitted) |
| `-o, --output <dir>` | override output directory |
| `--rup` | run the full RUP multi-agent design pipeline (default off → fast pair mode) |
| `-r, --max-rounds <n>` | maximum critic↔reviser rounds (default `1` in pair mode, `2` in `--rup` mode) |
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
- `rup` (optional, boolean) — set `true` to run the full RUP pipeline; default `false` = fast pair mode
- `slug` (optional) — folder under `agents/`
- `project_root` (optional) — absolute path; defaults to MCP server cwd
- `max_rounds` (optional) — default 1 in pair mode, 2 in RUP mode
- `budget_usd` (optional) — defaults to `ARCHITECT_BUDGET_USD` or 5

Pair mode blocks for ~30–60 seconds on small specs; RUP mode for 1–3 minutes. Returns a JSON summary with the pipeline mode, file count, total cost, and per-role token usage (verdict only in RUP mode).

## Cost & timing

Because every role spawns your local `claude` / `codex` CLI, **runtime cost is $0** beyond your existing subscriptions. The `--budget` flag and `usd` fields in `pipeline.json` are kept for forward compatibility with an API-mode that may return later — they will all read `0` in CLI mode.

Wall-clock time is dominated by `claude` / `codex` startup (each invocation re-loads its tooling) plus inference latency. Expect:

- 5–15 seconds per role
- **Pair mode (default):** ~30–90s on a small spec (Claude plan + Codex implement + Claude review + optional Codex revise)
- **RUP mode (`--rup`):** 1–3 minutes for the full 11-role pipeline on a small spec; 3–6 minutes on a large one with two critic↔reviser rounds

You can dial down latency with:

- `ANTHROPIC_MODEL=sonnet` (faster than opus, still strong)
- `--max-rounds 0` is not allowed — set `--max-rounds 1` to keep just one critic pass with no revision in RUP mode (pair mode already defaults to 1)
- Use the default pair mode unless the change genuinely needs the design dossier

## Project structure

```text
src/
  orchestrator.mjs       # mode dispatcher (pair | rup), budget enforcement, output writing
  index.mjs              # public ESM entry — exports architect() and every role
  mcp.mjs                # MCP server (stdio transport)
  scan-project.mjs       # walks the project root and embeds source content for the roles
  providers/
    openai.mjs           # codex CLI subprocess with structured outputs
    anthropic.mjs        # claude CLI subprocess with tool-use schemas
    schema.mjs           # Zod 4 → JSON Schema (strict, additionalProperties:false)
    log-context.mjs      # AsyncLocalStorage for streaming sub-CLI output to the orchestrator
  roles/
    pair-planner.mjs          # pair mode — Claude (plan + file_tree, no content)
    pair-implementer.mjs      # pair mode — Codex (writes full content from plan)
    pair-reviewer.mjs         # pair mode — Claude (issues list)
    pair-reviser.mjs          # pair mode — Codex (applies fixes)
    vision.mjs                # RUP Phase 1 — OpenAI
    vision-reviewer.mjs       # RUP Phase 1 — Claude
    requirements-analyst.mjs  # RUP Phase 2 — OpenAI
    architect.mjs             # RUP Phase 2 — Claude
    risk-analyst.mjs          # RUP Phase 2 — OpenAI
    design-reviewer.mjs       # RUP Phase 2 — Claude
    implementer.mjs           # RUP Phase 3 — Claude
    critic.mjs                # RUP Phase 3 — OpenAI
    reviser.mjs               # RUP Phase 3 — Claude
    acceptance-writer.mjs     # RUP Phase 4 — OpenAI
    deployment-writer.mjs     # RUP Phase 4 — Claude
bin/
  architect.js            # CLI entry
  architect-mcp.js        # MCP server entry
example/
  spec.md                 # tiny CRUD spec for a first end-to-end run
```

## Programmatic API

```js
import { architect } from 'p3x-architect';

// pair mode (default)
const result = await architect({
    requirement: 'Add a /healthz endpoint that returns 200 with the current git sha',
    slug: 'healthz',
    projectRoot: process.cwd(),
    log: console.log,
});

console.log(result.pipelineMode);  // 'pair'
console.log(result.files.length);
console.log(result.usage.totalUsd);

// RUP mode — full design pipeline
const big = await architect({
    requirement: 'Migrate the auth layer from session cookies to JWT...',
    slug: 'auth-migration',
    projectRoot: process.cwd(),
    mode: 'rup',           // or pass rup: true
    maxRounds: 2,
    budgetUsd: 5,
    log: console.log,
});

console.log(big.verdict);          // ready-to-build | fix-then-build | redesign  (RUP mode only)
```

Every role is also exported individually if you want to run a single one.

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


[**P3X-ARCHITECT**](https://corifeus.com/architect) Build v2026.4.114

 [![NPM](https://img.shields.io/npm/v/p3x-architect.svg)](https://www.npmjs.com/package/p3x-architect)  [![Donate for PatrikX3 / P3X](https://img.shields.io/badge/Donate-PatrikX3-003087.svg)](https://www.paypal.com/cgi-bin/webscr?cmd=_s-xclick&hosted_button_id=QZVM4V6HVZJW6)  [![Contact Corifeus / P3X](https://img.shields.io/badge/Contact-P3X-ff9900.svg)](https://www.patrikx3.com/en/front/contact) [![Like Corifeus @ Facebook](https://img.shields.io/badge/LIKE-Corifeus-3b5998.svg)](https://www.facebook.com/corifeus.software)





[//]: #@corifeus-footer:end
