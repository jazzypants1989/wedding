// Per-photograph scores for the culling page (scripts/vision/cull.html).
//
// For each image under one directory: a Vision aesthetics score, a feature print
// for similarity, and for each face a capture quality and an eye-openness ratio
// from the landmark contours. Plus a small thumbnail and a larger preview,
// because a browser cannot lay out thousands of 12-megapixel originals and cannot
// decode HEIC at all outside Safari. Videos get a poster frame and no scores.
//
// This is a dev-machine tool (see CLAUDE.md, "System Binaries Are a Dependency
// Too"). It is never on a code path the app depends on and it is never shipped.
// Everything runs on-device inside Vision.framework; nothing here opens a socket.
//
// The photograph rules apply (CLAUDE.md, "Photographs Are Input To Code"):
//   - The directory is always an argument. Nothing searches for images.
//   - Output is scratch. Inside a repository it must be under that repository's
//     top-level tmp/ (so never public/tmp); outside one, under a `tmp` directory.
//   - Thumbnails and previews are re-encoded from pixels, so they carry no EXIF
//     and no GPS. They are still photographs of people: delete them when done.
//   - Progress on stderr is counts only. A filename can carry a guest's name.
//
// Build:  swiftc -O -o tmp/cull-scores-macos scripts/vision/cull-scores-macos.swift
// Run:    ./tmp/cull-scores-macos <photo-dir>
//         ./tmp/cull-scores-macos <photo-dir> --out tmp/cull --jobs 3
//         ./tmp/cull-scores-macos --probe      (which Vision APIs exist here)
//
// Output, under --out (default tmp/cull):
//   scores.jsonl   a `meta` row per run, then one row per file
//   thumbs/        <digest>.jpg, long edge --thumb-px
//   previews/      <digest>.jpg, long edge --preview-px (0 turns previews off)
//
// Interrupting is safe: every row is flushed when it is complete, and a re-run
// skips any file whose relative path, size and mtime match a row without an error.
//
// Degrades instead of failing: an API the OS lacks, or one that errors on a probe
// image, is recorded under the meta row's `apis` and skipped for the whole run.
// One that fails on a single photograph is named in that row's `errors`.
//
// Coordinates: face boxes are normalised 0-1, TOP-LEFT origin, in the ORIENTED
// frame (EXIF orientation applied), which is the frame session1.js's boxes are in
// once divided by that photograph's decoded width and height.

import AVFoundation
import CoreGraphics
import CryptoKit
import Foundation
import ImageIO
import UniformTypeIdentifiers
import Vision

let scoresVersion = 1

func fail(_ message: String) -> Never {
  FileHandle.standardError.write((message + "\n").data(using: .utf8)!)
  exit(2)
}

// --- Where output may go. The same rule as scripts/vision/scratch-dir.js. ---------

/// The path with every symlink in its existing part resolved, and the part that does
/// not exist yet appended unchanged.
func resolveExisting(_ path: String) -> String {
  var missing: [String] = []
  var at = path
  while true {
    if let resolved = realpath(at, nil) {
      var base = String(cString: resolved)
      free(resolved)
      for name in missing.reversed() { base = base == "/" ? "/" + name : base + "/" + name }
      return base
    }
    let parent = (at as NSString).deletingLastPathComponent
    if parent == at || parent.isEmpty { return path }
    missing.append((at as NSString).lastPathComponent)
    at = parent
  }
}

/// The nearest directory at or above `path` holding a `.git`, or nil. One stat per
/// ancestor; nothing is listed.
func enclosingRepository(_ path: String) -> String? {
  var at = path
  while true {
    if at != "/" && FileManager.default.fileExists(atPath: at + "/.git") { return at }
    let parent = (at as NSString).deletingLastPathComponent
    if parent == at || parent.isEmpty { return nil }
    at = parent
  }
}

func isWithin(_ child: String, _ parent: String) -> Bool {
  return child == parent || child.hasPrefix(parent + "/")
}

/// Why `path` may not hold output, or nil. Inside a repository, only under its own
/// top-level tmp/: a directory named tmp elsewhere in one (public/tmp, say) may be
/// served or committed. Outside every repository, under a directory named tmp.
func scratchRefusal(_ path: String) -> String? {
  let real = resolveExisting(path)
  var inRepository = false
  for candidate in [path, real] {
    guard let repository = enclosingRepository(candidate) else { continue }
    inRepository = true
    if !isWithin(candidate, repository + "/tmp") {
      return "\(path) is inside the repository at \(repository) but not under its top-level "
        + "tmp/. Everything derived from a photograph is scratch."
    }
  }
  if inRepository { return nil }
  if [path, real].contains(where: { $0.split(separator: "/").contains("tmp") }) { return nil }
  return "\(path) is not under a tmp directory. Everything derived from a photograph is scratch."
}

let usage = """
  usage: cull-scores-macos <photo-dir> [options]
         cull-scores-macos --probe

    --out DIR          Output directory (default tmp/cull): a repository's top-level tmp/,
                       or a tmp directory outside every repository
    --jobs N           Photographs processed at once (default 3)
    --vision-px N      Longest edge handed to Vision (default 3200, never upscales)
    --preview-px N     Longest edge of previews (default 1600; 0 for none)
    --thumb-px N       Longest edge of thumbnails (default 400)
    --force            Discard earlier output in --out and start over
    --probe            Print which Vision APIs work on this machine, then exit
  """

struct Options {
  var dir: String? = nil
  var out = "tmp/cull"
  var jobs = 3
  var visionEdge = 3200
  var previewEdge = 1600
  var thumbEdge = 400
  var force = false
  var probe = false
}

func parseOptions(_ argv: [String]) -> Options {
  var options = Options()
  var i = 0

  func intValue(_ flag: String, min: Int) -> Int {
    i += 1
    guard i < argv.count, let n = Int(argv[i]), n >= min else {
      fail("\(flag) needs an integer >= \(min)\n\(usage)")
    }
    return n
  }

  while i < argv.count {
    let arg = argv[i]
    switch arg {
    case "--out":
      i += 1
      guard i < argv.count else { fail("--out needs a value\n\(usage)") }
      options.out = argv[i]
    case "--jobs": options.jobs = intValue(arg, min: 1)
    case "--vision-px": options.visionEdge = intValue(arg, min: 256)
    case "--preview-px": options.previewEdge = intValue(arg, min: 0)
    case "--thumb-px": options.thumbEdge = intValue(arg, min: 32)
    case "--force": options.force = true
    case "--probe": options.probe = true
    case "--help", "-h":
      print(usage)
      exit(0)
    default:
      if arg.hasPrefix("--") { fail("Unknown option \(arg)\n\(usage)") }
      if options.dir != nil {
        fail("Expected one photo directory. Quote paths containing spaces.\n\(usage)")
      }
      options.dir = arg
    }
    i += 1
  }
  return options
}

// --- What this machine can actually do -----------------------------------------

/// A flat 256px gradient. The probe needs an image, and it must not be a
/// photograph: asking whether an API runs is not a reason to read anybody's.
func probeImage() -> CGImage? {
  guard
    let context = CGContext(
      data: nil, width: 256, height: 256, bitsPerComponent: 8, bytesPerRow: 0,
      space: CGColorSpaceCreateDeviceRGB(),
      bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
  else { return nil }
  for y in 0..<256 {
    context.setFillColor(red: CGFloat(y) / 256, green: 0.4, blue: 1 - CGFloat(y) / 256, alpha: 1)
    context.fill(CGRect(x: 0, y: y, width: 256, height: 1))
  }
  return context.makeImage()
}

struct Availability {
  var aesthetics = false
  var featurePrint = false
  var faceLandmarks = false
  var faceCaptureQuality = false
  var notes: [String: String] = [:]

  var json: [String: Any] {
    func entry(_ name: String, _ ok: Bool) -> [String: Any] {
      var row: [String: Any] = ["available": ok]
      if let note = notes[name] { row["note"] = note }
      return row
    }
    return [
      "aesthetics": entry("aesthetics", aesthetics),
      "featurePrint": entry("featurePrint", featurePrint),
      "faceLandmarks": entry("faceLandmarks", faceLandmarks),
      "faceCaptureQuality": entry("faceCaptureQuality", faceCaptureQuality),
    ]
  }
}

/// Existence is a compile-time and OS-version fact, but the model behind a request
/// can still be absent. So every API is tried once, for real, before the batch.
func probeApis() -> Availability {
  var result = Availability()
  guard let image = probeImage() else {
    result.notes["aesthetics"] = "could not build a probe image"
    return result
  }
  let handler = VNImageRequestHandler(cgImage: image, options: [:])

  if #available(macOS 15.0, *) {
    do {
      let request = VNCalculateImageAestheticsScoresRequest()
      try handler.perform([request])
      result.aesthetics = request.results?.first != nil
      if !result.aesthetics { result.notes["aesthetics"] = "returned no observation" }
    } catch {
      result.notes["aesthetics"] = "probe failed: \(error.localizedDescription)"
    }
  } else {
    result.notes["aesthetics"] = "requires macOS 15"
  }

  do {
    let request = VNGenerateImageFeaturePrintRequest()
    try handler.perform([request])
    result.featurePrint = request.results?.first != nil
    if !result.featurePrint { result.notes["featurePrint"] = "returned no observation" }
  } catch {
    result.notes["featurePrint"] = "probe failed: \(error.localizedDescription)"
  }

  // A gradient has no face in it, so "no results and no error" is the pass.
  do {
    try handler.perform([VNDetectFaceLandmarksRequest()])
    result.faceLandmarks = true
  } catch {
    result.notes["faceLandmarks"] = "probe failed: \(error.localizedDescription)"
  }
  do {
    try handler.perform([VNDetectFaceCaptureQualityRequest()])
    result.faceCaptureQuality = true
  } catch {
    result.notes["faceCaptureQuality"] = "probe failed: \(error.localizedDescription)"
  }
  return result
}

// --- Walking the one directory we were given --------------------------------------

/// Relative paths under `root`, "/"-joined, following symlinks exactly as
/// scanDirectory in scripts/import-media.js does so both see the same files. The
/// realpath set is what stops a symlink loop from recursing forever.
func walk(_ root: String) -> [String] {
  var found: [String] = []
  var visited = Set<String>()
  let manager = FileManager.default

  func visit(_ current: String, _ prefix: String) {
    guard let resolved = realpath(current, nil) else { return }
    let key = String(cString: resolved)
    free(resolved)
    if !visited.insert(key).inserted { return }
    guard let entries = try? manager.contentsOfDirectory(atPath: current) else { return }
    for name in entries {
      let absolute = current + "/" + name
      let relative = prefix.isEmpty ? name : prefix + "/" + name
      var isDir: ObjCBool = false
      guard manager.fileExists(atPath: absolute, isDirectory: &isDir) else { continue }
      if isDir.boolValue {
        visit(absolute, relative)
      } else {
        found.append(relative)
      }
    }
  }

  visit(root, "")
  return found.sorted { Array($0.utf8).lexicographicallyPrecedes(Array($1.utf8)) }
}

/// An ISO BMFF box at the start of the file. Only consulted once CGImageSource has
/// declined the file, so a HEIC never reaches it.
func looksLikeVideo(_ path: String) -> Bool {
  guard let handle = FileHandle(forReadingAtPath: path) else { return false }
  defer { try? handle.close() }
  guard let head = try? handle.read(upToCount: 12), head.count == 12 else { return false }
  return head.subdata(in: 4..<8) == "ftyp".data(using: .ascii)
}

// --- Pixels ------------------------------------------------------------------------

/// Oriented, downscaled to at most `edge`. `FromImageAlways` stops ImageIO handing
/// back a tiny embedded thumbnail; `WithTransform` applies the EXIF tag, so every
/// frame in this file is the oriented one and Vision can run at `.up`.
func orientedImage(_ source: CGImageSource, edge: Int) -> CGImage? {
  let options: [CFString: Any] = [
    kCGImageSourceCreateThumbnailFromImageAlways: true,
    kCGImageSourceCreateThumbnailWithTransform: true,
    kCGImageSourceThumbnailMaxPixelSize: edge,
    kCGImageSourceShouldCacheImmediately: true,
  ]
  return CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary)
}

func scaled(_ image: CGImage, edge: Int) -> CGImage? {
  let longest = max(image.width, image.height)
  if longest <= edge { return image }
  let factor = Double(edge) / Double(longest)
  let width = max(1, Int((Double(image.width) * factor).rounded()))
  let height = max(1, Int((Double(image.height) * factor).rounded()))
  // The source's colour space where an 8-bit context supports it, sRGB where it
  // does not (an HDR HEIC, say). Keeping Display P3 is what stops every preview
  // from looking washed out next to its original.
  let bitmapInfo = CGImageAlphaInfo.premultipliedLast.rawValue
  var context: CGContext? = nil
  if let space = image.colorSpace {
    context = CGContext(
      data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0, space: space,
      bitmapInfo: bitmapInfo)
  }
  if context == nil, let srgb = CGColorSpace(name: CGColorSpace.sRGB) {
    context = CGContext(
      data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0, space: srgb,
      bitmapInfo: bitmapInfo)
  }
  guard let canvas = context else { return nil }
  canvas.interpolationQuality = .high
  // JPEG has no alpha. Transparent pixels land on this instead of on black.
  canvas.setFillColor(gray: 0.5, alpha: 1)
  canvas.fill(CGRect(x: 0, y: 0, width: width, height: height))
  canvas.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
  return canvas.makeImage()
}

/// Encoded from a CGImage with no properties dictionary, so no metadata survives.
func writeJpeg(_ image: CGImage, to path: String) -> Bool {
  guard
    let destination = CGImageDestinationCreateWithURL(
      URL(fileURLWithPath: path) as CFURL, UTType.jpeg.identifier as CFString, 1, nil)
  else { return false }
  let properties: [CFString: Any] = [kCGImageDestinationLossyCompressionQuality: 0.82]
  CGImageDestinationAddImage(destination, image, properties as CFDictionary)
  return CGImageDestinationFinalize(destination)
}

/// The EXIF capture time, verbatim. Parsed in cull-logic.js, where it is testable.
/// mtime is deliberately not a fallback: copying a directory stamps every file with
/// the same moment, which would read as one enormous burst.
func captureTime(_ source: CGImageSource) -> (String, String?)? {
  guard
    let props = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
    let exif = props[kCGImagePropertyExifDictionary] as? [CFString: Any]
  else { return nil }
  if let original = exif[kCGImagePropertyExifDateTimeOriginal] as? String {
    return (original, exif[kCGImagePropertyExifSubsecTimeOriginal] as? String)
  }
  if let digitized = exif[kCGImagePropertyExifDateTimeDigitized] as? String {
    return (digitized, exif[kCGImagePropertyExifSubsecTimeDigitized] as? String)
  }
  return nil
}

func storedDimensions(_ source: CGImageSource, oriented: CGImage) -> (Int, Int) {
  guard
    let props = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
    let width = (props[kCGImagePropertyPixelWidth] as? NSNumber)?.intValue,
    let height = (props[kCGImagePropertyPixelHeight] as? NSNumber)?.intValue
  else { return (oriented.width, oriented.height) }
  // Report the oriented pair. Which way round is decided by the image we actually
  // decoded, rather than by re-deriving it from the tag a second time.
  let landscape = oriented.width >= oriented.height
  return landscape ? (max(width, height), min(width, height)) : (min(width, height), max(width, height))
}

// --- Vision ------------------------------------------------------------------------

func round4(_ value: Double) -> Double {
  return (value * 10000).rounded() / 10000
}

/// Openness of one eye: how tall the contour is across its own long axis, divided
/// by that axis. Computed in pixels, because `normalizedPoints` are relative to a
/// box that is not square, and against the contour's own axis so that a tilted head
/// does not read as a squint. Nil for a contour too sparse to have a shape.
func eyeOpenness(_ region: VNFaceLandmarkRegion2D?, faceWidth: Double, faceHeight: Double) -> Double? {
  guard let region, region.pointCount >= 4 else { return nil }
  let points = region.normalizedPoints.map { (Double($0.x) * faceWidth, Double($0.y) * faceHeight) }

  var axis = (0.0, 0.0)
  var length = 0.0
  for i in 0..<points.count {
    for j in (i + 1)..<points.count {
      let dx = points[j].0 - points[i].0
      let dy = points[j].1 - points[i].1
      let distance = (dx * dx + dy * dy).squareRoot()
      if distance > length {
        length = distance
        axis = (dx / distance, dy / distance)
      }
    }
  }
  if length == 0 { return nil }

  var low = Double.infinity
  var high = -Double.infinity
  for point in points {
    let across = point.0 * -axis.1 + point.1 * axis.0
    low = min(low, across)
    high = max(high, across)
  }
  return round4((high - low) / length)
}

func overlap(_ a: CGRect, _ b: CGRect) -> Double {
  let shared = a.intersection(b)
  if shared.isNull { return 0 }
  let inner = Double(shared.width * shared.height)
  let outer = Double(a.width * a.height + b.width * b.height) - inner
  return outer > 0 ? inner / outer : 0
}

/// Everything Vision says about one oriented image, as JSON fields. `errors` names
/// any request that failed on this photograph while the others carried on.
func scoreImage(_ image: CGImage, apis: Availability) -> ([String: Any], [String]) {
  var row: [String: Any] = [:]
  var errors: [String] = []
  let handler = VNImageRequestHandler(cgImage: image, options: [:])

  if apis.aesthetics, #available(macOS 15.0, *) {
    let request = VNCalculateImageAestheticsScoresRequest()
    do {
      try handler.perform([request])
      if let result = request.results?.first {
        row["aesthetics"] = Double(result.overallScore).isFinite ? round4(Double(result.overallScore)) : NSNull()
        row["utility"] = result.isUtility
      } else {
        errors.append("aesthetics")
      }
    } catch {
      errors.append("aesthetics")
    }
  }

  if apis.featurePrint {
    let request = VNGenerateImageFeaturePrintRequest()
    do {
      try handler.perform([request])
      if let result = request.results?.first {
        row["featurePrint"] = [
          "type": result.elementType == .float ? "float32" : "float64",
          "count": result.elementCount,
          "b64": result.data.base64EncodedString(),
        ] as [String: Any]
      } else {
        errors.append("featurePrint")
      }
    } catch {
      errors.append("featurePrint")
    }
  }

  var faces: [[String: Any]] = []
  if apis.faceLandmarks {
    let landmarks = VNDetectFaceLandmarksRequest()
    do {
      try handler.perform([landmarks])
    } catch {
      errors.append("faceLandmarks")
    }
    let observations = landmarks.results ?? []

    // Handing quality the landmark observations is what makes the two lists about
    // the same faces. Run independently it does its own detection, and pairing
    // those by index would be a guess.
    var qualities: [VNFaceObservation] = []
    if apis.faceCaptureQuality && !observations.isEmpty {
      let quality = VNDetectFaceCaptureQualityRequest()
      quality.inputFaceObservations = observations
      do {
        try handler.perform([quality])
        qualities = quality.results ?? []
      } catch {
        errors.append("faceCaptureQuality")
      }
    }

    for face in observations {
      let box = face.boundingBox
      let widthPx = Double(box.width) * Double(image.width)
      let heightPx = Double(box.height) * Double(image.height)
      var entry: [String: Any] = [
        "x": round4(Double(box.minX)),
        // Vision's origin is bottom-left; every other frame in this project is not.
        "y": round4(1 - Double(box.maxY)),
        "w": round4(Double(box.width)),
        "h": round4(Double(box.height)),
        "px": widthPx.rounded(),
      ]
      if let yaw = face.yaw { entry["yaw"] = round4(yaw.doubleValue) }

      var best: VNFaceObservation? = nil
      var bestOverlap = 0.0
      for candidate in qualities {
        let score = overlap(candidate.boundingBox, box)
        if score > bestOverlap {
          bestOverlap = score
          best = candidate
        }
      }
      if let q = best?.faceCaptureQuality { entry["quality"] = round4(Double(q)) }

      if let left = eyeOpenness(face.landmarks?.leftEye, faceWidth: widthPx, faceHeight: heightPx) {
        entry["leftEye"] = left
      }
      if let right = eyeOpenness(face.landmarks?.rightEye, faceWidth: widthPx, faceHeight: heightPx) {
        entry["rightEye"] = right
      }
      faces.append(entry)
    }
  }
  if apis.faceLandmarks { row["faces"] = faces }
  return (row, errors)
}

// --- Videos ------------------------------------------------------------------------

/// A frame to recognise the clip by. Videos are never scored: this exists only so
/// the page's list is something a person can read at a glance.
func videoPoster(_ url: URL, edge: Int) -> CGImage? {
  let generator = AVAssetImageGenerator(asset: AVURLAsset(url: url))
  generator.appliesPreferredTrackTransform = true
  generator.maximumSize = CGSize(width: edge, height: edge)
  let done = DispatchSemaphore(value: 0)
  nonisolated(unsafe) var poster: CGImage? = nil
  generator.generateCGImageAsynchronously(for: CMTime(seconds: 1, preferredTimescale: 600)) {
    image, _, _ in
    poster = image
    done.signal()
  }
  // A damaged file must cost one missing poster, never a hung batch.
  if done.wait(timeout: .now() + 20) == .timedOut {
    generator.cancelAllCGImageGeneration()
    return nil
  }
  return poster
}

// --- One file ---------------------------------------------------------------------

/// Size and mtime, as the resume check and the row both record them.
func fileStamp(_ absolute: String) -> (size: Int, mtimeMs: Double) {
  let attributes = try? FileManager.default.attributesOfItem(atPath: absolute)
  return (
    (attributes?[.size] as? NSNumber)?.intValue ?? 0,
    ((attributes?[.modificationDate] as? Date)?.timeIntervalSince1970 ?? 0) * 1000
  )
}

/// A digest rather than a counter. Non-media files and interrupted runs leave gaps
/// in any count, and a resumed run must never reuse a number and overwrite another
/// photograph's thumbnail. A digest also keeps the filename, which can carry a
/// guest's name, out of the output directory's listing.
func derivedName(_ key: String) -> String {
  let digest = SHA256.hash(data: Data(key.utf8))
  return digest.prefix(10).map { String(format: "%02x", $0) }.joined() + ".jpg"
}

/// Nil means "not something this tool scores", which covers .DS_Store and sidecars.
func processFile(
  relative: String, root: String, out: String, options: Options, apis: Availability
) -> [String: Any]? {
  let absolute = root + "/" + relative
  let url = URL(fileURLWithPath: absolute)
  let stamp = fileStamp(absolute)
  var row: [String: Any] = [
    "rel": relative,
    "size": stamp.size,
    "mtimeMs": stamp.mtimeMs,
  ]

  let name = derivedName(resumeKey(relative, stamp.size, stamp.mtimeMs))
  let thumbRelative = "thumbs/" + name
  let previewRelative = "previews/" + name

  let started = DispatchTime.now()
  let source = CGImageSourceCreateWithURL(url as CFURL, nil)
  let isImage = source.map { CGImageSourceGetType($0) != nil && CGImageSourceGetCount($0) > 0 } ?? false

  if !isImage {
    guard looksLikeVideo(absolute) else { return nil }
    row["kind"] = "video"
    if let poster = videoPoster(url, edge: options.thumbEdge),
      let small = scaled(poster, edge: options.thumbEdge),
      writeJpeg(small, to: out + "/" + thumbRelative)
    {
      row["thumb"] = thumbRelative
    }
    return row
  }

  row["kind"] = "image"
  guard let source, let oriented = orientedImage(source, edge: options.visionEdge) else {
    row["error"] = "decode"
    return row
  }

  let (width, height) = storedDimensions(source, oriented: oriented)
  row["w"] = width
  row["h"] = height
  if let (captured, subsec) = captureTime(source) {
    row["captured"] = captured
    if let subsec { row["subsec"] = subsec }
  }

  let (fields, errors) = scoreImage(oriented, apis: apis)
  row.merge(fields) { _, new in new }

  var failures = errors
  if let small = scaled(oriented, edge: options.thumbEdge),
    writeJpeg(small, to: out + "/" + thumbRelative)
  {
    row["thumb"] = thumbRelative
  } else {
    failures.append("thumb")
  }
  if options.previewEdge > 0 {
    if let large = scaled(oriented, edge: options.previewEdge),
      writeJpeg(large, to: out + "/" + previewRelative)
    {
      row["preview"] = previewRelative
    } else {
      failures.append("preview")
    }
  }

  if !failures.isEmpty { row["errors"] = failures }
  row["ms"] = (Double(DispatchTime.now().uptimeNanoseconds - started.uptimeNanoseconds) / 1e6).rounded()
  return row
}

// --- Resume -----------------------------------------------------------------------

struct Previous {
  var root: String? = nil
  var done = Set<String>()
  var endsCleanly = true
}

/// A row with an `error` is retried. A row with `errors` is not: its scores are
/// partial but real, and the page says which are missing.
func readPrevious(_ file: String) -> Previous {
  var previous = Previous()
  guard let data = FileManager.default.contents(atPath: file), !data.isEmpty else { return previous }
  previous.endsCleanly = data.last == UInt8(ascii: "\n")
  for line in data.split(separator: UInt8(ascii: "\n")) {
    guard let row = try? JSONSerialization.jsonObject(with: Data(line)) as? [String: Any] else {
      continue
    }
    if row["kind"] as? String == "meta" {
      previous.root = row["root"] as? String
      continue
    }
    guard row["error"] == nil,
      let rel = row["rel"] as? String,
      let size = row["size"] as? NSNumber,
      let mtime = row["mtimeMs"] as? NSNumber
    else { continue }
    previous.done.insert(resumeKey(rel, size.intValue, mtime.doubleValue))
  }
  return previous
}

func resumeKey(_ rel: String, _ size: Int, _ mtimeMs: Double) -> String {
  return "\(rel)\u{0}\(size)\u{0}\(Int64(mtimeMs.rounded()))"
}

// --- Main -------------------------------------------------------------------------

func jsonLine(_ row: [String: Any]) -> Data {
  // JSONSerialization rather than the hand-rolled escaper in oracle-macos.swift:
  // this file has nested objects and optional fields, and paths with newlines in
  // them are exactly the input a hand-rolled writer gets wrong.
  guard
    var data = try? JSONSerialization.data(
      withJSONObject: row, options: [.sortedKeys, .withoutEscapingSlashes])
  else { return Data() }
  data.append(UInt8(ascii: "\n"))
  return data
}

let options = parseOptions(Array(CommandLine.arguments.dropFirst()))
let apis = probeApis()
let osVersion = ProcessInfo.processInfo.operatingSystemVersionString

if options.probe {
  let probe: [String: Any] = ["kind": "meta", "os": osVersion, "apis": apis.json]
  FileHandle.standardOutput.write(jsonLine(probe))
  exit(0)
}

guard let givenDir = options.dir else { fail("No photo directory given.\n\(usage)") }
var isDirectory: ObjCBool = false
guard FileManager.default.fileExists(atPath: givenDir, isDirectory: &isDirectory), isDirectory.boolValue
else { fail("Not a directory: \(givenDir)") }

// realpath(3) rather than URL's resolvingSymlinksInPath, which strips /private and
// would disagree with the fs.realpathSync that cull-data.js compares this against.
guard let resolvedRoot = realpath(givenDir, nil) else { fail("Could not resolve \(givenDir)") }
let root = String(cString: resolvedRoot)
free(resolvedRoot)
let outUrl = URL(fileURLWithPath: options.out).standardizedFileURL
if let refusal = scratchRefusal(outUrl.path) {
  fail("--out: \(refusal)")
}
let out = outUrl.path
let scoresFile = out + "/scores.jsonl"

if options.force {
  for name in ["scores.jsonl", "thumbs", "previews"] {
    try? FileManager.default.removeItem(atPath: out + "/" + name)
  }
}
for name in ["thumbs", "previews"] {
  do {
    try FileManager.default.createDirectory(
      atPath: out + "/" + name, withIntermediateDirectories: true)
  } catch {
    fail("Could not create \(out)/\(name): \(error.localizedDescription)")
  }
}

let previous = readPrevious(scoresFile)
if let earlier = previous.root, earlier != root {
  fail(
    "\(scoresFile) belongs to a different photo directory. "
      + "Pass --force to replace it, or a different --out.")
}

if !FileManager.default.fileExists(atPath: scoresFile) {
  FileManager.default.createFile(atPath: scoresFile, contents: nil)
}
guard let writer = FileHandle(forWritingAtPath: scoresFile) else {
  fail("Could not open \(scoresFile) for writing.")
}
_ = try? writer.seekToEnd()
// An interrupted run can leave half a line. Without this the next row would be
// glued onto it and both would be lost.
if !previous.endsCleanly { writer.write("\n".data(using: .utf8)!) }

let meta: [String: Any] = [
  "kind": "meta", "version": scoresVersion, "root": root, "os": osVersion, "apis": apis.json,
]
writer.write(jsonLine(meta))

for name in ["aesthetics", "featurePrint", "faceLandmarks", "faceCaptureQuality"] {
  if let note = apis.notes[name] {
    FileHandle.standardError.write("! \(name) unavailable: \(note)\n".data(using: .utf8)!)
  }
}

let files = walk(root).filter { relative in
  let stamp = fileStamp(root + "/" + relative)
  return !previous.done.contains(resumeKey(relative, stamp.size, stamp.mtimeMs))
}

let lock = NSLock()
var nextFile = 0
var written = 0
var skipped = 0
var failed = 0

DispatchQueue.concurrentPerform(iterations: options.jobs) { _ in
  while true {
    lock.lock()
    let position = nextFile
    nextFile += 1
    lock.unlock()
    if position >= files.count { return }

    // One pool per image, for the reason oracle-macos.swift gives: without it the
    // temporaries for a large photograph are never released inside the loop.
    autoreleasepool {
      let row = processFile(
        relative: files[position], root: root, out: out, options: options, apis: apis)
      lock.lock()
      defer { lock.unlock() }
      if let row {
        writer.write(jsonLine(row))
        written += 1
        if row["error"] != nil { failed += 1 }
      } else {
        skipped += 1
      }
      if (written + skipped) % 100 == 0 {
        FileHandle.standardError.write("\(written + skipped) of \(files.count)\n".data(using: .utf8)!)
      }
    }
  }
}

try? writer.close()
FileHandle.standardError.write(
  "Done: \(written) row(s) written, \(failed) undecodable, \(skipped) not media, \(previous.done.count) already scored.\n"
    .data(using: .utf8)!)
print(scoresFile)
