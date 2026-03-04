# Clean PR Plan — pi-provider-kiro

All branches rebuilt from scratch, removing redundancies and separating bug fixes from features.

## What Changed from the Original Plan

**Removed redundant work:**
- `505e18f` split apart — snake_case fix superseded by more thorough `bdd8804`, oauth change moved to Bedrock fallback PR

**Separated bug fixes:**
- Each bug fix is now on its own branch for independent review

**Rebuilt feature branches:**
- `feat/expired-credential-fallback` — clean 4 commits, no conflicts
- `feat/bedrock-fallback` — includes prereq bug fixes + Bedrock feature

---

## Bug Fix PRs (3 independent PRs)

### PR #1: Stream Reliability Fixes
**Branch:** `fix/stream-reliability` (2 commits)  
**Base:** `upstream/main`

**Title:** `fix: improve stream reliability — 403 token refresh and error event handling`

**Description:**
Two focused stream reliability improvements:

1. **Refresh token from kiro-cli on 403 before retrying** (b19f877)
   - When receiving 403 Forbidden, check kiro-cli DB for a fresh token before retrying
   - Handles case where another process has already refreshed credentials
   - Reduces auth errors during long-running sessions

2. **Handle error events mid-stream and reset idle timer correctly** (d056c56)
   - Add 'error' event type to parser so mid-stream API errors are surfaced
   - Start idle timer after first token, reset only on meaningful events
   - Prevents keepalive data from masking stalled streams

**Files:** `src/event-parser.ts`, `src/stream.ts`, `test/stream.test.ts`

**URL:** https://github.com/mikeyobrien/pi-provider-kiro/compare/main...samfoy:pi-provider-kiro:fix/stream-reliability

---

### PR #2: kiro-cli snake_case Fix
**Branch:** `fix/kiro-cli-snake-case` (1 commit)  
**Base:** `upstream/main`

**Title:** `fix: read snake_case device registration credentials from kiro-cli`

**Description:**
kiro-cli's SQLite DB stores device registration as `client_id`/`client_secret` (snake_case) but the code expected `clientId`/`clientSecret` (camelCase). IDC refresh credentials were always empty and token refresh could never work.

Also fixes the device-registration query to match the same key prefix as the token (kirocli vs codewhisperer) instead of grabbing whichever comes first.

**Files:** `src/kiro-cli.ts`

**Commits:**
```
bdd8804 fix: read snake_case device registration credentials from kiro-cli
```

**URL:** https://github.com/mikeyobrien/pi-provider-kiro/compare/main...samfoy:pi-provider-kiro:fix/kiro-cli-snake-case

---

### PR #3: History Sanitization Fix
**Branch:** `fix/history-sanitization` (1 commit)  
**Base:** `upstream/main`

**Title:** `fix: drop empty assistant messages from history sanitization`

**Description:**
Remove assistant messages with no content and no tool uses before sending to Kiro API. These empty messages can occur from API errors and cause validation failures.

**Files:** `src/history.ts`, `test/history.test.ts`

**Commits:**
```
8d1b8ee fix: drop empty assistant messages from history sanitization
```

**URL:** https://github.com/mikeyobrien/pi-provider-kiro/compare/main...samfoy:pi-provider-kiro:fix/history-sanitization

---

## Feature PRs (2 larger features)

### PR #4: Expired Credential Fallback
**Branch:** `feat/expired-credential-fallback` (4 commits)  
**Base:** `upstream/main`

**Title:** `feat: use expired kiro-cli credentials as fallback in OAuth refresh cascade`

**Description:**
Enhances the credential refresh cascade to use expired kiro-cli credentials as a fallback when OAuth refresh fails. This improves reliability when desktop app credentials exist but OAuth flow fails.

**Layers:**
1. **Fix snake_case credentials** (prerequisite, same as PR #2)
2. **Add getKiroCliCredentialsAllowExpired()** — retrieves creds even when access token is expired
3. **Add expired creds fallback in loginKiroBuilderID()** — try refreshing expired creds before device code flow
4. **Add Layer 4 in refreshKiroToken()** — try refreshing expired kiro-cli creds when all other layers fail

**5-layer refresh cascade:**
- Layer 1: Pre-check for valid kiro-cli creds
- Layer 2: Direct refresh with current refresh token
- Layer 3: Re-read kiro-cli (may have been updated mid-refresh)
- Layer 4: Try refreshing expired kiro-cli creds
- Layer 5: Graceful degradation (return stale creds with buffer)

**Files:** `src/kiro-cli.ts`, `src/oauth.ts`, `test/oauth.test.ts`

**Commits:**
```
afb5ec5 fix: read snake_case device registration credentials from kiro-cli
ceb9add feat: add getKiroCliCredentialsAllowExpired for expired token refresh
6d5e82d feat: use expired kiro-cli creds as fallback in oauth refresh cascade
373ab31 test: update oauth tests for expired credential fallback
```

**URL:** https://github.com/mikeyobrien/pi-provider-kiro/compare/main...samfoy:pi-provider-kiro:feat/expired-credential-fallback

---

### PR #5: Bedrock Fallback
**Branch:** `feat/bedrock-fallback` (6 commits)  
**Base:** `upstream/main`

**Title:** `feat: add Bedrock fallback with automatic provider tagging`

**Description:**
Adds AWS Bedrock as a fallback provider when Kiro API fails. Automatically maps Kiro model IDs to Bedrock equivalents and routes requests to Bedrock on auth failures, 5xx errors, or timeouts.

**Includes prerequisite fixes:**
- Stream reliability fixes (PR #1)
- kiro-cli snake_case fix (PR #2)

**New capabilities:**
1. **Bedrock fallback module** (673 lines)
   - Maps 17 Kiro models to Bedrock equivalents (Claude, Llama, Mistral, etc.)
   - Auto-detects AWS profile and region from environment
   - Tags events with `provider: "bedrock"` for UI transparency

2. **OAuth graceful degradation for fallback**
   - Returns stale credentials with short TTL instead of throwing
   - Allows stream attempt to proceed — if token is expired, Bedrock takes over
   - Removes unused `EXPIRES_BUFFER_MS` constant

**Files:** 
- New: `src/fallback.ts`, `test/fallback.test.ts`
- Modified: `src/index.ts` (uses `streamWithFallback`), `src/oauth.ts`, `src/kiro-cli.ts`, `src/event-parser.ts`, `src/stream.ts`

**Commits:**
```
6ed000a fix: refresh token from kiro-cli on 403 before retrying
4519eb3 fix: handle error events mid-stream and reset idle timer on meaningful events
bb55ba9 fix: read snake_case device registration credentials from kiro-cli
34a70e8 feat: add Bedrock fallback with provider tagging in status
435cd5a fix: throw Bedrock errors instead of leaking error events to UI
772e394 fix: return stale credentials on refresh failure to allow Bedrock fallback
```

**Requirements:**
- Requires `pi-provider-bedrock` as peer dependency
- Uses `PI_BEDROCK_PROFILE` or `AWS_PROFILE` env vars
- Automatic region selection based on model type

**URL:** https://github.com/mikeyobrien/pi-provider-kiro/compare/main...samfoy:pi-provider-kiro:feat/bedrock-fallback

---

## Summary

**5 PRs total:**
- 3 bug fix PRs (independent, small, easy review)
- 2 feature PRs (larger, can be reviewed in parallel)

**All tests pass:** 222-234 tests per branch  
**No merge conflicts:** All branches built cleanly from `upstream/main`  
**Ready to create:** Whenever you're ready

## Old Branches (Can Delete)

- `main` — superseded by bug fix branches
- `fix/auth-credential-refresh` — superseded by `feat/expired-credential-fallback`
- `fix/credential-fallback` — superseded by `feat/bedrock-fallback`
- `fix/idle-timeout` — already merged upstream
- `pr/auth-improvements` — temp branch, not needed

To clean up:
```bash
git branch -D main fix/auth-credential-refresh fix/credential-fallback pr/auth-improvements
git push origin --delete main fix/auth-credential-refresh fix/credential-fallback
```
