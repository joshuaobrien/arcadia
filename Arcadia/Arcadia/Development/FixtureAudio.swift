#if DEBUG
  import AVFoundation
  import Foundation

  // A real decoded local fixture, not simulated playback or a UI timer.
  enum FixtureAudio {
    static func url(for track: Track) throws -> URL {
      let directory = FileManager.default.temporaryDirectory.appendingPathComponent("arcadia-fixture-audio")
      try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
      let url = directory.appendingPathComponent(track.id).appendingPathExtension("wav")
      if FileManager.default.fileExists(atPath: url.path) { return url }
      guard let format = AVAudioFormat(standardFormatWithSampleRate: 48_000, channels: 2),
        let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 48_000 * 12),
        let channels = buffer.floatChannelData
      else { throw MusicSourceError.invalidResponse }
      buffer.frameLength = buffer.frameCapacity
      for sample in 0..<Int(buffer.frameLength) {
        let frequency = sample < 48_000 * 6 ? 520.0 : 680.0
        let value = Float(sin(Double(sample) * frequency * 2 * .pi / 48_000) * 0.3)
        channels[0][sample] = value
        channels[1][sample] = value
      }
      let file = try AVAudioFile(forWriting: url, settings: format.settings)
      try file.write(from: buffer)
      return url
    }
  }
#endif
