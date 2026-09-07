---
description: "🛡️ Kuma Guard — Pre-flight safety check against anti-patterns, drift, and circular deps"
---
# /kuma:guard

Verify safety boundaries before applying complex refactors or multi-file edits.

```javascript
kuma_safety({ action: "guard", guardGoal: "[what you are doing]" })
```

**What it checks:**
- Missing pre-modification research
- Architecture boundary violations & circular imports
- Scope drift (editing files outside declared goal)
- Runaway execution loops
