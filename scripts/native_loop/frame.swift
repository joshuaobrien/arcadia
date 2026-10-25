// Guest-only capture validation. Never captures the desktop or exports OCR text.
import AppKit
import CoreGraphics
import ImageIO
import Vision

if CommandLine.arguments[1] == "windows" {
  let pid = Int(CommandLine.arguments[2])!
  let windows = CGWindowListCopyWindowInfo(.optionOnScreenOnly, kCGNullWindowID) as? [[String: Any]] ?? []
  let ids = windows.filter {
    ($0[kCGWindowOwnerPID as String] as? Int) == pid && ($0[kCGWindowLayer as String] as? Int) == 0
  }.compactMap { $0[kCGWindowNumber as String] as? Int }
  print(String(data: try JSONSerialization.data(withJSONObject: ids), encoding: .utf8)!)
} else {
  let url = URL(fileURLWithPath: CommandLine.arguments[2])
  let expected = CommandLine.arguments[3]
  guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
    let image = CGImageSourceCreateImageAtIndex(source, 0, nil)
  else { exit(2) }
  let request = VNRecognizeTextRequest()
  request.recognitionLevel = .accurate
  request.usesLanguageCorrection = false
  try VNImageRequestHandler(cgImage: image).perform([request])
  let text = (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }.joined()
    .uppercased().filter { $0.isLetter || $0.isNumber }
  let matched = text.contains(expected)
  print(
    String(
      data: try JSONSerialization.data(withJSONObject: [
        "matched": matched, "width": image.width, "height": image.height,
      ]), encoding: .utf8)!)
  exit(matched ? 0 : 3)
}
