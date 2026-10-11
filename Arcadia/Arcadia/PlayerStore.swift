import AVFoundation
import Observation

@MainActor
@Observable
final class PlayerStore {
  enum State: String { case idle, loading, playing, paused, failed, ended }
  struct QueueFeedback: Identifiable {
    let id = UUID()
    let message: String
    fileprivate let entryIDs: Set<UUID>
  }

  private(set) var currentTime: Double = 0
  private(set) var duration: Double = 0
  private(set) var currentEntryID: UUID?
  // An explicit selection supersedes pending collection loads even when its
  // replacement confirmation is cancelled. Queue edits and natural advancement
  // do not change this intent revision.
  private(set) var playbackChoiceRevision = UUID()
  private(set) var queue: [QueueEntry] = []
  private(set) var state: State = .idle
  private(set) var errorText: String?
  private(set) var pendingReplacement: [Track]?
  private(set) var queueFeedback: QueueFeedback?
  var needsReplacementConfirmation: Bool { pendingReplacement != nil }

  var currentTrack: Track? { currentEntry?.track }
  var isPlaying: Bool { state == .playing }
  var isPlaybackRequested: Bool { wantsPlayback }
  var canAdvance: Bool { currentIndex.map { queue.indices.contains($0 + 1) } ?? false }
  var currentEntry: QueueEntry? { queue.first { $0.id == currentEntryID } }
  var upcoming: [QueueEntry] {
    guard let currentIndex else { return queue }
    return Array(queue.dropFirst(currentIndex + 1))
  }
  private var currentIndex: Int? { queue.firstIndex { $0.id == currentEntryID } }

  @ObservationIgnored private let source: any MusicSource
  @ObservationIgnored private let player = AVPlayer()
  @ObservationIgnored private var generation = UUID()
  @ObservationIgnored private var wantsPlayback = false
  @ObservationIgnored private var resolveTask: Task<Void, Never>?
  @ObservationIgnored private var durationTask: Task<Void, Never>?
  @ObservationIgnored private var timeObserver: Any?
  @ObservationIgnored private var statusObserver: NSKeyValueObservation?
  @ObservationIgnored private var transportObserver: NSKeyValueObservation?
  @ObservationIgnored private var endObserver: NSObjectProtocol?
  @ObservationIgnored private var failureObserver: NSObjectProtocol?
  @ObservationIgnored private var feedbackTask: Task<Void, Never>?

  init(source: any MusicSource) { self.source = source }

  func pause() {
    wantsPlayback = false
    player.pause()
    if currentTrack != nil && state != .failed && state != .ended { state = .paused }
  }

  func resume() {
    guard let entry = currentEntry else {
      if let first = queue.first { playQueuedEntry(first.id) }
      return
    }
    wantsPlayback = true
    if state == .ended || state == .failed {
      start(entry)
      return
    }
    if player.currentItem == nil {
      state = .loading
      return
    }
    player.play()
    updateTransport(generation)
  }

  func playQueuedEntry(_ id: UUID) {
    guard let entry = queue.first(where: { $0.id == id }) else { return }
    playbackChoiceRevision = UUID()
    pendingReplacement = nil
    if currentEntryID == id { resume() } else { start(entry) }
  }

  func togglePlayback() {
    if isPlaying || wantsPlayback { pause() } else { resume() }
  }

  func playNext() {
    guard let index = currentIndex, queue.indices.contains(index + 1) else { return }
    start(queue[index + 1])
  }

  func retry() {
    if let entry = currentEntry { start(entry) }
  }

  func stop() {
    invalidate()
    player.pause()
    player.replaceCurrentItem(with: nil)
    queue = []
    pendingReplacement = nil
    clearQueueFeedback()
    currentEntryID = nil
    currentTime = 0
    duration = 0
    errorText = nil
    wantsPlayback = false
    state = .idle
  }

  func seek(to seconds: Double, resumeAfterSeeking: Bool) {
    guard seconds.isFinite, duration > 0, player.currentItem?.status == .readyToPlay else { return }
    let target = min(max(seconds, 0), duration)
    let expected = generation
    wantsPlayback = resumeAfterSeeking
    state = resumeAfterSeeking ? .loading : .paused
    player.pause()
    player.seek(
      to: CMTime(seconds: target, preferredTimescale: 600), toleranceBefore: .zero, toleranceAfter: .zero
    ) { [weak self] finished in
      Task { @MainActor [weak self] in
        guard let self, finished, self.generation == expected else { return }
        let actual = self.player.currentTime().seconds
        if actual.isFinite { self.currentTime = actual }
        if self.wantsPlayback { self.player.play() }
        self.updateTransport(expected)
      }
    }
  }

  private func start(_ entry: QueueEntry) {
    invalidate()
    player.pause()
    player.replaceCurrentItem(with: nil)
    currentEntryID = entry.id
    currentTime = 0
    let metadataDuration = entry.track.durationSeconds ?? 0
    duration = metadataDuration.isFinite && metadataDuration > 0 ? metadataDuration : 0
    wantsPlayback = true
    state = .loading
    errorText = nil
    let expected = generation
    resolveTask = Task { [weak self] in
      guard let self else { return }
      do {
        let resource = try await self.source.playableResource(for: entry.track)
        guard !Task.isCancelled, self.generation == expected else { return }
        self.load(resource, generation: expected)
      } catch {
        guard !Task.isCancelled, self.generation == expected else { return }
        self.fail(expected)
      }
    }
  }

  private func load(_ resource: PlayableResource, generation expected: UUID) {
    let asset = AVURLAsset(url: resource.url, options: [AVURLAssetPreferPreciseDurationAndTimingKey: true])
    let item = AVPlayerItem(asset: asset)
    player.replaceCurrentItem(with: item)
    observe(item, generation: expected)
    durationTask = Task { [weak self] in
      guard let value = try? await asset.load(.duration), !Task.isCancelled,
        let self, self.generation == expected, value.seconds.isFinite, value.seconds > 0
      else { return }
      self.duration = value.seconds
    }
    if wantsPlayback { player.play() }
  }

  private func observe(_ item: AVPlayerItem, generation expected: UUID) {
    statusObserver = item.observe(\.status, options: [.initial, .new]) { [weak self] _, _ in
      Task { @MainActor [weak self] in self?.updateTransport(expected) }
    }
    transportObserver = player.observe(\.timeControlStatus, options: [.initial, .new]) { [weak self] _, _ in
      Task { @MainActor [weak self] in self?.updateTransport(expected) }
    }
    timeObserver = player.addPeriodicTimeObserver(
      forInterval: CMTime(seconds: 0.25, preferredTimescale: 600), queue: .main
    ) { [weak self] time in
      MainActor.assumeIsolated {
        guard let self, self.generation == expected, time.seconds.isFinite else { return }
        self.currentTime = max(0, time.seconds)
      }
    }
    endObserver = NotificationCenter.default.addObserver(
      forName: .AVPlayerItemDidPlayToEndTime, object: item, queue: .main
    ) { [weak self] _ in
      MainActor.assumeIsolated { self?.finished(expected) }
    }
    failureObserver = NotificationCenter.default.addObserver(
      forName: .AVPlayerItemFailedToPlayToEndTime, object: item, queue: .main
    ) { [weak self] _ in
      MainActor.assumeIsolated { self?.fail(expected) }
    }
  }

  private func updateTransport(_ expected: UUID) {
    guard generation == expected, state != .failed, state != .ended else { return }
    if player.currentItem?.status == .failed {
      fail(expected)
      return
    }
    switch player.timeControlStatus {
    case .playing: state = .playing
    case .waitingToPlayAtSpecifiedRate: state = wantsPlayback ? .loading : .paused
    case .paused: state = wantsPlayback ? .loading : .paused
    @unknown default: state = .loading
    }
  }

  private func finished(_ expected: UUID) {
    guard generation == expected, state != .ended else { return }
    if canAdvance {
      playNext()
    } else {
      wantsPlayback = false
      state = .ended
      currentTime = duration
    }
  }

  private func fail(_ expected: UUID) {
    guard generation == expected else { return }
    player.pause()
    wantsPlayback = false
    state = .failed
    // Never surface AVFoundation errors: they can contain authenticated media URLs.
    errorText = "Couldn't play this song. Check your connection and try again."
    AppDiagnostics.event("player.failed")
  }

  private func invalidate() {
    generation = UUID()
    resolveTask?.cancel()
    durationTask?.cancel()
    resolveTask = nil
    durationTask = nil
    if let timeObserver { player.removeTimeObserver(timeObserver) }
    timeObserver = nil
    statusObserver = nil
    transportObserver = nil
    if let endObserver { NotificationCenter.default.removeObserver(endObserver) }
    if let failureObserver { NotificationCenter.default.removeObserver(failureObserver) }
    endObserver = nil
    failureObserver = nil
  }
}

// Queue commands preserve the active occurrence and its transport state.
extension PlayerStore {
  func play(_ tracks: [Track]) {
    guard !tracks.isEmpty else { return }
    playbackChoiceRevision = UUID()
    if upcoming.contains(where: { $0.origin == .manual }) {
      pendingReplacement = tracks
      return
    }
    replaceAndPlay(tracks)
  }

  func cancelReplacement() { pendingReplacement = nil }

  func confirmReplacement() {
    guard let tracks = pendingReplacement else { return }
    pendingReplacement = nil
    replaceAndPlay(tracks)
  }

  private func replaceAndPlay(_ tracks: [Track]) {
    pendingReplacement = nil
    clearQueueFeedback()
    queue = tracks.map { QueueEntry(track: $0) }
    if let first = queue.first { start(first) }
  }

  func insertNext(_ tracks: [Track]) {
    guard !tracks.isEmpty else { return }
    let entries = tracks.map { QueueEntry(track: $0, origin: .manual) }
    queue.insert(contentsOf: entries, at: currentIndex.map { $0 + 1 } ?? 0)
    showQueueFeedback(
      entries,
      message: tracks.count == 1 ? "Playing next: \(tracks[0].title ?? "Song")" : "\(tracks.count) songs will play next"
    )
  }

  func append(_ tracks: [Track]) {
    guard !tracks.isEmpty else { return }
    let entries = tracks.map { QueueEntry(track: $0, origin: .manual) }
    queue.append(contentsOf: entries)
    showQueueFeedback(
      entries,
      message: tracks.count == 1
        ? "Added to queue: \(tracks[0].title ?? "Song")" : "Added \(tracks.count) songs to queue")
  }

  func undoAddition(_ feedbackID: UUID) {
    guard let feedback = queueFeedback, feedback.id == feedbackID else { return }
    let removable = Set(upcoming.map(\.id)).intersection(feedback.entryIDs)
    queue.removeAll { removable.contains($0.id) }
    clearQueueFeedback()
  }

  private func showQueueFeedback(_ entries: [QueueEntry], message: String) {
    feedbackTask?.cancel()
    let feedback = QueueFeedback(message: message, entryIDs: Set(entries.map(\.id)))
    queueFeedback = feedback
    feedbackTask = Task { [weak self] in
      try? await Task.sleep(for: .seconds(8))
      guard !Task.isCancelled, let self, self.queueFeedback?.id == feedback.id else { return }
      self.queueFeedback = nil
    }
  }

  private func clearQueueFeedback() {
    feedbackTask?.cancel()
    feedbackTask = nil
    queueFeedback = nil
  }

  func removeUpcoming(_ id: UUID) {
    guard upcoming.contains(where: { $0.id == id }) else { return }
    queue.removeAll { $0.id == id }
  }

  func moveUpcoming(_ id: UUID, by distance: Int) {
    guard let index = queue.firstIndex(where: { $0.id == id }),
      upcoming.contains(where: { $0.id == id })
    else { return }
    let destination = index + distance
    let firstUpcoming = currentIndex.map { $0 + 1 } ?? 0
    guard destination >= firstUpcoming, queue.indices.contains(destination) else { return }
    let entry = queue.remove(at: index)
    queue.insert(entry, at: destination)
  }

}
