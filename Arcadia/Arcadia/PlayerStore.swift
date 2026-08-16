//
//  PlayerStore.swift
//  Arcadia
//
//  Created by Joshua O'Brien on 16/8/2026.
//

import AVFoundation
import Observation

@MainActor
@Observable
final class PlayerStore {
    private(set) var currentTime: Double = 0
    private(set) var duration: Double = 0
    private(set) var currentTrack: Track?
    private(set) var player: AVPlayer?
    
    private var timeObserver: Any?
    private var endObserver: NSObjectProtocol?
    private var queue: [PlaybackItem] = []
    
    var isPlaying: Bool {
        player?.timeControlStatus == .playing
    }
    
    func pause() {
        player?.pause()
    }
    
    func resume() {
        player?.play()
    }
    
    func play(_ track: Track, from url: URL, in queue: [PlaybackItem]) {
        self.queue = queue
        start(track, from: url)
    }
    
    func playNext() {
        guard let currentTrack,
              let currentIndex = queue.firstIndex(
                where: { $0.track.id == currentTrack.id }
              )
        else {
            return
        }
        
        let nextIndex = currentIndex + 1
        
        guard queue.indices.contains(nextIndex) else {
            return
        }
        
        let nextItem = queue[nextIndex]
        
        start(nextItem.track, from: nextItem.streamURL)
    }
    
    private func start(
        _ track: Track,
        from url: URL
    ) {
        removeTimeObserver()
        removeEndObserver()
        
        currentTrack = track
        currentTime = 0
        duration = track.durationSeconds ?? 0
        
        let newPlayer = AVPlayer(url: url)
        player = newPlayer
        
        if let currentItem = newPlayer.currentItem {
            endObserver = NotificationCenter.default.addObserver(
                forName: .AVPlayerItemDidPlayToEndTime,
                object: currentItem,
                queue: .main
            ) { [weak self] _ in
                Task { @MainActor [weak self] in
                    self?.playNext()
                }
            }
        }
        
        
        let interval = CMTime(
            seconds: 0.5,
            preferredTimescale: 600
        )
        
        timeObserver = newPlayer.addPeriodicTimeObserver(
            forInterval: interval,
            queue: .main
        ) { [weak self] time in
            guard time.seconds.isFinite else {
                return
            }
            
            Task { @MainActor [weak self] in
                self?.currentTime = time.seconds
            }
        }
        
        newPlayer.play()

    }
    
    func seek(to seconds: Double, resumeAfterSeeking: Bool) {
        currentTime = seconds
        
        let time = CMTime(
            seconds: seconds,
            preferredTimescale: 600
        )
        
        player?.seek(to: time) { [weak self] finished in
            guard finished, resumeAfterSeeking else {
                return
            }
            
            Task { @MainActor [weak self] in
                self?.resume()
            }
        }
    }
    
    private func removeTimeObserver() {
        guard let timeObserver, let
                player else {
            return
        }
        
        player.removeTimeObserver(timeObserver)
        self.timeObserver = nil
    }
    
    private func removeEndObserver() {
        guard let endObserver else {
            return
        }
        
        NotificationCenter.default.removeObserver(endObserver)
        self.endObserver = nil
    }
    
    
    func togglePlayback() {
        guard let player else {
            return
        }
        
        if isPlaying {
            player.pause()
        } else {
            player.play()
        }
    }
}
