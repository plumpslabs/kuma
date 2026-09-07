---
description: "⏪ Kuma Rollback — Restore codebase from a labeled checkpoint snapshot"
---
# /kuma:rollback

Restore codebase to the exact state captured in a previous checkpoint.

```javascript
kuma_safety({ action: "rollback_label", label: "[label-name]" })
```

If the label is not found, Kuma lists all available snapshots.
