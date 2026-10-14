#if os(iOS)
  import AVFoundation
  import UIKit

  @MainActor
  final class MobileAudioSession {
    private let session = AVAudioSession.sharedInstance()
    private weak var player: PlayerStore?
    private var observers: [NSObjectProtocol] = []
    private var interruption: UUID?
    private var configured = false
    private var active = false
    private var closed = false

    func activate() throws {
      guard !closed else { throw CancellationError() }
      if !configured {
        try session.setCategory(.playback, mode: .default)
        configured = true
      }
      if !active {
        try session.setActive(true)
        active = true
      }
    }

    func observe(player: PlayerStore, flush: @escaping @MainActor () -> Void) {
      self.player = player
      observe(UIApplication.didEnterBackgroundNotification) { _ in flush() }
      observe(AVAudioSession.routeChangeNotification) { [weak self] notification in
        guard let raw = notification.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt,
          AVAudioSession.RouteChangeReason(rawValue: raw) == .oldDeviceUnavailable
        else { return }
        self?.beginInterruption()
        self?.finishInterruption(shouldResume: false)
      }
      if #available(iOS 27.0, *) {
        observe(AVAudioSession.didBecomeInactiveNotification) { [weak self] _ in
          self?.active = false
          self?.beginInterruption()
        }
        observe(AVAudioSession.resumptionRecommendationNotification) { [weak self] notification in
          guard
            let context = notification.userInfo?[AVAudioSession.resumptionContextKey]
              as? AVAudioSession.ResumptionContext
          else { return }
          self?.finishInterruption(shouldResume: context.recommendation == .shouldResume)
        }
      } else {
        observe(AVAudioSession.interruptionNotification) { [weak self] notification in
          guard let raw = notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
            let type = AVAudioSession.InterruptionType(rawValue: raw)
          else { return }
          if type == .began {
            self?.active = false
            self?.beginInterruption()
          } else {
            let options = notification.userInfo?[AVAudioSessionInterruptionOptionKey] as? UInt ?? 0
            self?.finishInterruption(
              shouldResume: AVAudioSession.InterruptionOptions(rawValue: options).contains(.shouldResume))
          }
        }
      }
    }

    func close() {
      closed = true
      observers.forEach { NotificationCenter.default.removeObserver($0) }
      observers = []
      interruption = nil
      player = nil
      if active {
        do { try session.setActive(false, options: .notifyOthersOnDeactivation) } catch {
          AppDiagnostics.event("audio.session.deactivation.failed")
        }
      }
      active = false
    }

    private func beginInterruption() {
      guard !closed, let player else { return }
      interruption = player.beginAudioInterruption()
      AppDiagnostics.event("audio.session.interrupted")
    }

    private func finishInterruption(shouldResume: Bool) {
      guard !closed, let token = interruption else { return }
      interruption = nil
      player?.endAudioInterruption(token, shouldResume: shouldResume)
    }

    private func observe(_ name: Notification.Name, handler: @escaping @MainActor (Notification) -> Void) {
      let token = NotificationCenter.default.addObserver(forName: name, object: nil, queue: .main) { notification in
        MainActor.assumeIsolated { handler(notification) }
      }
      observers.append(token)
    }
  }
#endif
