# AgentConnect development workflow

AgentConnect automation is enabled for `jj/arcadia` on the durable home Mac worker. The worker keeps the agent checkout and execution context available beyond an interactive session; native app execution still belongs in disposable task VMs. This runbook describes the enabled workflow, not a claim that every recovery path has been verified end to end. [Issue #25](https://joshs-mac-mini.tail81f644.ts.net/jj/arcadia/issues/25) is the first end-to-end readiness task on this worker.

## Issue to verified merge

1. Create an issue in [Gitea issues](https://joshs-mac-mini.tail81f644.ts.net/jj/arcadia/issues), or use an existing issue. State the problem, acceptance criteria and relevant verification. Adding the `agent` label starts implementation.
2. Human comments on a labeled issue can continue the work: add corrections, constraints or follow-up instructions in that issue's discussion. Keep the issue focused so the agent can work on one branch and one PR based on current `main`.
3. The implementer makes the change, runs relevant checks, pushes verified work and opens a linked [Gitea pull request](https://joshs-mac-mini.tail81f644.ts.net/jj/arcadia/pulls). The PR records the problem, solution, actual test results, evidence and remaining limitations. The daemon posts the agent's issue reply; the agent does not duplicate it.
4. New and updated PRs trigger a separate reviewer that checks **Standards** (repository guidance) and **Spec** (the originating issue's acceptance criteria). Review findings belong with the PR and its current revision.
5. Completed agent PRs are ready, not drafts. Gitea queues bot-authored PRs for squash merge after the required macOS CI, iOS CI and AgentConnect review checks pass. Agents must not bypass checks or change repository protections.

The implementer and reviewer are separate agent roles, but shared bot reviews are **not independent human approval**. The configured reviewer status is an automated merge gate, not a claim of human approval.

## Task execution contract

For each labeled issue, work from current `main` in an isolated worktree and keep
implementation and verification in that issue session. Do not move the entire
job into a self-delegated background session that makes the visible task look
finished while work is still running. Report concrete milestones and blockers;
do not post duplicate acknowledgements for opened/labeled deliveries.

Before native work, read the prepared-template section of
[native-feedback-loop.md](native-feedback-loop.md#prepared-development-template-and-readiness).
Use `arcadia-native-toolchain-27-1-v1` on `paseo-host`; normal `start` checks its
certificate before allocating a VM and checks tools again inside the fresh clone.
The worker currently runs Codex and the checkout on the MacBook Pro; the mini
hosts AgentConnect/Gitea, CI and every native task VM. Do not confuse worker
placement with native execution placement.

If readiness fails, stop native work, retain diagnostics and report the template
failure. Never install Mint/SwiftLint during feature work, bootstrap tools from
scratch, bypass certification with `--validate-template`, select a raw/older image,
or change app formatter configuration merely to accommodate a broken template.
Intentional formatting-policy changes need explicit issue scope and recertification.
Maintainers own template provisioning and certification.

Use `iterate` for fast current-frame visual feedback, targeted behavior tests
while editing, and the relevant final verification before creating a ready PR.
Preserve source/run/hash receipts for genuine before/after images. Keep generated
evidence outside Git; attach reviewed images/logs to the PR. Finish only after
verified increments are pushed, owned VM cleanup/evidence export succeeds and
the PR is ready for required CI/reviewer checks and guarded automatic merging.

## Native work on the durable worker

Read the maintained [native feedback-loop runbook](native-feedback-loop.md) and `./scripts/native-loop --help` before choosing commands. Run the existing background `scripts/native-loop` interface locally on the Mac mini for native builds, launches and tests. The MacBook is a client; omit `--host` on the mini. Do not open a host viewer, guest desktop or Xcode for ordinary automated work; inspect exported screenshots and logs.

Allocate one uniquely named, isolated VM per native task and reuse it during that task. The existing [shared admission policy](ci-performance.md#isolation-admission-and-diagnostics) limits the host to two VMs, including CI workers and task VMs. Respect admission and wait when capacity is busy; do not bypass it or delete another task, VM or cache to make room.

For example, substitute a fresh task name and a relevant XCTest identifier:

```sh
./scripts/native-loop --host paseo-host start issue-123-library
./scripts/native-loop --host paseo-host test issue-123-library --only-testing ArcadiaUITests/FeedbackLoopTests/testEmpty
# Iterate on the change in the same task VM.
./scripts/native-loop --host paseo-host test issue-123-library
./scripts/native-loop --host paseo-host lint issue-123-library
./scripts/native-loop --host paseo-host export issue-123-library
./scripts/native-loop --host paseo-host finish issue-123-library
```

Run targeted tests during iteration, then the required relevant behavioral tests and lint before requesting review/CI. The default test selection covers unit tests and `FeedbackLoopTests`; add the relevant suites explicitly. Follow the [iPhone](../test-environment/native/phone/README.md) and [Duo](../test-environment/native/duo/README.md) entrypoints for their actual device/runtime and behavioral requirements. Fixture checks, compilation and screenshots do not establish real audio, restoration or background behavior; select the appropriate verification for the acceptance criteria. Do not touch live Jellyfin data.

Choose affected layouts before collecting baselines. A change confined to `NowPlayingSidebar.swift` needs Mac comparisons; unknown/shared app files conservatively need Mac, iPhone and Duo. Mixed changes use the union of affected layouts. Nonvisual work needs behavioral evidence rather than images. Capture the affected baseline, then implement; unchanged-platform captures must not hold up a platform-specific edit. Reuse retained source-matching evidence within the task.

For visual changes, capture genuine before and after screenshots on every affected layout and inspect both. **Actual embedded screenshots are mandatory in the PR description before passing review or merging.** Local paths and archives support diagnostics; they do not satisfy this requirement. Publish using `scripts/pr-screenshots --pr NUMBER --pair mac BEFORE_RUN_DIR AFTER_RUN_DIR` (repeat `--pair iphone …` and `--pair duo …` for affected layouts). The command uploads existing reviewed native-loop PNGs, checks image/source/run receipts and the retained source archives against trusted Git app/project trees, verifies downloaded attachment hashes, embeds paired images and verifies the PR HTML. It reuses attachments on retries. The active scoped Git credential helper supplies authentication; an explicitly provided private `--token-file` is also supported. If a closed session’s credential helper has expired, use the maintained helper on `paseo-host` against retained run directories with its existing private bot token file; credentials stay on that host. Structured tools lacking upload support are not an evidence exemption. Upload/render failures block completion. The conservative merge-queue check treats every application Swift/asset change as requiring exactly one Mac, iPhone and Duo pair. It rejects such PRs without current-head embedded, accessible, hash-matching before/after evidence. Before captures default to the PR merge base. If baseline fixtures are needed, commit/push the fixture-only baseline in the feature branch before capture and pass that commit using `--before-ref SHA`. After captures must match current-head app/project sources; tests-only changes do not invalidate identical app sources. The merge-queue status is required alongside existing CI/review gates, and an evidence failure clears an existing schedule. The reviewer additionally verifies image content and design. Use the existing [capture/comparison and iteration commands](native-feedback-loop.md#faster-iterations-and-screenshot-comparisons); retain source/run provenance. Screenshots support visual review and do not establish behavioral correctness.

Export evidence, including failures, before releasing the owned VM. `finish` verifies a full evidence archive on the VM host before deleting owned resources and exports cleanup status. Check the archive and cleanup result; report retained resources or failed transfers honestly. Only clean up the task's own VM, containers and tunnels. Preserve other tasks and shared caches. Complete evidence export and owned-task cleanup before requesting review/CI. See [evidence and recovery details](native-feedback-loop.md#evidence-recovery-and-ci).

## Documentation-only work

Documentation-only work needs no app VM, app build or app screenshots. Verify links and command examples against the maintained CLI, run relevant static checks, and record actual output in the PR. For this runbook's readiness task, run:

```sh
python3 -m unittest discover -s scripts/native_loop -p "test_*.py"
```

Run these fake-provider tests with `NATIVE_LOOP_HOST` unset. If the worker session inherits it, prefix the command with `env -u NATIVE_LOOP_HOST` so fixture commands stay local rather than being redirected over SSH.

These runner tests need no VM and do not prove native app behavior or AgentConnect delivery/recovery.

## Verification limits and recovery

Automated review-to-fix, restart recovery and native orchestration have **not been fully proven end to end** on this durable worker. Enabled hooks and existing native-loop tooling are not evidence that those paths all succeed. Record what actually ran, its outcome and any blocker; do not describe an unexercised path as verified.

If work stalls, inspect the issue/PR discussion, current revision, logs and task status before continuing. For native work, use the existing `status`, evidence export and owned-task cleanup paths from the native runbook. Report real blockers with evidence rather than silently restarting, claiming success or reclaiming another task's resources. A later human comment on the labeled issue can continue work, but successful automatic recovery remains something to demonstrate.


## Automatic merge policy

Completed agent PRs are ready for review, not drafts. The first-party Gitea merge
queue squash-merges bot-authored PRs to `main` only after the required macOS CI,
iOS CI and `agentconnect/arcadia-reviewer` status checks pass. The main protection
rule also blocks rejected reviews; no administrative override is used.

`.gitea/workflows/auto-merge.yml` queues PRs opened by `arcadia-pilot-bot` from
this repository, without checking out or executing PR code. It uses the private
`AGENTCONNECT_MERGE_TOKEN` Actions secret and checks the event's exact head.
Superseded events are ignored. Human-authored PRs are not enrolled automatically.
The reviewer reports its verdict independently; the implementer must not bypass
checks or merge directly.


### Recovery and withdrawal

Open ready PRs only after verification and evidence publication. The queue respects drafts and cancellation; it never promotes a draft. When Josh cancels, preserve the branch, mark the PR draft or prefix its title `Cancelled`, close it through the Gitea API where available, and stop task work. A cancellation received during a turn must be acted on before further publishing. Feedback about an unchanged pending check needs no code change or PR edit.

A screenshot waiver is an explicit reviewed policy change on protected `main` in `.gitea/evidence-waivers.json`: include the PR number, exact head SHA, omitted `platforms`, ISO `expires_at`, and owner's approval in `reason`. Prose in a PR cannot grant its own waiver. A new head or expired waiver requires renewed policy review; all remaining image provenance and behavioral gates still apply.

When model capacity fails, resume the same session/worktree after bounded backoff; reconcile prior side effects before retrying. The mini daemon contains the pinned retry compatibility patch. After changing its installed bundle, verify no turns are running, reload the daemon, and confirm its process started after the modified bundle. An on-disk patch alone is not a deployment.

Capture permission dialogs and stale Device Hub selection are template/runner failures. Retain one diagnostic failure and use the maintained recovery path; repeated product tasks must not each improvise preference or permission repairs. Preserve completed behavioral evidence when capture is blocked.
