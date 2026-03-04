# PR Plan for pi-provider-kiro

All branches have been committed, rebased, and pushed to your fork (samfoy/pi-provider-kiro).
Ready to create PRs against upstream (mikeyobrien/pi-provider-kiro).

## Current Status

✅ All changes committed
✅ Branches rebased and conflict-free
✅ Pushed to your fork (origin)
🔲 PRs not yet created (as requested)

## Recommended PR Strategy

Create **3 separate PRs** in this order:

---

### PR #1: Error Handling Improvements
**Branch:** `main` (2 commits ahead of upstream)
**Base:** `upstream/main`

**Title:** `fix: improve error handling and token refresh reliability`

**Description:**
Improves error handling and token refresh reliability with two focused fixes:

1. **Refresh token from kiro-cli on 403 errors before retrying** (b19f877)
   - When receiving 403 Forbidden, attempt to refresh credentials via kiro-cli
   - Falls back to existing retry logic if refresh fails
   - Reduces auth errors during long-running sessions

2. **Handle error events mid-stream and reset idle timer on meaningful events** (d056c56)
   - Properly handle error events that arrive mid-stream (after start event)
   - Reset idle timeout timer on all meaningful events (content, tool use, etc.)
   - Prevents premature timeout during legitimate streaming pauses

**Files Changed:** `src/stream.ts`, `test/stream.test.ts`

**Commits:**
```
b19f877 fix: refresh token from kiro-cli on 403 before retrying
d056c56 fix: handle error events mid-stream and reset idle timer on meaningful events
```

---

### PR #2: Enhanced Credential Refresh Logic
**Branch:** `fix/auth-credential-refresh`
**Base:** `upstream/main` (will include PR #1 commits after it merges, or base on main)

**Title:** `feat: use expired kiro-cli credentials as fallback in OAuth refresh`

**Description:**
Enhances the credential refresh cascade to use expired kiro-cli credentials as a fallback when OAuth refresh fails. This improves reliability when desktop app credentials exist but OAuth flow fails.

**Changes:**
1. **Read snake_case device registration credentials from kiro-cli** (bdd8804)
   - kiro-cli stores credentials with snake_case field names (device_registration_url)
   - Add camelCase conversion when reading from SQLite

2. **Add getKiroCliCredentialsAllowExpired** (eb937ba)
   - New function that retrieves credentials even if expired
   - Used during OAuth refresh fallback cascade
   - Includes expiration checking logic

3. **Use expired kiro-cli creds as fallback in OAuth refresh cascade** (e0f8130)
   - When OAuth refresh fails, try refreshing expired kiro-cli credentials
   - 4-layer cascade: OAuth refresh → kiro-cli valid → kiro-cli expired → OAuth flow
   - Reduces auth interruptions when both credential sources are available

**Files Changed:** `src/kiro-cli.ts`, `src/oauth.ts`, `src/event-parser.ts`, `src/stream.ts`, `test/oauth.test.ts`, `test/stream.test.ts`

**Commits:**
```
bdd8804 fix: read snake_case device registration credentials from kiro-cli
eb937ba feat: add getKiroCliCredentialsAllowExpired for expired token refresh
e0f8130 feat: use expired kiro-cli creds as fallback in oauth refresh cascade
```

---

### PR #3: Bedrock Fallback and History Improvements
**Branch:** `fix/credential-fallback`
**Base:** `upstream/main` (will include PR #1 and #2 commits after they merge)

**Title:** `feat: add Bedrock fallback with automatic provider tagging`

**Description:**
Adds AWS Bedrock as a fallback provider when Kiro API fails, with automatic provider tagging and improved history sanitization.

**Changes:**
1. **Drop empty assistant messages from history sanitization** (8d1b8ee)
   - Remove assistant messages with no content before sending to Kiro
   - Prevents API errors from malformed history
   - Maintains alternating user/assistant structure

2. **Add Bedrock fallback with provider tagging in status** (cce66ea)
   - New `src/fallback.ts` module with model mapping (Claude, Llama, Mistral)
   - Auto-detects AWS profile and region from environment
   - Tags streaming events with `provider: "bedrock"` for UI transparency
   - Seamless failover when Kiro returns 5xx errors or timeouts

3. **Kiro-cli credential fallback and token refresh** (505e18f)
   - Integrate fallback logic with existing credential refresh
   - Try kiro-cli credentials when OAuth fails before falling back to Bedrock
   - Better error messages indicating which provider is being used

4. **Throw Bedrock errors instead of leaking error events to UI** (44dbca8)
   - When Bedrock fallback also fails, throw error for proper handling
   - Prevents error events from reaching the UI inappropriately
   - Maintains clean error propagation chain

**Files Changed:** 
- New: `src/fallback.ts`, `test/fallback.test.ts`
- Modified: `src/history.ts`, `src/index.ts`, `src/kiro-cli.ts`, `src/oauth.ts`
- Tests: `test/history.test.ts`, `test/kiro-cli.test.ts`, `test/oauth.test.ts`

**Commits:**
```
8d1b8ee fix: drop empty assistant messages from history sanitization
cce66ea feat: add Bedrock fallback with provider tagging in status
505e18f fix: kiro-cli credential fallback and token refresh
44dbca8 fix: throw Bedrock errors instead of leaking error events to UI
```

**Requirements:**
- Requires pi-provider-bedrock as a peer dependency
- Uses AWS profile from `PI_BEDROCK_PROFILE` or `AWS_PROFILE` env vars (defaults to "default")
- Automatic region selection based on model type (US/EU inference profiles)

---

## Dependency Notes

- **PR #2** builds on PR #1 (both modify stream.ts)
- **PR #3** is independent and can be reviewed in parallel
- After PR #1 merges, you may want to rebase PR #2 and #3 onto latest upstream/main
- All PRs are non-breaking and additive in nature

## Testing

All branches have passing tests:
- 108 tests pass in main
- All modified tests updated for new behavior
- New test files added for new modules (fallback.test.ts)

Run tests with: `npm test`

## Branch URLs (for PR creation)

When ready to create PRs, use these branches from your fork:
- PR #1: `samfoy:main` → `mikeyobrien:main`
- PR #2: `samfoy:fix/auth-credential-refresh` → `mikeyobrien:main`
- PR #3: `samfoy:fix/credential-fallback` → `mikeyobrien:main`
