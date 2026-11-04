// Generated images for the culling scorer's end-to-end test. Nothing here is a
// photograph and nothing here depicts anyone: every pixel is drawn below, and the
// "faces" are shaded ellipses that Vision's detector happens to accept.
//
// Usage: vision-cull-fixtures <output-dir>

import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

let srgb = CGColorSpace(name: CGColorSpace.sRGB)!

func canvas(_ width: Int, _ height: Int) -> CGContext {
  CGContext(
    data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0, space: srgb,
    bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
}

/// Coloured blobs from a seed. Same seed and a small shift is a burst; a different
/// seed is a different scene.
func scene(_ width: Int, _ height: Int, seed: Int, shift: Int) -> CGImage {
  let c = canvas(width, height)
  var state = UInt64(seed &* 2_654_435_761 &+ 7)
  func next() -> Double {
    state = state &* 6_364_136_223_846_793_005 &+ 1_442_695_040_888_963_407
    return Double(state >> 40) / Double(1 << 24)
  }
  c.setFillColor(red: next(), green: next(), blue: next(), alpha: 1)
  c.fill(CGRect(x: 0, y: 0, width: width, height: height))
  for _ in 0..<40 {
    c.setFillColor(red: next(), green: next(), blue: next(), alpha: 0.8)
    let x = next() * Double(width) + Double(shift)
    let y = next() * Double(height)
    c.fillEllipse(
      in: CGRect(x: x, y: y, width: next() * Double(width) / 3, height: next() * Double(height) / 3))
  }
  return c.makeImage()!
}

func ellipse(
  _ c: CGContext, _ x: Double, _ y: Double, _ w: Double, _ h: Double, _ rgb: [CGFloat],
  blur: Double = 0
) {
  c.saveGState()
  if blur > 0 {
    c.setShadow(
      offset: .zero, blur: blur, color: CGColor(srgbRed: rgb[0], green: rgb[1], blue: rgb[2], alpha: 1))
  }
  c.setFillColor(red: rgb[0], green: rgb[1], blue: rgb[2], alpha: rgb.count > 3 ? rgb[3] : 1)
  c.fillEllipse(in: CGRect(x: x - w / 2, y: y - h / 2, width: w, height: h))
  c.restoreGState()
}

/// `eye` is the drawn eye height as a fraction of its width.
func drawnFace(_ size: Int, eye: Double) -> CGImage {
  let c = canvas(size, size)
  c.setFillColor(red: 0.42, green: 0.5, blue: 0.58, alpha: 1)
  c.fill(CGRect(x: 0, y: 0, width: size, height: size))
  let s = Double(size) * 0.42
  let cx = Double(size) / 2
  let cy = Double(size) * 0.52
  let dark: [CGFloat] = [0.18, 0.11, 0.08]

  ellipse(c, cx, cy - s * 1.9, s * 2.6, s * 1.4, [0.15, 0.17, 0.25])
  c.setFillColor(red: 0.76, green: 0.56, blue: 0.45, alpha: 1)
  c.fill(CGRect(x: cx - s * 0.28, y: cy - s * 1.45, width: s * 0.56, height: s * 0.7))
  ellipse(c, cx, cy + s * 0.2, s * 1.62, s * 2.0, dark)
  ellipse(c, cx - s * 0.74, cy, s * 0.18, s * 0.36, [0.86, 0.66, 0.54])
  ellipse(c, cx + s * 0.74, cy, s * 0.18, s * 0.36, [0.86, 0.66, 0.54])

  c.saveGState()
  c.addEllipse(in: CGRect(x: cx - s * 0.72, y: cy - s, width: s * 1.44, height: s * 1.9))
  c.clip()
  let gradient = CGGradient(
    colorSpace: srgb, colorComponents: [0.95, 0.77, 0.65, 1, 0.6, 0.42, 0.33, 1], locations: [0, 1],
    count: 2)!
  let center = CGPoint(x: cx, y: cy + s * 0.05)
  c.drawRadialGradient(
    gradient, startCenter: center, startRadius: 0, endCenter: center, endRadius: CGFloat(s * 1.1),
    options: [])
  ellipse(c, cx, cy + s * 1.0, s * 1.5, s * 0.62, dark)
  c.restoreGState()

  for side in [-1.0, 1.0] {
    let ex = cx + side * s * 0.31
    let ey = cy + s * 0.12
    let ew = s * 0.27
    let eh = ew * eye
    ellipse(c, ex, ey + s * 0.01, ew * 1.5, s * 0.2, [0.62, 0.44, 0.36, 0.6], blur: s * 0.05)
    c.saveGState()
    c.setStrokeColor(red: dark[0], green: dark[1], blue: dark[2], alpha: 1)
    c.setLineWidth(s * 0.05)
    c.setLineCap(.round)
    c.move(to: CGPoint(x: ex - ew * 0.65, y: ey + s * 0.17))
    c.addQuadCurve(
      to: CGPoint(x: ex + ew * 0.65, y: ey + s * 0.17), control: CGPoint(x: ex, y: ey + s * 0.24))
    c.strokePath()
    c.restoreGState()
    ellipse(c, ex, ey, ew, eh, [0.96, 0.96, 0.94])
    let iris = min(eh * 0.95, ew * 0.5)
    ellipse(c, ex, ey, iris, iris, [0.25, 0.17, 0.1])
    ellipse(c, ex, ey, iris * 0.5, iris * 0.5, [0.02, 0.02, 0.02])
    c.setStrokeColor(red: 0.1, green: 0.07, blue: 0.06, alpha: 1)
    c.setLineWidth(s * 0.018)
    c.strokeEllipse(in: CGRect(x: ex - ew / 2, y: ey - eh / 2, width: ew, height: eh))
  }

  ellipse(c, cx, cy - s * 0.18, s * 0.26, s * 0.14, [0.72, 0.52, 0.42], blur: s * 0.03)
  ellipse(c, cx - s * 0.07, cy - s * 0.21, s * 0.05, s * 0.03, [0.3, 0.17, 0.13])
  ellipse(c, cx + s * 0.07, cy - s * 0.21, s * 0.05, s * 0.03, [0.3, 0.17, 0.13])
  ellipse(c, cx, cy - s * 0.5, s * 0.46, s * 0.13, [0.66, 0.26, 0.26])
  ellipse(c, cx, cy - s * 0.5, s * 0.36, s * 0.035, [0.3, 0.08, 0.08])
  return c.makeImage()!
}

func write(
  _ image: CGImage, _ path: String, type: UTType = .jpeg, date: String? = nil, subsec: String? = nil,
  orientation: Int? = nil
) {
  try! FileManager.default.createDirectory(
    atPath: (path as NSString).deletingLastPathComponent, withIntermediateDirectories: true)
  let destination = CGImageDestinationCreateWithURL(
    URL(fileURLWithPath: path) as CFURL, type.identifier as CFString, 1, nil)!
  var properties: [CFString: Any] = [:]
  if let date {
    var exif: [CFString: Any] = [kCGImagePropertyExifDateTimeOriginal: date]
    if let subsec { exif[kCGImagePropertyExifSubsecTimeOriginal] = subsec }
    properties[kCGImagePropertyExifDictionary] = exif
  }
  if let orientation { properties[kCGImagePropertyOrientation] = orientation }
  CGImageDestinationAddImage(destination, image, properties as CFDictionary)
  guard CGImageDestinationFinalize(destination) else { fatalError("could not write \(path)") }
}

let root = CommandLine.arguments[1]

// One burst, then a different scene long after it.
write(scene(1200, 800, seed: 1, shift: 0), root + "/ceremony/a1.jpg", date: "2025:06:14 17:02:11", subsec: "120")
write(scene(1200, 800, seed: 1, shift: 6), root + "/ceremony/a2.jpg", date: "2025:06:14 17:02:12", subsec: "450")
write(scene(1200, 800, seed: 1, shift: 12), root + "/ceremony/a3.jpg", date: "2025:06:14 17:02:13")
write(scene(1200, 800, seed: 9, shift: 0), root + "/ceremony/other.jpg", date: "2025:06:14 18:40:00")

// A stored landscape frame with EXIF orientation 6: the output must come out portrait.
write(scene(1200, 800, seed: 3, shift: 0), root + "/reception/rotated.jpg", date: "2025:06:14 21:00:00", orientation: 6)

// What a phone writes: Chrome cannot decode this, so only its preview can be shown.
write(scene(1000, 750, seed: 7, shift: 0), root + "/reception/phone.heic", type: .heic, date: "2025:06:14 21:30:00")

// Two drawn faces a second apart: one with wide eyes, one with narrow ones.
write(drawnFace(1200, eye: 0.55), root + "/reception/wide.jpg", date: "2025:06:14 22:00:00")
write(drawnFace(1200, eye: 0.3), root + "/reception/narrow.jpg", date: "2025:06:14 22:00:01")

// No capture time, and a filename a shell would misread.
write(scene(800, 800, seed: 5, shift: 0), root + "/reception/no-exif.png", type: .png)
write(scene(800, 800, seed: 6, shift: 0), root + "/reception/caf\u{00e9} $x; \"q\".jpg")
