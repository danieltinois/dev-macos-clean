// Photos that look alike, for the iPhone's "Fotos parecidas". Vision feature
// prints of small thumbnails are compared only within a session (photos taken in
// a row) and only with their next few neighbors, which keeps it fast and stops
// unrelated pictures from chaining together. Vision's aesthetics score then lets
// the engine keep the best of each group. No Photos dependency, so it runs (and
// is tested) on the Mac too.
import CoreGraphics
import CoreML
import Foundation
import Vision

public enum SimilarPhotos {
  // Each photo of a session was taken at most this long after the previous one.
  public static let window: TimeInterval = 60
  // Each photo is compared with this many photos taken right after it.
  public static let neighbors = 8
  // Feature print distance (revision 2, unit vectors) below which two photos look alike.
  public static let threshold: Float = 0.4

  public struct Photo: Sendable, Equatable {
    public let id: String
    public let date: Date
    public init(id: String, date: Date) {self.id = id; self.date = date}
  }

  // Runs of 2+ photos, in date order, each taken within `window` of the previous one.
  public static func sessions(_ photos: [Photo]) -> [[Photo]] {
    var runs: [[Photo]] = [], current: [Photo] = []
    for photo in photos.sorted(by: {$0.date < $1.date}) {
      if let last = current.last, photo.date.timeIntervalSince(last.date) > window {
        if current.count > 1 {runs.append(current)}
        current = []
      }
      current.append(photo)
    }
    if current.count > 1 {runs.append(current)}
    return runs
  }

  // `cpuOnly` keeps Vision off the GPU and Neural Engine (the Mac tests use it).
  public static func featurePrint(_ image: CGImage, cpuOnly: Bool = false) -> VNFeaturePrintObservation? {
    let request = VNGenerateImageFeaturePrintRequest()
    request.revision = VNGenerateImageFeaturePrintRequestRevision2
    return run(request, on: image, cpuOnly: cpuOnly) as? VNFeaturePrintObservation
  }

  // Vision's overall aesthetics score: higher is a better photo.
  public static func score(_ image: CGImage, cpuOnly: Bool = false) -> Double? {
    (run(VNCalculateImageAestheticsScoresRequest(), on: image, cpuOnly: cpuOnly) as? VNImageAestheticsScoresObservation).map {Double($0.overallScore)}
  }

  private static func run(_ request: VNImageBasedRequest, on image: CGImage, cpuOnly: Bool) -> VNObservation? {
    if cpuOnly, let stages = try? request.supportedComputeStageDevices {
      for (stage, devices) in stages {
        if let cpu = devices.first(where: {if case .cpu = $0 {true} else {false}}) {request.setComputeDevice(cpu, for: stage)}
      }
    }
    try? VNImageRequestHandler(cgImage: image).perform([request])
    return request.results?.first
  }

  public static func distance(_ a: VNFeaturePrintObservation, _ b: VNFeaturePrintObservation) -> Float? {
    var distance: Float = 0
    return (try? a.computeDistance(&distance, to: b)) == nil ? nil : distance
  }

  // Groups of 2+ ids among `prints` (one session, in date order) that look alike,
  // linked through neighbors within `threshold`.
  public static func groups(_ prints: [(id: String, print: VNFeaturePrintObservation)]) -> [[String]] {
    var parent = Array(prints.indices)
    func root(_ i: Int) -> Int {
      var i = i
      while parent[i] != i {parent[i] = parent[parent[i]]; i = parent[i]}
      return i
    }
    for i in prints.indices {
      for j in (i + 1)..<min(prints.count, i + 1 + neighbors) {
        if let d = distance(prints[i].print, prints[j].print), d < threshold {parent[root(j)] = root(i)}
      }
    }
    var byRoot: [Int: [String]] = [:]
    for i in prints.indices {byRoot[root(i), default: []].append(prints[i].id)}
    return byRoot.values.filter {$0.count > 1}.sorted {$0[0] < $1[0]}
  }
}
