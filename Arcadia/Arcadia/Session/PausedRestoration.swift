import AVFoundation

@MainActor
final class PausedRestoration {
  private(set) var position: Double?
  private var seekStarted = false
  private var durationResolved = false

  func install(position: Double) { self.position = position }
  func cancel() { position = nil }
  func markDurationResolved() { durationResolved = true }

  func prepareAgain() {
    seekStarted = false
    durationResolved = false
  }

  func seekIfReady(player: AVPlayer, duration: Double, onCompletion: @escaping @MainActor (Double) -> Void) {
    guard let position, !seekStarted, durationResolved, player.currentItem?.status == .readyToPlay else { return }
    seekStarted = true
    let target = min(max(position, 0), duration)
    let time = CMTime(seconds: target, preferredTimescale: 600)
    player.seek(to: time, toleranceBefore: .zero, toleranceAfter: .zero) { finished in
      Task { @MainActor in
        guard finished else { return }
        let actual = player.currentTime().seconds
        onCompletion(actual.isFinite ? actual : target)
      }
    }
  }
}
