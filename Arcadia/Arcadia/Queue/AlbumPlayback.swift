import Foundation

extension PlayerStore {
  // Album rows play the selected song and the remaining displayed album order.
  // Rows outside an album retain single-song playback.
  func play(_ track: Track, in albumTracks: [Track]) {
    guard let index = albumTracks.firstIndex(where: { $0.stableID == track.stableID }) else {
      play([track])
      return
    }
    play(Array(albumTracks[index...]))
  }
}
