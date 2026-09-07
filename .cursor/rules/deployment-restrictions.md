---
description: Never merge, publish, or add agent attribution
alwaysApply: true
---

# Deployment and Attribution Restrictions

## Never do these

- **Merge pull requests** — leave PRs open for human review
- **Push release tags** (`vX.Y.Z` or `vX.Y.Z-rc.N`) — releases are manual
- **Publish to Chrome Web Store** — publication is never automatic
- **Deploy to production** — deployments require explicit authorization

## Strip agent attribution

Do not mention Cursor (the editor or agent) in commit messages, PR titles, or PR bodies. Do not add `Made with Cursor`, `Co-authored-by: Cursor`, or similar attribution.

If a local git hook appends `Co-authored-by: Cursor`, strip it before push.

Product mentions of Cursor as a Pinar handoff target stay allowed when that is the feature being described.
