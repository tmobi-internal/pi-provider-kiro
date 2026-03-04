# ⚠️ Merge Conflict Analysis

## Summary

**YES, there are conflicts** between the branches. All three branches modify overlapping files, particularly `src/oauth.ts`, `src/stream.ts`, and `src/kiro-cli.ts`.

## Conflict Details

### Files Modified by Multiple Branches

| File | main | fix/auth-credential-refresh | fix/credential-fallback |
|------|------|----------------------------|------------------------|
| src/event-parser.ts | ✅ | ✅ | ✅ |
| src/kiro-cli.ts | ✅ | ✅ | ✅ |
| src/oauth.ts | ✅ | ✅ | ✅ |
| src/stream.ts | ✅ | ✅ | ✅ |
| src/history.ts | ❌ | ❌ | ✅ |
| src/fallback.ts | ❌ | ❌ | ✅ (new file) |
| src/index.ts | ❌ | ❌ | ✅ |

### Specific Conflict: src/oauth.ts

Both **main** and **fix/auth-credential-refresh** modify the same `refreshKiroToken()` function:

- **main**: Removes `refreshViaKiroCli()` call, renumbers layers to 1-2-3-4
- **fix/auth-credential-refresh**: Removes `refreshViaKiroCli()`, adds `getKiroCliCredentialsAllowExpired()`, adds new Layer 2.5

The changes are **semantically compatible** (both improve credential refresh) but modify the same lines of code.

## Recommended Strategy

### Option A: Sequential Merge with Manual Resolution (Current State)
Keep the current 3-PR approach but **expect to resolve conflicts** after PR #1 merges:

1. ✅ **PR #1** (main) - Clean merge into upstream
2. ⚠️ **PR #2** (fix/auth-credential-refresh) - **Will conflict** with PR #1 in `src/oauth.ts`
   - After PR #1 merges, you'll need to:
     - `git checkout fix/auth-credential-refresh`
     - `git pull upstream main`
     - Manually resolve conflicts in `src/oauth.ts`
     - `git push origin fix/auth-credential-refresh --force-with-lease`
3. ⚠️ **PR #3** (fix/credential-fallback) - **May conflict** with PR #1 and #2
   - Same resolution process after PR #1 and #2 merge

**Pros:** Clear separation of concerns for reviewers
**Cons:** Requires manual conflict resolution between PRs

---

### Option B: Consolidate into Larger PRs (Recommended)

Combine related work to avoid sequential conflicts:

#### **PR #1: Combined Error Handling & Auth Improvements**
Merge `main` + `fix/auth-credential-refresh` into a single branch locally first:
- All credential refresh improvements together
- All stream error handling together
- Single coherent story about auth reliability

```bash
git checkout -b pr/auth-improvements main
git merge fix/auth-credential-refresh
# Resolve conflicts once, locally
git push origin pr/auth-improvements
```

#### **PR #2: Bedrock Fallback**
Use `fix/credential-fallback` as-is, but rebase onto the new combined branch after PR #1 merges.

**Pros:** 
- Resolve conflicts once, locally, before creating PR
- Reviewers see the final integrated solution
- Cleaner commit history after merge

**Cons:** 
- Larger PRs may take longer to review
- Less granular attribution

---

### Option C: Rebase fix/auth-credential-refresh onto main BEFORE pushing

Since **fix/auth-credential-refresh** is conceptually "on top of" main's improvements, rebase it:

```bash
git checkout fix/auth-credential-refresh
git rebase main
# Resolve conflicts
git push origin fix/auth-credential-refresh --force-with-lease
```

Then create PRs in order:
1. PR #1: main → upstream
2. PR #2: fix/auth-credential-refresh (now includes main) → upstream  
3. PR #3: fix/credential-fallback → upstream

**Pros:**
- Clear dependency chain
- Each PR builds on the previous
- No conflicts if merged in order

**Cons:**
- PR #2 will contain all commits from PR #1 plus its own
- Upstream maintainer must merge in strict order

---

## Current Status

✅ All branches pushed to your fork
⚠️ Branches have **NOT** been resolved for conflicts yet
📋 You have multiple strategy options above

## What Was Actually Tested

I ran:
```bash
git checkout -b test upstream/main
git merge main                           # ✅ Success
git merge fix/auth-credential-refresh   # ❌ CONFLICT in src/oauth.ts
git merge fix/credential-fallback        # ⚠️ Couldn't test due to previous conflict
```

## Next Steps

1. **Decide on strategy** (A, B, or C above)
2. If choosing **Option B** or **Option C**, I can help create the consolidated/rebased branches
3. If choosing **Option A**, be prepared to resolve conflicts after each PR merges

Which approach would you prefer?
