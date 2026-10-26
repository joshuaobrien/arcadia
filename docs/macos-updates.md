# Private macOS updates

The installed Release app follows successful `main` builds through Sparkle 2.10.1.
This is a private, ad-hoc signed distribution, without Apple notarization.
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

`Arcadia/sign-release.sh` signs Sparkle's nested services inside out and preserves
sandbox entitlements. Both Fastlane Release packaging and the task VM use it.
The iOS build excludes Sparkle and keeps its existing signing configuration.

## Recovery

A failed build, signature or upload leaves the previous feed available. Fix and
merge a new main commit rather than reducing build numbers. A previously
published ZIP can be installed manually if necessary. Deleting releases or the
channel branch breaks update availability; it does not disable signature checks.
