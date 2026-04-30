[//]: #@corifeus-header

# 📐 P3X Architect — Pair-programming AI by default (Claude implements + Codex critiques, ~30-60s on small specs). Add --rup (CLI) or rup:true (MCP) to run the full multi-agent RUP design pipeline (vision, requirements, architecture, risks, acceptance, deploy → 11 roles, 1-3 min) when you actually need a design dossier. Scans your project root and either creates a new project (greenfield) or modifies existing code in place — matching your layout (src/, src-server/, client/server/, monorepo). Code lands at the project root; design artifacts under agents/slug/.

                        
[//]: #@corifeus-header:end

### v2026.4.110
Released on 04/30/2026
* FEATURE: Pair mode role split — Claude plans and reviews while Codex implements and revises.

### v2026.4.109
Released on 04/30/2026
* FEATURE: Pair mode (Claude + Codex) is now the default; use --rup to opt into the full RUP pipeline.
* FEATURE: Write and edit code in place at the project root, eliminating the nested project copy.

### v2026.4.108
Released on 04/30/2026
* DOCS: Update package.json description to reflect modify-in-place behavior.

### v2026.4.107
Released on 04/30/2026
* FEATURE: Write/edit code in place at project root, no nested project copy.

### v2026.4.106
Released on 04/30/2026
* DOCS: Update agent documentation.

### v2026.4.105
Released on 04/30/2026
* FEATURE: Stream live progress to CLI and MCP for every role and sub-CLI line.

### v2026.4.104
Released on 04/30/2026
* DOCS: Clarify MCP lives inside p3x-architect, fix npx invocation.

### v2026.4.103
Released on 04/29/2026
* FEATURE: Subscription-only mode via claude + codex CLI subprocesses.

### v2026.4.102
Released on 04/29/2026
* FEATURE: Initial multi-agent RUP pipeline taking requirements through Inception, Elaboration, Construction, and Transition phases.
* FEATURE: OpenAI and Claude integration for collaborative agent workflows.
* FEATURE: CLI and MCP server interfaces for invoking the pipeline.
* FEATURE: GPT-5.5 real-rate pricing support for accurate cost tracking.


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


[**P3X-ARCHITECT**](https://corifeus.com/architect) Build v2026.4.110

 [![NPM](https://img.shields.io/npm/v/p3x-architect.svg)](https://www.npmjs.com/package/p3x-architect)  [![Donate for PatrikX3 / P3X](https://img.shields.io/badge/Donate-PatrikX3-003087.svg)](https://www.paypal.com/cgi-bin/webscr?cmd=_s-xclick&hosted_button_id=QZVM4V6HVZJW6)  [![Contact Corifeus / P3X](https://img.shields.io/badge/Contact-P3X-ff9900.svg)](https://www.patrikx3.com/en/front/contact) [![Like Corifeus @ Facebook](https://img.shields.io/badge/LIKE-Corifeus-3b5998.svg)](https://www.facebook.com/corifeus.software)





[//]: #@corifeus-footer:end