import AVFoundation

@MainActor
final class PlaybackObservation {
  enum Event {
    case transport
    case position(Double)
    case finished, failed
  }
  private let player: AVPlayer
  private var status: NSKeyValueObservation?
  private var transport: NSKeyValueObservation?
  private var time: Any?
  private var end: NSObjectProtocol?
  private var failure: NSObjectProtocol?

  init(player: AVPlayer, item: AVPlayerItem, onEvent: @escaping @MainActor (Event) -> Void) {
    self.player = player
    status = item.observe(\.status, options: [.initial, .new]) { _, _ in
      Task { @MainActor in onEvent(.transport) }
    }
    transport = player.observe(\.timeControlStatus, options: [.initial, .new]) { _, _ in
      Task { @MainActor in onEvent(.transport) }
    }
    let interval = CMTime(seconds: 0.25, preferredTimescale: 600)
    time = player.addPeriodicTimeObserver(forInterval: interval, queue: .main) { value in
      MainActor.assumeIsolated {
        if value.seconds.isFinite { onEvent(.position(value.seconds)) }
      }
    }
    let didFinish = Notification.Name.AVPlayerItemDidPlayToEndTime
    end = NotificationCenter.default.addObserver(forName: didFinish, object: item, queue: .main) { _ in
      MainActor.assumeIsolated { onEvent(.finished) }
    }
    failure = NotificationCenter.default.addObserver(
      forName: .AVPlayerItemFailedToPlayToEndTime, object: item, queue: .main
    ) { _ in
      MainActor.assumeIsolated { onEvent(.failed) }
    }
  }

  func cancel() {
    if let time { player.removeTimeObserver(time) }
    time = nil
    status = nil
    transport = nil
    if let end { NotificationCenter.default.removeObserver(end) }
    if let failure { NotificationCenter.default.removeObserver(failure) }
    end = nil
    failure = nil
  }
}
