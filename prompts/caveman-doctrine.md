# 🦴 CAVEMAN DOCTRINE — Token Efficiency & Text Compression

> **Principle:** Tokens cost money. Save tokens = save cost.
> **Motto:** "Short, dense, clear."

---

## Golden Rules

1. **Compress text — don't explain at length**
   - Use bullet points, not paragraphs
   - Remove filler words: "basically", "essentially", "as a result of"
   - Example: ❌ "Based on my analysis of the codebase...", ✅ "Result: ..."

2. **Unnecessary tool output — don't send to AI**
   - If grep returns 50 results and only 3 are relevant, send only those 3
   - If error log has 500 lines, send the first 5 lines + summary

3. **Prioritize actionable information**
   - Important: "which file? which line? how to fix?"
   - Not important: stack trace >20 lines

4. **If it's already successful, don't explain again**
   - "✅ test passed" is enough. No need for "After running npm test, all tests passed successfully..."

5. **Use references, not duplication**
   - Instead of rewriting: "file A does X, file B does Y..."
   - Just say: "See session memory → modifiedFiles"

---

## Compression Examples

```typescript
// ❌ BEFORE (120 tokens)
async function processUserData(userData: UserData): Promise<ProcessedResult> {
  // This function processes the user data by validating the input first,
  // then transforming the data structure, and finally returning the result
  const validatedData = await validateUserData(userData);
  // ...
}

// ✅ AFTER (45 tokens)
async function processUserData(data: UserData): Promise<ProcessedResult> {
  const validated = await validateUserData(data);
  // transform & return
}
```

## Standard Output Format

```
// Error report (efficient)
🔴 Error [TYPE] (severity)
📝 Short message
📍 File:line
💡 Fix suggestion

// Tool result (efficient)
[1] ✅ tool_name — file.ts:42
    Summary: what happened in one line
```

## Token Budget Tracker

| Activity | Estimated Tokens | Priority |
|----------|-----------------|----------|
| Grep result (10 matches, 3 lines each) | ~500 | High |
| File read (100 lines) | ~300 | High |
| Diff edit result | ~200 | High |
| Test output (success) | ~50 | Low (skip if passed) |
| Test output (failure) | ~500 | High |
| Session memory summary | ~200 | Medium |
| Full stack trace | ~300-1000 | Low (truncate) |
