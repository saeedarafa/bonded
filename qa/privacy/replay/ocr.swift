// QA-54: recognise text in the replay frames extracted by scan.mjs (macOS Vision, on-device; no
// network). Prints { "<file>": ["line", ...] } as JSON.
// Usage: swift qa/privacy/replay/ocr.swift <frames-dir>
import Foundation
import Vision

let dir = URL(fileURLWithPath: CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : ".")
let files = (try? FileManager.default.contentsOfDirectory(atPath: dir.path)) ?? []
var out: [String: [String]] = [:]
for name in files.sorted() where name.range(of: #"\.(jpg|png|webp)$"#, options: .regularExpression) != nil {
  let req = VNRecognizeTextRequest()
  req.recognitionLevel = .accurate
  req.usesLanguageCorrection = false
  let handler = VNImageRequestHandler(url: dir.appendingPathComponent(name), options: [:])
  do { try handler.perform([req]) } catch { out[name] = ["<ocr error: \(error.localizedDescription)>"]; continue }
  out[name] = (req.results ?? []).compactMap { $0.topCandidates(1).first?.string }
}
let data = try JSONSerialization.data(withJSONObject: out, options: [.sortedKeys])
FileHandle.standardOutput.write(data)
