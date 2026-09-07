---
description: "📸 Kuma Checkpoint — Create an atomic named snapshot before risky work"
---
# /kuma:checkpoint

Take an atomic rollback snapshot of current files and knowledge graph.

```javascript
kuma_safety({ action: "checkpoint", label: "[pre-refactor-feature-x]" })
```

Creates `<label>/` snapshot with `kuma.db` + modified files.
