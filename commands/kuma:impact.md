---
description: "💥 Kuma Impact — Calculate blast radius, affected consumers, and safety risk score"
---
# /kuma:impact

Evaluate blast radius before modifying high-leverage files or shared packages.

```javascript
kuma_context({ action: "impact", target: "[file or package path]" })
```

**What it returns:**
- Direct and transitive consumers
- Downstream affected packages in monorepos
- Mapped test suites to run
- Safety risk level (`low`, `medium`, `high`, `critical`)
