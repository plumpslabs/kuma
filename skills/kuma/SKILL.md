---
name: kuma-mcp
description: Kuma MCP — safety toolkit for AI coding agents
---

Kuma MCP tools: kuma_context, kuma_memory, kuma_safety.
Record what matters, skip what doesn't.

<kuma_obedience>
## 🔒 Obedience (non-negotiable)
- MUST call `kuma_context({ action: "init" })` at session start.
- MUST check blast radius `kuma_context({ action: "impact", target: "<file>" })` before touching core/shared modules.
- MUST record gotchas IMMEDIATELY when a bug/quirk is found.
- MUST call `kuma_safety({ action: "verify" })` after edits.
- MUST NOT call actions outside the 15 core actions.
</kuma_obedience>

<kuma_workflow>
🧠 **Before coding:** `kuma_context({ action: "init" })`
🗺️ **Monorepo map:** `kuma_context({ action: "map" })`
🔬 **Unfamiliar code / blast radius:** `kuma_context({ action: "research", scope: "<area>" })` or `kuma_context({ action: "impact", target: "<file>" })`
🐛 **Found a bug/quirk:** `kuma_memory({ action: "gotcha" })` (IMMEDIATELY)
🧭 **Chose between options:** `kuma_memory({ action: "decision" })`
🔀 **Traced a flow:** `kuma_memory({ action: "arch_flow" })` (max 5 files)
🛡️ **Before risky work / after edits:** `kuma_safety({ action: "guard" | "verify" })`
</kuma_workflow>

📖 Full rules: `.kuma/init.md`
