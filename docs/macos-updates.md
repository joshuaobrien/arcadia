# Private macOS updates

The installed Release app follows successful `main` builds through Sparkle 2.10.1.
This is a private distribution signed with a stable self-signed identity, without Apple notarization.
The first installation may need macOS's normal **Open Anyway** approval. Do not
turn off Gatekeeper. Updates require access to the mini over Tailscale.

a successful main CI run → signed ZIP in Gitea Releases → signed appcast → Sparkle

Install the published `Arcadia-<build>.zip` from Gitea Releases once, unzip it and
put Arcadia in `~/Applications`. Keep using that installed copy. The separate
Debug preview app does not subscribe to updates. Release connects to Jellyfin;
it does not select deterministic development fixtures.

Sparkle checks automatically while the app runs (an hourly interval), downloads
updates and schedules installation on quit. **Arcadia → Check for Updates…**
checks immediately. A merge does not interrupt playback or launch a closed app.

## Publishing

The existing macOS CI runs its lint, formatting and unit tests before packaging.
On successful main pushes only, `scripts/publish-macos-update` uses Sparkle's
pinned, SHA-256-verified `sign_update` tool to sign both the ZIP and the appcast.
The release version is main's first-parent commit count (`CFBundleVersion`).
Per-build release assets are immutable. The `macos-updates` branch's appcast is
updated last with Gitea's file-SHA compare-and-swap. Superseded or older builds
cannot roll the channel backwards. PR and manual benchmark runs do not publish.

`SUPublicEDKey` is public and committed. `ARCADIA_SPARKLE_PRIVATE_KEY` is an
Actions secret; a restricted backup is on the mini at
`~/.config/arcadia-updates/ed25519-seed`. Never commit or log that seed. The
publisher uses the existing repository bot's Actions token for Gitea writes.
Treat the seed as release authority; changing it requires a planned key rotation.

`ARCADIA_MACOS_SIGNING` holds the dedicated private code-signing certificate and
password. Only main-push Release builds receive it. The packaging helper pins
its public certificate fingerprint, creates a temporary guest keychain, grants
code-signing trust for that certificate inside the disposable guest, then removes
the private keychain. The guest is destroyed after CI. Neither host Mac gains a
new trust root. A stable self-signed identity does **not** prevent Keychain
reapproval after updates: the tested macOS file Keychain also records a
build-specific code-hash partition. Expect a normal Keychain approval prompt
when an updated app restores its Jellyfin session. Do not broaden the item's
access controls or change host trust to suppress that prompt. A signing backup
lives beside the Sparkle seed on the mini.

`Arcadia/sign-release.sh` signs Sparkle's nested services inside out and preserves
sandbox entitlements. Both Fastlane Release packaging and the task VM use it.
The local `ArcadiaUpdates` Swift package declares Sparkle as a macOS-only dependency. The iOS build keeps its existing signing configuration.

## Recovery

A failed build, signature or upload leaves the previous feed available. Fix and
merge a new main commit rather than reducing build numbers. A previously
published ZIP can be installed manually if necessary. Deleting releases or the
channel branch breaks update availability; it does not disable signature checks.

## Acceptance evidence and limitation

The disposable-VM test installed build 201, connected to a disposable real
Jellyfin server, automatically downloaded build 202 and installed it on normal
quit. Both apps had the same certificate-pinned designated requirement. The
client did not trust the certificate. Build 202 passed signature verification
but encountered a Keychain authorization dialog on session restoration; the
no-prompt acceptance test failed. This remains a distribution decision, not a
passing seamless-update claim.

The test item's access-control metadata retained the correct certificate
requirement while its partition remained `cdhash:<build-201-hash>`. Apple's
[Security implementation](https://github.com/apple-oss-distributions/Security/blob/main/securityd/src/clientid.cpp)
classifies recognized Apple developer signatures by team and other signed code
by code hash. Reusing a self-signed certificate alone therefore does not establish
an update-stable Keychain partition.

The explicit installed-app tests are in `MacUpdateTests`. They require a private
`/tmp/arcadia-macos-update-test.json` in the disposable guest with `server`,
`username`, `password`, `installedApp`, `beforeBuild` and `afterBuild`. The harness
must install and run the real Release app, use the same isolated session namespace
across launches, and remove signing trust before either client acceptance test.
The regular suite skips these tests without that explicit harness. Never export
the private configuration or approve a dialog and report the no-prompt test as
passing.
