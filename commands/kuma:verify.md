---
description: "🧪 Kuma Verify — Post-edit scoped test verification and validation"
---
# /kuma:verify

Run scoped tests and verify that changes did not introduce regressions.

```javascript
kuma_safety({ action: "verify", scope: "[modified scope or file]" })
```

**What it does:**
- Automatically identifies appropriate test runner (Jest, Vitest, Pytest, Go test, Cargo)
- Executes tests restricted to the modified blast radius
- Records pass/fail metrics in session memory
