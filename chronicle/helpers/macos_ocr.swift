// Input: path to a PNG screenshot
// Output: recognized text printed to stdout
// Position: macOS Vision OCR helper for Cradle Chronicle

import Foundation
import ImageIO
import Vision

enum ChronicleOcrError: Error, CustomStringConvertible {
  case missingImagePath
  case imageLoadFailed(String)

  var description: String {
    switch self {
    case .missingImagePath:
      return "missing image path argument"
    case let .imageLoadFailed(path):
      return "failed to load image at \(path)"
    }
  }
}

func loadImage(path: String) throws -> CGImage {
  let url = URL(fileURLWithPath: path)
  guard
    let source = CGImageSourceCreateWithURL(url as CFURL, nil),
    let image = CGImageSourceCreateImageAtIndex(source, 0, nil)
  else {
    throw ChronicleOcrError.imageLoadFailed(path)
  }
  return image
}

func recognizeText(image: CGImage) throws -> String {
  let request = VNRecognizeTextRequest()
  request.recognitionLevel = .accurate
  request.usesLanguageCorrection = true

  let handler = VNImageRequestHandler(cgImage: image, options: [:])
  try handler.perform([request])

  return (request.results ?? [])
    .compactMap { observation in observation.topCandidates(1).first?.string }
    .joined(separator: "\n")
}

do {
  guard CommandLine.arguments.count >= 2 else {
    throw ChronicleOcrError.missingImagePath
  }
  let image = try loadImage(path: CommandLine.arguments[1])
  print(try recognizeText(image: image))
}
catch {
  FileHandle.standardError.write(Data("\(error)\n".utf8))
  exit(1)
}
