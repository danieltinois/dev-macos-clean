// Similar photos: sessions by time, and Vision grouping on drawn scenes.
import CoreGraphics
import Foundation
import Testing
@testable import DevCleanKit

@Suite struct SimilarPhotosTests {
  // A 300×300 scene: a sky-to-ground gradient with a "subject" disc. `shift` moves
  // the subject a little, like a second try of the same shot.
  func scene(sky: (CGFloat, CGFloat, CGFloat), ground: (CGFloat, CGFloat, CGFloat), subject: CGPoint, radius: CGFloat = 50, shift: CGFloat = 0) -> CGImage {
    let size = 300
    let context = CGContext(data: nil, width: size, height: size, bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    let colors = [CGColor(red: sky.0, green: sky.1, blue: sky.2, alpha: 1), CGColor(red: ground.0, green: ground.1, blue: ground.2, alpha: 1)] as CFArray
    context.drawLinearGradient(CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(), colors: colors, locations: [0, 1])!, start: CGPoint(x: 0, y: 300), end: .zero, options: [])
    context.setFillColor(CGColor(red: 0.9, green: 0.2, blue: 0.1, alpha: 1))
    context.fillEllipse(in: CGRect(x: subject.x + shift - radius, y: subject.y - radius, width: radius * 2, height: radius * 2))
    context.setFillColor(CGColor(red: 0.1, green: 0.1, blue: 0.1, alpha: 1))
    context.fill(CGRect(x: 40 + shift, y: 20, width: 60, height: 120))
    return context.makeImage()!
  }

  @Test func sessionsSplitWhenPhotosAreFarApartInTime() {
    let t = Date(timeIntervalSince1970: 1_000_000)
    let photos = [("a", 0.0), ("b", 20), ("c", 70), ("d", 500), ("e", 2000), ("f", 2030)].map {SimilarPhotos.Photo(id: $0.0, date: t.addingTimeInterval($0.1))}
    #expect(SimilarPhotos.sessions(photos.reversed()).map {$0.map(\.id)} == [["a", "b", "c"], ["e", "f"]])
  }

  @Test func retakesOfTheSameSceneGroupAndOtherScenesDoNot() throws {
    typealias RGB = (CGFloat, CGFloat, CGFloat)
    let beach: (RGB, RGB) = ((0.4, 0.7, 1.0), (0.9, 0.8, 0.5)), night: (RGB, RGB) = ((0.05, 0.05, 0.2), (0.1, 0.3, 0.1))
    let images = [
      ("beach-1", scene(sky: beach.0, ground: beach.1, subject: CGPoint(x: 180, y: 160))),
      ("beach-2", scene(sky: beach.0, ground: beach.1, subject: CGPoint(x: 180, y: 160), shift: 6)),
      ("night", scene(sky: night.0, ground: night.1, subject: CGPoint(x: 80, y: 230), radius: 25)),
    ]
    let prints = try images.map {(id: $0.0, print: try #require(SimilarPhotos.featurePrint($0.1, cpuOnly: true)))}
    let near = try #require(SimilarPhotos.distance(prints[0].print, prints[1].print))
    let far = try #require(SimilarPhotos.distance(prints[0].print, prints[2].print))
    #expect(near < SimilarPhotos.threshold, "retake distance \(near)")
    #expect(far > SimilarPhotos.threshold, "other scene distance \(far)")
    #expect(SimilarPhotos.groups(prints) == [["beach-1", "beach-2"]])
    #expect(SimilarPhotos.score(images[0].1, cpuOnly: true) != nil)
  }
}
