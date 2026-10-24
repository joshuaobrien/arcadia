# Reconcile Gitea feedback before merge

Research date: 24 October 2026. Decision: [Determine how Gitea feedback can be reconciled before merge](http://100.112.160.16:3456/tasks/85), under [Reliable agent work from feedback to verified merge](http://100.112.160.16:3456/tasks/84). Research only: no application, PR, CI or protection changes.

## Finding

A maintained Arcadia command can collect feedback, track explicit dispositions and refuse its own merge when feedback changes. Native Gitea protection can reinforce approval and exact-head checks, but cannot alone require meaningful responses to ordinary owner comments. A late comment does not change the commit, so a green commit status is insufficient.

The deployed read-only version endpoint returned **1.27.3**, matching the saved [deployed Swagger](http://100.112.160.16:3030/swagger.v1.json). The missed [inline Play/Pause request](http://100.112.160.16:3030/jj/arcadia/pulls/18#issuecomment-93) was a timeline comment, incorrectly deferred by the agent before [Use inline Play/Pause for the current song](http://100.112.160.16:3030/jj/arcadia/pulls/20) corrected it. Coverage alone would not have fixed the mistaken disposition: substantive review remains necessary.

## Collection contract

Relative API root: `/api/v1/repos/jj/arcadia`.

| Source | Endpoint | Handling |
| --- | --- | --- |
| PR requirement and revision | `GET /pulls/{index}` | Include title/body, head and base SHAs. Text edits can change intent without a new head. |
| Timeline comments | `GET /issues/{index}/comments` | Separate from reviews. `since`/`before` filter updated timestamps. No pagination advertised. |
| Review summaries | `GET /pulls/{index}/reviews?page=1&limit=...` | Paginate to completion; collect body, state, commit, stale/dismissed status and updated time. |
| Inline comments | `GET /pulls/{index}/reviews/{id}/comments` for every review | Collect stable ID, body, timestamps, original/current commit/location and resolver; no pagination advertised. |

The timeline endpoint explicitly filters `CommentTypeComment`, so it is not a general timeline/review feed. Review summaries and inline comments require their own requests. Sources: [version-pinned issue implementation](https://github.com/go-gitea/gitea/blob/v1.27.3/routers/api/v1/repo/issue_comment.go), [review implementation](https://github.com/go-gitea/gitea/blob/v1.27.3/routers/api/v1/repo/pull_review.go), deployed Swagger. Resolve/unresolve exists for review comments; ordinary comments lack an equivalent resolved field. A resolved thread is metadata, not semantic acceptance.

Use full reconciliation at the final gate, not only a timestamp cursor. Retain earlier snapshots so deletion becomes a visible tombstone rather than disappearing silently. Current APIs cannot reconstruct deleted bodies. Failure, unauthorized/incomplete collection and pagination failure must block, never masquerade as an empty clean review. Collection sees only feedback visible to its authenticated account; do not claim to inspect another author's unpublished draft review.

## Recommended mechanics

These are proposed mechanics, not new policy decisions:

1. Key canonical feedback by repository, PR, kind and stable object ID. Retain author, body SHA-256, timestamp and relevant review/location/state. Hash sorted records with PR requirement text, base/head SHAs and policy version. Body hashes avoid depending only on timestamp precision.
2. Record dispositions against exact source fingerprints: implemented with evidence; agreed unchanged with agreement evidence; informational with rationale; or unresolved. Include response URLs. Explicitly classify bot/author messages rather than automatically omitting them. Separate complete coverage from judging whether the response satisfies the problem's spirit.
3. Give adversarial reviewers the complete manifest alongside spec, diff and evidence. Changed feedback invalidates its disposition; changed implementation invalidates affected acceptance evidence. Never infer owner agreement from an acknowledgement or the agent's own reasoning.
4. Immediately before merging, reread PR identity, complete feedback, exact-head checks and current reviews/base. Refuse mismatches. Use immediate merge with `head_commit_id`, no force and no scheduled auto-merge. Persist receipt and resulting merge SHA. The deployed merge schema exposes expected head; inspect/test the exact-version [merge implementation](https://github.com/go-gitea/gitea/blob/v1.27.3/routers/api/v1/repo/pull.go) in a disposable PR before making enforcement claims.
5. State the remaining race honestly: the merge API accepts no feedback-revision token. A comment can arrive between the final fetch and merge. A webhook inbox and restricted coordinator reduce bypasses/delays but do not make comment creation and merge an atomic transaction.

Test the missed ordinary-comment shape, inline-only and summary-only requests, multiple review pages, edits with unchanged head, deletions, duplicate replies, stale/dismissed reviews, changed base/head, API failure and feedback during merge preparation. Those tests prove collection/invalidation, not subjective quality of responses.

## Native enforcement and access

Gitea supports approvals, stale approval policies, rejected-review and official-review-request blocking, outdated-branch blocking, merge allowlists and administrator enforcement. Required contexts succeed on the **head commit**. These reinforce the gate but documented protections contain no arbitrary prose-disposition ledger. [Protected branches](https://docs.gitea.com/1.27/usage/access-control/protected-branches/).

Separate read-only reporting from response publication and merging. Use minimum applicable scopes plus repository permission, verified against the deployed server: read issue/repository for collection, write scopes only where required. Resource-category scopes are not action-specific merge-only credentials. Keep credentials outside source, receipts and build VMs; do not institutionalize the retrospective's transient administrative token procedure. [API scopes](https://docs.gitea.com/1.27/development/api-usage/).

Webhooks support timeline comment creation/edit/deletion and review events. Verify signatures, persist/deduplicate and reread authoritative state, with periodic reconciliation for missed deliveries. Do not assume umbrella review subscriptions are separate delivered events. An event-driven required feedback context can turn pending, but asynchronous delivery leaves a stale-success interval: it supplements the authoritative final read. [Webhook documentation](https://docs.gitea.com/usage/repository/webhooks/).

## Human decisions still needed

- Is an initially maintained guarded command sufficient, or must manual/API merges be restricted to a coordinator? The latter expands operational and credential scope.
- Who can classify informational feedback and accept an unchanged disposition, and what records agreement? The user already requires an agreed reason; tooling cannot invent agreement.
- Which evidence refreshes after base-only changes, and how are explicit emergency overrides recorded?

Recommendation: start with maintained complete collection plus guarded immediate merge, using existing native checks. Add a persistent service only if the enforcement decision requires bypass resistance. No PR is opened for this throwaway research branch.
