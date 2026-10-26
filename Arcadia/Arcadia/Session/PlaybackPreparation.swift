import AVFoundation

@MainActor
final class PlaybackPreparation {
  static func play(_ player: AVPlayer, activateAudio: @MainActor () throws -> Void) -> Bool {
    do {
      try activateAudio()
      player.play()
      return true
    } catch {
      return false
    }
  }

  static func resource(
    for track: Track, source: any MusicSource, onResult: @escaping @MainActor (PlayableResource?) -> Void
  ) -> Task<Void, Never> {
    Task {
      do {
        try Task.checkCancellation()
        let resource = try await source.playableResource(for: track)
        guard !Task.isCancelled else { return }
        onResult(resource)
      } catch {
        guard !Task.isCancelled else { return }
        onResult(nil)
      }
    }
  }

  static func duration(_ asset: AVURLAsset, onResult: @escaping @MainActor (Double?) -> Void) -> Task<Void, Never> {
    Task {
      do {
        let value = try await asset.load(.duration)
        guard !Task.isCancelled else { return }
        guard value.seconds.isFinite, value.seconds > 0 else { return }
        onResult(value.seconds)
      } catch {
        guard !Task.isCancelled else { return }
        onResult(nil)
      }
    }
  }

}
