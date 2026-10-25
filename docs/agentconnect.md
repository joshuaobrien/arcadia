# AgentConnect development workflow

AgentConnect automation is enabled for `jj/arcadia` on the durable home Mac worker. The worker keeps the agent checkout and execution context available beyond an interactive session; native app execution still belongs in disposable task VMs. This runbook describes the enabled workflow, not a claim that every recovery path has been verified end to end. [Issue #25](https://joshs-mac-mini.tail81f644.ts.net/jj/arcadia/issues/25) is the first end-to-end readiness task on this worker.

## Issue to human approval

1. Create an issue in [Gitea issues](https://joshs-mac-mini.tail81f644.ts.net/jj/arcadia/issues), or use an existing issue. State the problem, acceptance criteria and relevant verification. Adding the `agent` label starts implementation.
2. Human comments on a labeled issue can continue the work: add corrections, constraints or follow-up instructions in that issue's discussion. Keep the issue focused so the agent can work on one branch and one PR based on current `main`.
3. The implementer makes the change, runs relevant checks, pushes verified work and opens a linked [Gitea pull request](https://joshs-mac-mini.tail81f644.ts.net/jj/arcadia/pulls). The PR records the problem, solution, actual test results, evidence and remaining limitations. The daemon posts the agent's issue reply; the agent does not duplicate it.
4. New and updated PRs trigger a separate reviewer that checks **Standards** (repository guidance) and **Spec** (the originating issue's acceptance criteria). Review findings belong with the PR and its current revision.
5. The PR stops for human review and approval. No automatic merging is enabled. Agents do not merge, enable auto-merge or change repository protections.

The implementer and reviewer are separate agent roles, but shared bot reviews are **not independent human approval**. A bot approval does not replace a person's decision to approve and merge.

## Native work on the durable worker

Read the maintained [native feedback-loop runbook](native-feedback-loop.md) and `./scripts/native-loop --help` before choosing commands. Use the existing background `scripts/native-loop --host paseo-host` interface for native builds, launches and tests. Do not open a host viewer, guest desktop or Xcode for ordinary automated work; inspect exported screenshots and logs.

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

For visual changes, capture genuine before and after screenshots on every affected Mac, iPhone and Duo layout, inspect both, and include reviewable image evidence in the PR. Use the existing [capture/comparison and iteration commands](native-feedback-loop.md#faster-iterations-and-screenshot-comparisons); retain source/run provenance. Screenshots support visual review and do not establish behavioral correctness.

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
