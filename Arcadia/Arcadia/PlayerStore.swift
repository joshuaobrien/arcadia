import AVFoundation
import Observation

@MainActor
@Observable
final class PlayerStore {
  private(set) var currentTime: Double = 0
  private(set) var duration: Double = 0
  private(set) var currentEntryID: UUID?
  // An explicit selection or Pause supersedes pending collection loads. A new
  // selection counts even if its replacement confirmation is cancelled. Queue
  // edits and natural advancement do not change this intent revision.
  private(set) var playbackChoiceRevision = UUID()
  // System lifecycle pauses invalidate older collection preparation without
  // pretending the listener made a new explicit playback choice.
  private(set) var audioLifecycleRevision = UUID()
  private(set) var queue: [QueueEntry] = []
  private(set) var state: State = .idle
  private(set) var errorText: String?
  private(set) var pendingReplacement: [Track]?
  var queueFeedback: QueueFeedbackState.Feedback? { feedback.current }

  private(set) var volume: Double = 1
  func setVolume(_ value: Double) {
    guard value.isFinite else { return }
    volume = min(1, max(0, value))
    player.volume = Float(volume)
  }
  var isPlaybackRequested: Bool { wantsPlayback }

  @ObservationIgnored private let source: any MusicSource
  @ObservationIgnored private let activateAudio: @MainActor () throws -> Void
  @ObservationIgnored private var player = AVPlayer()
  @ObservationIgnored private var generation = UUID()
  @ObservationIgnored private var pendingSeek: UUID?
  @ObservationIgnored private var wantsPlayback = false
  @ObservationIgnored private var resolveTask: Task<Void, Never>?
  @ObservationIgnored private var durationTask: Task<Void, Never>?
  @ObservationIgnored private var transportObservation: PlaybackObservation?
  @ObservationIgnored private let restoration = PausedRestoration()
  @ObservationIgnored private let interruption = PlaybackInterruption()
  @ObservationIgnored private let feedback = QueueFeedbackState()

  init(source: any MusicSource, activateAudio: @escaping @MainActor () throws -> Void = {}) {
    self.source = source
    self.activateAudio = activateAudio
  }
  func pause() {
    playbackChoiceRevision = UUID()
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
    if restoration.position != nil, state == .failed || player.currentItem == nil {
      resolveRestoredEntry(entry)
      return
    }
    if state == .ended || state == .failed {
      start(entry)
      return
    }
    if player.currentItem == nil {
      state = .loading
      return
    }
    startTransport()
    updateTransport(generation)
  }
  func playQueuedEntry(_ id: UUID) {
    guard let entry = queue.first(where: { $0.id == id }) else { return }
    playbackChoiceRevision = UUID()
    pendingReplacement = nil
    if currentEntryID == id { resume() } else { start(entry) }
  }
  func playNext() {
    guard canAdvance else { return }
    playbackChoiceRevision = UUID()
    advanceToNext()
  }
  func playPrevious() {
    guard let index = currentIndex else { return }
    playbackChoiceRevision = UUID()
    let destination = currentTime >= 3 ? index : max(0, index - 1)
    let ready = player.currentItem?.status == .readyToPlay && duration > 0 && state != .failed
    if destination == index, restoration.position == nil, ready {
      seek(to: 0, resumeAfterSeeking: wantsPlayback)
    } else {
      start(queue[destination], requestingPlayback: wantsPlayback)
    }
  }
  private func advanceToNext() {
    guard let index = currentIndex, queue.indices.contains(index + 1) else { return }
    start(queue[index + 1])
  }
  func retry() {
    if let entry = currentEntry {
      if restoration.position != nil { resolveRestoredEntry(entry) } else { start(entry) }
    }
  }
  func stop() {
    audioLifecycleRevision = UUID()
    clearTransport()
    restoration.cancel()
    queue = []
    pendingReplacement = nil
    feedback.clear()
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
    let seekID = UUID()
    pendingSeek = seekID
    // Keep the released thumb at its destination while AVPlayer seeks. Its
    // periodic observer can still report the previous position in the meantime.
    currentTime = target
    wantsPlayback = resumeAfterSeeking
    state = resumeAfterSeeking ? .loading : .paused
    player.pause()
    player.seek(
      to: CMTime(seconds: target, preferredTimescale: 600), toleranceBefore: .zero, toleranceAfter: .zero
    ) { [weak self] finished in
      Task { @MainActor [weak self] in
        guard let self, self.generation == expected, self.pendingSeek == seekID else { return }
        self.pendingSeek = nil
        let actual = self.player.currentTime().seconds
        if actual.isFinite { self.currentTime = actual }
        if finished && self.wantsPlayback { self.startTransport() }
        self.updateTransport(expected)
      }
    }
  }
  private func start(_ entry: QueueEntry, requestingPlayback: Bool = true) {
    restoration.cancel()
    clearTransport()
    currentEntryID = entry.id
    currentTime = 0
    let metadataDuration = entry.track.durationSeconds ?? 0
    duration = metadataDuration.isFinite && metadataDuration > 0 ? metadataDuration : 0
    wantsPlayback = requestingPlayback
    state = requestingPlayback ? .loading : .paused
    errorText = nil
    resolve(entry)
  }
  private func startTransport() {
    if !PlaybackPreparation.play(player, activateAudio: activateAudio) { fail(generation) }
  }
  private func resolve(_ entry: QueueEntry) {
    let expected = generation
    resolveTask = PlaybackPreparation.resource(for: entry.track, source: source) { [weak self] resource in
      guard let self, self.generation == expected else { return }
      if let resource { self.load(resource, generation: expected) } else { self.fail(expected) }
    }
  }
  private func load(_ resource: PlayableResource, generation expected: UUID) {
    if let index = currentIndex { queue[index] = queue[index].withResolvedMetadata(resource.resolvedTrack) }
    let asset = AVURLAsset(url: resource.url, options: [AVURLAssetPreferPreciseDurationAndTimingKey: true])
    let item = AVPlayerItem(asset: asset)
    player.replaceCurrentItem(with: item)
    observe(item, generation: expected)
    durationTask = PlaybackPreparation.duration(asset) { [weak self] seconds in
      guard let self, self.generation == expected else { return }
      if let seconds {
        self.duration = seconds
        self.restoration.markDurationResolved()
        self.updateTransport(expected)
      } else if self.restoration.position != nil {
        self.fail(expected)
      }
    }
    if wantsPlayback && restoration.position == nil { startTransport() }
  }
  private func observe(_ item: AVPlayerItem, generation expected: UUID) {
    transportObservation = PlaybackObservation(player: player, item: item) { [weak self] event in
      guard let self, self.generation == expected else { return }
      switch event {
      case .transport: self.updateTransport(expected)
      case .position(let position):
        if self.restoration.position == nil && self.pendingSeek == nil { self.currentTime = max(0, position) }
      case .finished: self.finished(expected)
      case .failed: self.fail(expected)
      }
    }
  }
  private func updateTransport(_ expected: UUID) {
    guard generation == expected, state != .failed, state != .ended else { return }
    if player.currentItem?.status == .failed {
      fail(expected)
      return
    }
    if restoration.position != nil {
      completeRestorationIfReady(expected)
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
      advanceToNext()
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
  private func clearTransport() {
    generation = UUID()
    pendingSeek = nil
    resolveTask?.cancel()
    durationTask?.cancel()
    resolveTask = nil
    durationTask = nil
    transportObservation?.cancel()
    transportObservation = nil
    player.pause()
    player.replaceCurrentItem(with: nil)
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
    feedback.clear()
    queue = tracks.map { QueueEntry(track: $0) }
    if let first = queue.first { start(first) }
  }

  func insertNext(_ tracks: [Track]) {
    guard !tracks.isEmpty else { return }
    let entries = tracks.map { QueueEntry(track: $0, origin: .manual) }
    queue.insert(contentsOf: entries, at: currentIndex.map { $0 + 1 } ?? 0)
    feedback.show(
      entries,
      message: tracks.count == 1 ? "Playing next: \(tracks[0].title ?? "Song")" : "\(tracks.count) songs will play next"
    )
  }

  func append(_ tracks: [Track]) {
    guard !tracks.isEmpty else { return }
    let entries = tracks.map { QueueEntry(track: $0, origin: .manual) }
    queue.append(contentsOf: entries)
    feedback.show(
      entries,
      message: tracks.count == 1
        ? "Added to queue: \(tracks[0].title ?? "Song")" : "Added \(tracks.count) songs to queue")
  }
  func undoAddition(_ feedbackID: UUID) {
    guard let feedback = queueFeedback, feedback.id == feedbackID else { return }
    let removable = Set(upcoming.map(\.id)).intersection(feedback.entryIDs)
    queue.removeAll { removable.contains($0.id) }
    self.feedback.clear()
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

extension PlayerStore {
  func exportSession(sourceBinding: UUID) throws -> Data? {
    try PlaybackSnapshot.encode(
      sourceBinding: sourceBinding, entries: queue,
      currentEntryID: currentEntryID, position: restoration.position ?? currentTime)
  }

  func restoreSession(_ data: Data, sourceBinding: UUID) throws {
    let snapshot = try JSONDecoder().decode(PlaybackSnapshot.self, from: data)
    try snapshot.validate(binding: sourceBinding)
    clearTransport()
    pendingReplacement = nil
    feedback.clear()
    queue = snapshot.entries.map(\.queueEntry)
    currentEntryID = snapshot.currentEntryID
    currentTime = snapshot.position
    wantsPlayback = false
    errorText = nil
    if let entry = currentEntry {
      restoration.install(position: snapshot.position)
      resolveRestoredEntry(entry)
    } else {
      restoration.cancel()
      state = .idle
    }
  }

  private func resolveRestoredEntry(_ entry: QueueEntry) {
    clearTransport()
    restoration.prepareAgain()
    state = .loading
    errorText = nil
    resolve(entry)
  }

  private func completeRestorationIfReady(_ expected: UUID) {
    restoration.seekIfReady(player: player, duration: duration) { [weak self] position in
      guard let self, self.generation == expected else { return }
      self.restoration.cancel()
      self.currentTime = position
      if self.wantsPlayback { self.startTransport() }
      self.updateTransport(expected)
    }
  }
}

extension PlayerStore {
  // Teardown releases AVFoundation resources without replacing the durable listening state with an empty queue.
  func releaseTransport() {
    audioLifecycleRevision = UUID()
    clearTransport()
    wantsPlayback = false
    if currentEntryID != nil { state = .paused }
  }

  // Media-service resets orphan AVFoundation objects. Rebuild transport paused;
  // source access, seeking and audio activation wait for deliberate Resume.
  func resetAudioServices() {
    audioLifecycleRevision = UUID()
    let position = restoration.position ?? currentTime
    clearTransport()
    player = AVPlayer()
    player.volume = Float(volume)
    wantsPlayback = false
    errorText = nil
    restoration.cancel()
    if currentEntry != nil { restoration.install(position: position) }
    currentTime = position
    state = currentEntry == nil ? .idle : .paused
  }

  func beginAudioInterruption() -> UUID {
    audioLifecycleRevision = UUID()
    let token = interruption.begin(
      entry: currentEntryID, generation: generation, choice: playbackChoiceRevision, requested: wantsPlayback)
    wantsPlayback = false
    player.pause()
    if currentTrack != nil && state != .failed && state != .ended { state = .paused }
    return token
  }

  func endAudioInterruption(_ token: UUID, shouldResume: Bool) {
    let mayResume = interruption.finish(
      token, entry: currentEntryID, generation: generation, choice: playbackChoiceRevision)
    if shouldResume && mayResume { resume() }
  }
}
