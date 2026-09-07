---
description: "🐻 Kuma Init — Initialize session context, lean brief (<500 tokens), and branch tracking"
---
# /kuma:init

Initialize Kuma session context before writing any code.

```javascript
kuma_context({ action: "init", goal: "[current task goal]" })
```

**What it does:**
- Restores cross-session shadow memory
- Loads fresh gotchas for the active branch
- Evaluates repository rules and path constraints
- Informs about branch switches
