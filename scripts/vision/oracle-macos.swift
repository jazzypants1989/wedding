// Independent face-detection oracle, for checking our own detector against.
//
// Why this exists: hand-written neural-network inference fails silently and
// numerically. A transposed weight layout or an off-by-one in padding produces
// plausible boxes and quietly terrible accuracy. Without a second, independent
// implementation you are comparing your detector against your own expectations,
// which is not a comparison. macOS ships one in Vision.framework.
//
// This is a dev-machine tool (see CLAUDE.md, "System Binaries Are a Dependency
// Too"). It is never on a code path the app depends on, it is never shipped, and
// nothing it produces is trusted without re-checking. Its only jobs are:
//   1. ground truth for our detector's boxes (IoU comparison in the vision lab)
//   2. aggregate statistics — face counts and pixel sizes over whatever input you
//      point it at — so detector thresholds and working resolution can be tuned
//      locally instead of copied from a paper about a different dataset.
//
// It reads exactly the paths it is given. It never searches for images, and its
// output is local scratch: write it under tmp/ and delete it when you are done.
//
// Build:  swiftc -O -o tmp/oracle-macos scripts/vision/oracle-macos.swift
// Run:    ./tmp/oracle-macos photo.jpg ...        (paths as arguments)
//         find dir -name '*.jpg' | ./tmp/oracle-macos -   (paths on stdin)
//
// Output: one JSON object per image on stdout, newline-delimited. Coordinates
// are in PIXELS, top-left origin, already converted from Vision's normalised
// bottom-left convention. Errors go to stderr; a failed image still emits a row
// with "error" so batch runs stay aligned with their input.
//
// ⚠ Coordinates are in the ORIENTED frame — EXIF orientation applied — because
// that is the frame our own pipeline works in (vips `thumbnail` and
// `magick -auto-orient` both bake the tag into the pixels). The emitted "w"/"h"
// are therefore the oriented dimensions, which for a quarter-turn tag are the
// stored dimensions transposed. See `process` below.

import Foundation
import Vision
import CoreGraphics
import ImageIO

/// EXIF orientation tag (1–8) → the enum Vision wants.
///
/// `CGImagePropertyOrientation`'s raw values are the EXIF numbers, but this is
/// written as an explicit switch rather than `init(rawValue:)` for two reasons:
/// the correspondence is a fact worth asserting rather than assuming, and a
/// malformed file carrying a tag outside 1–8 must fall back to `.up` instead of
/// producing a nil that has to be handled somewhere less obvious.
func orientationFor(_ exif: UInt32) -> CGImagePropertyOrientation {
  switch exif {
  case 1: return .up            // 0th row top,    0th column left  — no transform
  case 2: return .upMirrored    // 0th row top,    0th column right
  case 3: return .down          // 0th row bottom, 0th column right — 180°
  case 4: return .downMirrored  // 0th row bottom, 0th column left
  case 5: return .leftMirrored  // 0th row left,   0th column top   — quarter turn
  case 6: return .right         // 0th row right,  0th column top   — quarter turn
  case 7: return .rightMirrored // 0th row right,  0th column bottom— quarter turn
  case 8: return .left          // 0th row left,   0th column bottom— quarter turn
  default: return .up
  }
}

/// Tags 5–8 exchange the axes: the oriented frame is the stored frame
/// transposed. This is the whole reason the two dimension pairs have to be kept
/// apart below.
func isQuarterTurn(_ exif: UInt32) -> Bool {
  return exif >= 5 && exif <= 8
}

/// The EXIF orientation tag of image 0, or 1 when the file carries none.
///
/// Read from the container's properties rather than the decoded `CGImage`,
/// because `CGImageSourceCreateImageAtIndex` does NOT apply the tag — the
/// returned bitmap is in stored order and knows nothing about it.
func exifOrientation(_ src: CGImageSource) -> UInt32 {
  guard let props = CGImageSourceCopyPropertiesAtIndex(src, 0, nil) as? [CFString: Any],
        let value = props[kCGImagePropertyOrientation] as? NSNumber else {
    return 1
  }
  let tag = value.uint32Value
  return (tag >= 1 && tag <= 8) ? tag : 1
}

/// Vision reports `boundingBox` normalised 0-1 with the origin at the BOTTOM
/// left, against the ORIENTED frame. Every other coordinate system in this
/// project is top-left pixels, so convert once, here, and never think about it
/// again. `width`/`height` must be the ORIENTED dimensions, not the stored ones.
func toPixels(_ box: CGRect, width: Int, height: Int) -> (Double, Double, Double, Double) {
  let w = Double(width), h = Double(height)
  let px = box.origin.x * w
  let pw = box.size.width * w
  let ph = box.size.height * h
  // Flip y: Vision's origin.y is the box's BOTTOM edge measured from the image
  // bottom, so the top edge in top-left space is h - (origin.y + height).
  let py = h - (box.origin.y + box.size.height) * h
  return (px, py, pw, ph)
}

func jsonString(_ s: String) -> String {
  // Minimal JSON string escaping. Paths can contain quotes and backslashes.
  var out = "\""
  for c in s.unicodeScalars {
    switch c {
    case "\"": out += "\\\""
    case "\\": out += "\\\\"
    case "\n": out += "\\n"
    case "\r": out += "\\r"
    case "\t": out += "\\t"
    default:
      if c.value < 0x20 {
        out += String(format: "\\u%04x", c.value)
      } else {
        out.unicodeScalars.append(c)
      }
    }
  }
  return out + "\""
}

func num(_ d: Double) -> String {
  // Two decimals is well past pixel precision and keeps the output diffable.
  return String(format: "%.2f", d)
}

/// One landmark point — normalised, relative to the face bounding box, origin
/// bottom-left, y UP — converted to full-image pixels, top-left origin, y DOWN.
/// Same convention `toPixels` applies to the box itself, factored out here so
/// every per-point conversion in this file (centroid and extremum alike) goes
/// through one place that knows the axis flip.
func toPixelPoint(_ p: CGPoint, x: Double, y: Double, w: Double, h: Double) -> (Double, Double) {
  let fx = x + Double(p.x) * w
  let fy = y + (1.0 - Double(p.y)) * h
  return (fx, fy)
}

/// The centroid of a landmark region, in image pixels.
func centroidPixels(
  _ region: VNFaceLandmarkRegion2D, x: Double, y: Double, w: Double, h: Double
) -> (Double, Double) {
  var sx = 0.0, sy = 0.0
  for p in region.normalizedPoints {
    let (px, py) = toPixelPoint(p, x: x, y: y, w: w, h: h)
    sx += px
    sy += py
  }
  let n = Double(max(region.pointCount, 1))
  return (sx / n, sy / n)
}

/// The point of a landmark region, in image pixels, that is extreme along one
/// axis (0 = x, 1 = y): the argmax when `keepLarger` is true, the argmin when
/// false. Returns nil for an empty region rather than an arbitrary point, so a
/// region Vision reports with zero points cannot silently produce a fabricated
/// coordinate.
func extremumPixels(
  _ region: VNFaceLandmarkRegion2D, x: Double, y: Double, w: Double, h: Double,
  axis: Int, keepLarger: Bool
) -> (Double, Double)? {
  var best: (Double, Double)? = nil
  var bestKey = keepLarger ? -Double.infinity : Double.infinity
  for p in region.normalizedPoints {
    let point = toPixelPoint(p, x: x, y: y, w: w, h: h)
    let k = axis == 0 ? point.0 : point.1
    let better = keepLarger ? (k > bestKey) : (k < bestKey)
    if best == nil || better {
      best = point
      bestKey = k
    }
  }
  return best
}

/// Detect faces in one image and print a JSON line.
func process(_ path: String) {
  let url = URL(fileURLWithPath: path)
  guard let src = CGImageSourceCreateWithURL(url as CFURL, nil),
        let image = CGImageSourceCreateImageAtIndex(src, 0, nil) else {
    print("{\"path\":\(jsonString(path)),\"error\":\"decode\"}")
    return
  }
  // Orientation, and why the two dimension pairs are not interchangeable.
  //
  // Our pipeline auto-orients — vips `thumbnail` and `magick -auto-orient` both
  // bake the EXIF tag into the pixels — so an oracle running at `.up` works in a
  // different frame from the detector it is ground truth for, and every
  // comparison for a rotated photograph is meaningless. Hand Vision the tag.
  //
  // `image.width`/`image.height` are the STORED dimensions; with an orientation
  // supplied, `boundingBox` is normalised against the ORIENTED frame. For a
  // quarter turn those are the stored ones transposed. So the conversion below
  // and the "w"/"h" this row reports both use the oriented pair — that is what
  // the downstream comparison scales against. A transposed frame is exactly the
  // kind of bug that reads as a bad detector.
  let exif = exifOrientation(src)
  let quarterTurn = isQuarterTurn(exif)
  let width = quarterTurn ? image.height : image.width
  let height = quarterTurn ? image.width : image.height

  // Landmarks request gives boxes, roll/yaw, and 76 landmark points.
  // Capture-quality request gives Apple's own sharpness/exposure score, which is
  // the natural comparison for our quality gate.
  let landmarks = VNDetectFaceLandmarksRequest()
  let quality = VNDetectFaceCaptureQualityRequest()
  let handler = VNImageRequestHandler(
    cgImage: image, orientation: orientationFor(exif), options: [:])

  let started = DispatchTime.now()
  do {
    try handler.perform([landmarks, quality])
  } catch {
    print("{\"path\":\(jsonString(path)),\"error\":\"vision\"}")
    return
  }
  let ms = Double(DispatchTime.now().uptimeNanoseconds - started.uptimeNanoseconds) / 1e6

  let faces = landmarks.results ?? []
  let qualities = quality.results ?? []

  var rows: [String] = []
  for (i, face) in faces.enumerated() {
    let (x, y, w, h) = toPixels(face.boundingBox, width: width, height: height)
    var fields = [
      "\"x\":\(num(x))", "\"y\":\(num(y))",
      "\"w\":\(num(w))", "\"h\":\(num(h))",
    ]
    if let roll = face.roll { fields.append("\"roll\":\(num(roll.doubleValue))") }
    if let yaw = face.yaw { fields.append("\"yaw\":\(num(yaw.doubleValue))") }
    if let pitch = face.pitch { fields.append("\"pitch\":\(num(pitch.doubleValue))") }
    if i < qualities.count, let q = qualities[i].faceCaptureQuality {
      fields.append("\"quality\":\(num(Double(q)))")
    }
    if let lm = face.landmarks?.allPoints {
      fields.append("\"points\":\(lm.pointCount)")
      // Both eyes, as image pixels — this is what our five-point landmark order
      // gets asserted against. Vision gives eye contours; use their centroids.
      if let l = face.landmarks?.leftEye, let r = face.landmarks?.rightEye {
        let (lx, ly) = centroidPixels(l, x: x, y: y, w: w, h: h)
        let (rx, ry) = centroidPixels(r, x: x, y: y, w: w, h: h)
        // Named from the subject's point of view, matching Vision's own naming.
        fields.append("\"leftEye\":[\(num(lx)),\(num(ly))]")
        fields.append("\"rightEye\":[\(num(rx)),\(num(ry))]")
      }
      // Nose tip: Vision's `nose` region runs points along the ridge, not just
      // the tip, so the tip is picked out as an extremum rather than assumed to
      // be a particular index. It is the point closest to the mouth — which, in
      // the pixel space this file already emits (top-left origin, y DOWN), is
      // simply the LARGEST pixel y. That is deliberately how this is computed:
      // every candidate point is converted with the one conversion this file
      // already trusts (`toPixelPoint`, the same one the box and the eye
      // centroids go through), and only THEN compared — rather than reasoning
      // about Vision's native y-up/bottom-left convention a second time and
      // risking exactly the kind of axis mistake this file's header exists to
      // avoid making twice.
      if let nose = face.landmarks?.nose,
         let tip = extremumPixels(nose, x: x, y: y, w: w, h: h, axis: 1, keepLarger: true) {
        fields.append("\"noseTip\":[\(num(tip.0)),\(num(tip.1))]")
      }
      // Mouth corners — deliberately NOT named from either source's vocabulary.
      // Vision would name these from the IMAGE's point of view; our own
      // five-point landmark order names the corresponding points from the
      // SUBJECT's point of view. SESSION-2-vision.md §3 records two opposite
      // false alarms from trusting one of those vocabularies over the other for
      // the EYES — matching name-to-name reported ~100% of faces mirrored, and
      // "correcting" that by inverting the comparison reported ~100% again, the
      // other way. Neither was a fact about the pipeline.
      //
      // The fix there was to stop comparing names at all: anchor our side by
      // landmark ORDER and Vision's by GEOMETRY, then let the closer of the two
      // possible pairings win. Naming these fields "mouthImgLeft"/"mouthImgRight"
      // (smaller/larger pixel x — geometry, not vocabulary) does that pairing
      // work here instead of leaving it to be redone, and possibly gotten wrong
      // a third time, on the JS side.
      if let lips = face.landmarks?.outerLips,
         let left = extremumPixels(lips, x: x, y: y, w: w, h: h, axis: 0, keepLarger: false),
         let right = extremumPixels(lips, x: x, y: y, w: w, h: h, axis: 0, keepLarger: true) {
        fields.append("\"mouthImgLeft\":[\(num(left.0)),\(num(left.1))]")
        fields.append("\"mouthImgRight\":[\(num(right.0)),\(num(right.1))]")
      }
    }
    rows.append("{" + fields.joined(separator: ",") + "}")
  }

  print("{\"path\":\(jsonString(path)),\"w\":\(width),\"h\":\(height),"
    + "\"ms\":\(num(ms)),\"faces\":[" + rows.joined(separator: ",") + "]}")
}

var args = Array(CommandLine.arguments.dropFirst())
if args == ["-"] {
  args = []
  while let line = readLine(strippingNewline: true) {
    if !line.isEmpty { args.append(line) }
  }
}
if args.isEmpty {
  FileHandle.standardError.write("usage: oracle-macos <image>... | oracle-macos -\n".data(using: .utf8)!)
  exit(2)
}
for path in args {
  // One pool per image. Without this, CoreGraphics/Vision temporaries for a
  // ~20-megapixel photo are never released inside the loop and a long batch run
  // is killed by the OS partway through. The pool also made the run ~4× faster.
  autoreleasepool {
    process(path)
  }
  // Flush per line so a long run can be watched with `| tail -f`.
  fflush(stdout)
}
