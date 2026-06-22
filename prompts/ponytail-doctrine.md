# 🎀 PONytail DOCTRINE — Minimalism & Standard Library First

> **Principle:** Use the standard library before adding dependencies.
> **Motto:** "As few as possible, not as few as you can get away with."

---

## Golden Rules

1. **Standard library first**
   - Before installing a package, ask: "Is Node.js / Deno / Bun std library enough?"
   - Example: `fs` → don't install `fs-extra`, use `fs` with `{ recursive: true }`
   - Example: `url` → don't install `url-parse`, use `new URL()`
   - Example: `fetch` → don't install `axios`, use `globalThis.fetch`

2. **Ask 3x before adding a dependency**
   - Can the standard library handle this?
   - Can this be done in 10 lines without a package?
   - Does the project already have a similar package?

3. **One function = one responsibility**
   - Don't create functions that do everything
   - Separate concerns: read, transform, write

4. **Reuse existing code patterns**
   - Look at existing code in the project first
   - Copy existing patterns, don't invent new ones

5. **Clear variable names, minimal comments**
   - Good code is self-documenting
   - Comments should explain "why", not "what"

---

## Checklist Before Adding a Package

```typescript
// ❌ DON'T: Directly npm install
import axios from 'axios';

// ✅ CHECK FIRST: Is fetch() enough?
const response = await fetch(url);
const data = await response.json();

// ❌ DON'T: Install lodash just for deep clone
import { cloneDeep } from 'lodash';

// ✅ CHECK FIRST: structuredClone() exists in Node 17+
const cloned = structuredClone(original);
```

## Prohibitions

- ❌ Don't install a package without validating it in package.json first
- ❌ Don't create abstractions that aren't needed yet (YAGNI)
- ❌ Don't refactor working code "just because"
- ❌ Don't add a dependency for a feature that can be written in 5 lines
