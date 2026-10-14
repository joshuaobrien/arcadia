# iPhone implementation checkpoint — work in progress

The shared iPhone composition, source-neutral browsing content, readable song metadata, fixture empty/error recovery and accessibility-sized compact transport are integrated and verified. This worker checkpoint is not a ticket completion or a replacement for PR acceptance evidence.

A real Jellyfin journey has passed connection, paged Search to the known controlled song, playback presentation, Play Next, advancing and disconnecting. The native Passwords save prompt was confirmed with a full-device screenshot and handled through its actual remote UI service. Compact transport is now disabled while expanded presentation is open so the controls have unique accessibility targets.

The direct simulator application process produced genuine stereo Float32 48 kHz PCM. Full output acceptance remains failed: the playing phase rendered 680 Hz while the controlled rewind expected 520 Hz. A minimal shared slider binding change attempts to commit accessibility value changes as well as pointer scrubbing; the subsequent public elapsed-position assertion still failed. The next diagnostic must resolve the actual accessibility role/value of the elapsed element, retain the zero-to-two-second rewind assertion, and then pass all five known output phases, including paused seeking.

Existing CI defaults are preserved. Build, test and capture operations run in the existing isolated background task VM. Failed captures and test bundles are retained independently from passing evidence. This checkpoint is intentionally not merged as accepted implementation.
