---
description: "🔬 Kuma Research — 5-step pre-edit research pipeline before editing unfamiliar code"
---
# /kuma:research

Run research pipeline before editing code you haven't touched before.

```javascript
kuma_context({ action: "research", scope: "[module or feature area]" })
```

**Pipeline Stages:**
1. Check research cache in `.kuma/kuma.db`
2. Query knowledge graph for related nodes and edges
3. Scan references and entry points
4. Compute blast radius and test coverage
5. Retrieve historical ADR decisions and gotchas
