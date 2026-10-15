import AVFoundation
import CoreAudio
import Foundation

func check(_ s: OSStatus, _ operation: String) {
  print("\(operation): \(s)")
  if s != noErr { exit(2) }
}
let out = CommandLine.arguments[1]
try Data().write(to: URL(fileURLWithPath: out + "/armed"))
let ready = URL(fileURLWithPath: out + "/target.json")
while !FileManager.default.fileExists(atPath: ready.path) {
  if FileManager.default.fileExists(atPath: out + "/done") { exit(0) }
  Thread.sleep(forTimeInterval: 0.2)
}
let target = try JSONSerialization.jsonObject(with: Data(contentsOf: ready)) as! [String: Int]
var process = AudioObjectID(0)
var pid = pid_t(target["pid"]!)
var address = AudioObjectPropertyAddress(
  mSelector: kAudioHardwarePropertyTranslatePIDToProcessObject, mScope: kAudioObjectPropertyScopeGlobal,
  mElement: kAudioObjectPropertyElementMain)
var size = UInt32(MemoryLayout<AudioObjectID>.size)
check(
  AudioObjectGetPropertyData(
    AudioObjectID(kAudioObjectSystemObject), &address, UInt32(MemoryLayout<pid_t>.size), &pid, &size, &process),
  "translate PID \(pid)")
print("processObject=\(process)")
let globalOutput = CommandLine.arguments.contains("--paused-output")
var outputClock: AVAudioEngine?
if globalOutput {
  // Keep the guest's real output graph rendering during the initial paused launch.
  // The global mix includes any unexpected Arcadia output; this clock produces only zero samples.
  let engine = AVAudioEngine()
  let clockFormat = AVAudioFormat(standardFormatWithSampleRate: 48_000, channels: 2)!
  let clockNode = AVAudioSourceNode(format: clockFormat) { _, _, _, bufferList in
    for buffer in UnsafeMutableAudioBufferListPointer(bufferList) {
      if let data = buffer.mData { memset(data, 0, Int(buffer.mDataByteSize)) }
    }
    return noErr
  }
  engine.attach(clockNode)
  engine.connect(clockNode, to: engine.mainMixerNode, format: clockFormat)
  try engine.start()
  outputClock = engine
}
let description =
  globalOutput
  ? CATapDescription(stereoGlobalTapButExcludeProcesses: [])
  : CATapDescription(stereoMixdownOfProcesses: [process])
print("capture_mode=\(globalOutput ? "global-output-with-zero-clock" : "app-process")")
description.name = "Arcadia isolated audio pilot"
description.isPrivate = true
description.muteBehavior = globalOutput || CommandLine.arguments.contains("--unmuted") ? .unmuted : .mutedWhenTapped
var tap = AudioObjectID(0)
check(AudioHardwareCreateProcessTap(description, &tap), "create tap")
var tapFormat = AudioStreamBasicDescription()
address.mSelector = kAudioTapPropertyFormat
size = UInt32(MemoryLayout<AudioStreamBasicDescription>.size)
check(AudioObjectGetPropertyData(tap, &address, 0, nil, &size, &tapFormat), "tap format")
guard tapFormat.mSampleRate == 48000, tapFormat.mChannelsPerFrame == 2, tapFormat.mBytesPerFrame == 8,
  tapFormat.mFormatFlags == 9
else {
  print("Unsupported PCM format")
  exit(2)
}
print(
  "format rate=\(tapFormat.mSampleRate) channels=\(tapFormat.mChannelsPerFrame) flags=\(tapFormat.mFormatFlags) bytes=\(tapFormat.mBytesPerFrame)"
)
let configuration: [String: Any] = [
  kAudioAggregateDeviceNameKey: "Arcadia pilot capture",
  kAudioAggregateDeviceUIDKey: UUID().uuidString,
  kAudioAggregateDeviceIsPrivateKey: true,
  kAudioAggregateDeviceTapAutoStartKey: true,
  kAudioAggregateDeviceTapListKey: [
    [kAudioSubTapUIDKey: description.uuid.uuidString, kAudioSubTapDriftCompensationKey: true]
  ],
]
var device = AudioObjectID(0)
check(AudioHardwareCreateAggregateDevice(configuration as CFDictionary, &device), "create aggregate")
var streamAddress = AudioObjectPropertyAddress(
  mSelector: kAudioDevicePropertyStreamConfiguration, mScope: kAudioObjectPropertyScopeInput,
  mElement: kAudioObjectPropertyElementMain)
var streamSize: UInt32 = 0
check(AudioObjectGetPropertyDataSize(device, &streamAddress, 0, nil, &streamSize), "aggregate input layout size")
let streamMemory = UnsafeMutableRawPointer.allocate(byteCount: Int(streamSize), alignment: MemoryLayout<AudioBufferList>.alignment)
defer { streamMemory.deallocate() }
check(AudioObjectGetPropertyData(device, &streamAddress, 0, nil, &streamSize, streamMemory), "aggregate input layout")
let inputLayout = UnsafeMutableAudioBufferListPointer(streamMemory.assumingMemoryBound(to: AudioBufferList.self)).map { $0.mNumberChannels }
print("aggregate input layout=\(inputLayout)")
try JSONSerialization.data(withJSONObject: ["inputBufferChannels": inputLayout, "tapChannels": tapFormat.mChannelsPerFrame]).write(to: URL(fileURLWithPath: out + "/capture-format.json"))
if CommandLine.arguments.contains("--layout-only") {
  check(AudioHardwareDestroyAggregateDevice(device), "destroy diagnostic aggregate")
  check(AudioHardwareDestroyProcessTap(tap), "destroy diagnostic tap")
  exit(0)
}
guard inputLayout == [tapFormat.mChannelsPerFrame] else {
  print("Capture requires exactly one stereo tap buffer; unrelated device input must be excluded")
  exit(2)
}
var io: AudioDeviceIOProcID?
let lock = NSLock()
var seconds: [Int: (Double, Int, Float)] = [:]
let start = Date()
print("capture start=\(start.timeIntervalSince1970)")
var raw = Data()
var chunks: [[String: Any]] = []
check(
  AudioDeviceCreateIOProcIDWithBlock(&io, device, nil) { _, input, _, _, _ in
    let buffers = UnsafeMutableAudioBufferListPointer(UnsafeMutablePointer(mutating: input))
    lock.lock()
    defer { lock.unlock() }
    let second = Int(Date().timeIntervalSince(start))
    var bin = seconds[second] ?? (0, 0, 0)
    for b in buffers {
      guard let data = b.mData else { continue }
      let count = Int(b.mDataByteSize) / MemoryLayout<Float>.size
      let floats = data.assumingMemoryBound(to: Float.self)
      chunks.append(["time": Date().timeIntervalSince1970, "offset": raw.count, "bytes": Int(b.mDataByteSize)])
      raw.append(data.assumingMemoryBound(to: UInt8.self), count: Int(b.mDataByteSize))
      for i in 0..<count {
        let value = floats[i]
        bin.0 += Double(value * value)
        bin.1 += 1
        bin.2 = max(bin.2, abs(value))
      }
    }
    seconds[second] = bin
  }, "create IO")
check(AudioDeviceStart(device, io), "start capture")
try Data("ready".utf8).write(to: URL(fileURLWithPath: out + "/capture-ready"))
while !FileManager.default.fileExists(atPath: out + "/done") {
  RunLoop.main.run(until: Date(timeIntervalSinceNow: 0.2))
}
check(AudioDeviceStop(device, io), "stop")
lock.lock()
let result = seconds.keys.sorted().map { key -> [String: Any] in
  let bin = seconds[key]!
  return ["second": key, "samples": bin.1, "rms": sqrt(bin.0 / Double(max(1, bin.1))), "peak": bin.2]
}
try raw.write(to: URL(fileURLWithPath: out + "/captured-float32.raw"))
try JSONSerialization.data(withJSONObject: chunks, options: [.sortedKeys]).write(
  to: URL(fileURLWithPath: out + "/chunks.json"))
try JSONSerialization.data(withJSONObject: result, options: [.prettyPrinted, .sortedKeys]).write(
  to: URL(fileURLWithPath: out + "/results.json"))
lock.unlock()
AudioDeviceDestroyIOProcID(device, io!)
AudioHardwareDestroyAggregateDevice(device)
AudioHardwareDestroyProcessTap(tap)
print("complete")

outputClock?.stop()
