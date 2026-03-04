# ✅ Draft PRs Created in GitHub

All 5 PRs have been created as **drafts** in the upstream repository. You can review them before publishing.

## Created PRs

### Bug Fixes (Independent)

1. **PR #5** — Stream Reliability Fixes  
   https://github.com/mikeyobrien/pi-provider-kiro/pull/5  
   Branch: `fix/stream-reliability` (2 commits)  
   Size: ~90 lines

2. **PR #6** — kiro-cli snake_case Fix  
   https://github.com/mikeyobrien/pi-provider-kiro/pull/6  
   Branch: `fix/kiro-cli-snake-case` (1 commit)  
   Size: 5 lines

3. **PR #7** — History Sanitization Fix  
   https://github.com/mikeyobrien/pi-provider-kiro/pull/7  
   Branch: `fix/history-sanitization` (1 commit)  
   Size: 16 lines

### Features

4. **PR #8** — Expired Credential Fallback  
   https://github.com/mikeyobrien/pi-provider-kiro/pull/8  
   Branch: `feat/expired-credential-fallback` (4 commits)  
   Size: ~100 lines

5. **PR #9** — Bedrock Fallback  
   https://github.com/mikeyobrien/pi-provider-kiro/pull/9  
   Branch: `feat/bedrock-fallback` (6 commits)  
   Size: ~750 lines

## Next Steps

### Review the PRs

Visit each PR URL above to review:
- The description and formatting
- The commits and code changes
- CI/test results (if any workflows run on draft PRs)

### When Ready to Publish

For each PR you want to publish:

**Option 1: Via GitHub UI**
1. Visit the PR URL
2. Click "Ready for review" button
3. Optionally request reviewers

**Option 2: Via CLI**
```bash
gh pr ready <PR-number>
# For example:
gh pr ready 5  # Makes PR #5 ready for review
```

### Publish All at Once
```bash
for pr in 5 6 7 8 9; do
  gh pr ready $pr
done
```

## PR Dependencies

**No strict dependencies** — all PRs can be reviewed in parallel:
- Bug fixes (5, 6, 7) are completely independent
- PR #8 includes PR #6 content (harmless if #6 merges first)
- PR #9 includes PR #5 and #6 content (harmless if they merge first)

## Current Status

✅ All PRs created as drafts  
✅ All descriptions formatted and ready  
✅ All branches pushed and up-to-date  
⏸️ Waiting for your review before publishing

## Notes

- Draft PRs are visible to maintainers but won't trigger review requests
- CI may or may not run on draft PRs (depends on repo settings)
- You can edit PR descriptions directly in GitHub if needed
- You can close/delete any PR if you change your mind

---

**To view all your draft PRs:**
```bash
gh pr list --author samfoy --draft
```

**To view PR details:**
```bash
gh pr view <PR-number>
```
