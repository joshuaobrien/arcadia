# Source-keyed tap-only capture helper

Run this utility only inside the owned, logged-in disposable macOS task guest. It builds the current checked-in `../audio-capture.swift` and `../audio-capture.plist`; it does not fetch a historical executable, change source, create VMs, grant permissions, or launch capture. It preserves the committed 48 kHz interleaved Float32 stereo `[2]` input-layout guards. Building a binary does not establish actual output acceptance.

Select the prepared Xcode and an owned private cache directory:

```sh
export DEVELOPER_DIR=/Applications/Xcode_27.1.app/Contents/Developer
python3 test-environment/native/phone/audio_helper.py build --cache "$TASK/audio-helper-cache"
```

The JSON result provides absolute `binary` and `manifest` paths, actual binary/source/plist/toolchain SHA256 values, and `cache_key`. Preserve the complete `<cache>/<key>/` entry, including `AudioCapture.app`, `manifest.json`, frozen source and `build.log`, when transferring it between owned task directories. The executable is `AudioCapture.app/Contents/MacOS/pilot`. The app is compiled for the guest's native architecture with a macOS26 minimum, using selected macOS `swiftc`/SDK and ad-hoc signing; the app's Info.plist contains the capture-purpose description.

The cache key includes source bytes, plist bytes, compiler invocation path and resolved executable hash/version, SDK path/version/build, native architecture, deployment/compile flags, signing flags and manifest schema. A source, plist, SDK or compiler change selects a different entry. A valid unchanged entry is verified and reused without compiling or signing again. A nonblocking cache lock rejects simultaneous builders. Invalid/tampered entries fail closed and remain for inspection; use a fresh owned cache directory after diagnosing them rather than deleting unrelated state. Failed builds retain their source-keyed staging directory and log.

To verify an entry against the **current checkout and actual selected guest toolchain**:

```sh
python3 test-environment/native/phone/audio_helper.py verify \
  --binary "$BUILT_BINARY" --manifest "$BUILT_MANIFEST"
```

Python integration, from the sibling validator:

```python
from audio_helper import validate_helper
provenance = validate_helper(binary_path, manifest_path)
```

`validate_helper(binary, manifest)` returns verified provenance or raises. It recomputes expected identities from the checked-in files and `xcrun`-selected toolchain, requires the manifest beside its matching content-keyed bundle, hashes the actual supplied binary and bundle plist, and runs strict code-signature verification. It never executes a command or chooses source/compiler/SDK inputs from manifest contents. Merely supplying an arbitrary manifest is insufficient. This is local build provenance and integrity checking, not a cryptographic supply-chain attestation against someone who maliciously rewrites both an ad-hoc-signed binary and all local evidence.

`manifest.json` records the expected identity, cache/toolchain digests, actual signed-binary and bundle-plist digests, and exact compile/sign commands. Command paths refer to the original atomic staging directory; the resulting entry retains that frozen source and the build log. No private fixture configuration, tokens, audio or Keychain contents are inputs to this utility.

The existing historical `5aba…` helper replay can remain an explicit fast path in the phone validator. Its optional manifest integration is owned separately by the active phone validation work; this utility does not modify the current validator or add a validator flag. Fresh guest users should build current source and pass its validated manifest once that integration is present. Retain the actual helper/driver/source manifests with canonical evidence. Actual capture must still use guest-only scoped permission, inspect observed prompts, verify `capture-format.json`, meaningful frames and the known tone/silence/tone profile. No capture or hardware verification is implied by a successful build.

Host-safe tests replace only the external toolchain/process boundary and use temporary files; they do not build or launch native code:

```sh
python3 -m unittest discover -s test-environment/native/phone -p 'test_audio_helper.py'
```
