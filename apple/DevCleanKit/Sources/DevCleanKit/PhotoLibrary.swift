// The photo library side of the iPhone app: lists items for the engine
// (core/host.ts PhotoAsset), captures their identity and deletes them.
// Deleting goes through PhotoKit, so the system asks for confirmation and the
// items go to Recently Deleted for 30 days. Nothing here deletes files directly.
// iOS only, so the Mac app doesn't link Photos.
#if os(iOS)
import AVFoundation
import Foundation
import Photos
import UIKit
import UniformTypeIdentifiers
import Vision

public enum PhotoLibrary {
  public static let prefix = "photos://"

  public struct Canceled: Error {}

  // Asks once; afterwards returns the stored answer.
  public static func requestAccess() async -> PHAuthorizationStatus {
    await PHPhotoLibrary.requestAuthorization(for: .readWrite)
  }

  public static var hasLimitedAccess: Bool {PHPhotoLibrary.authorizationStatus(for: .readWrite) == .limited}

  // Every visible item (hidden ones stay out) as the engine's PhotoAsset.
  // Comparing similar photos can take a while; `progress` gets status lines (pt-BR).
  public static func assets(progress: @Sendable (String) -> Void = {_ in}) throws -> [[String: Any]] {
    let status = PHPhotoLibrary.authorizationStatus(for: .readWrite)
    guard status == .authorized || status == .limited else {
      throw EngineError(message: "Sem acesso às Fotos. Permita em Ajustes › DevClean › Fotos.")
    }
    let options = PHFetchOptions()
    options.includeAllBurstAssets = true
    var assets: [PHAsset] = []
    PHAsset.fetchAssets(with: options).enumerateObjects {asset, _, _ in assets.append(asset)}
    let cloud = inCloud(assets.map(\.localIdentifier))
    let similar = similarGroups(assets, progress: progress)
    // PhotoKit hands out autoreleased objects; draining them per item keeps large
    // libraries within an iPhone's memory limit (the system kills the app otherwise).
    // Reading each item's files is slow on older iPhones, so it reports progress too.
    return assets.enumerated().map {index, asset in
      if index % 200 == 0 {progress("Medindo fotos e vídeos… \(index) de \(assets.count)")}
      return autoreleasepool {
        var item = describe(asset, cloud: cloud)
        item["favorite"] = asset.isFavorite
        item["similar"] = similar[asset.localIdentifier]?.group ?? NSNull()
        item["score"] = similar[asset.localIdentifier]?.score ?? NSNull()
        return item
      }
    }
  }

  // Camera photos taken in a row (no screenshots, no bursts: those have their own
  // rules) that look alike, with each member's score. See SimilarPhotos.
  private static func similarGroups(_ assets: [PHAsset], progress: @Sendable (String) -> Void) -> [String: (group: String, score: Any)] {
    let photos = assets.filter {$0.mediaType == .image && !$0.mediaSubtypes.contains(.photoScreenshot) && $0.burstIdentifier == nil && $0.creationDate != nil}
    let byId = Dictionary(photos.map {($0.localIdentifier, $0)}, uniquingKeysWith: {a, _ in a})
    let sessions = SimilarPhotos.sessions(photos.map {SimilarPhotos.Photo(id: $0.localIdentifier, date: $0.creationDate!)})
    let total = sessions.reduce(0) {$0 + $1.count}
    var result: [String: (group: String, score: Any)] = [:], done = 0
    for session in sessions {
      var prints: [(id: String, print: VNFeaturePrintObservation)] = []
      for photo in session {
        if done % 20 == 0 {progress("Comparando fotos parecidas… \(done) de \(total)")}
        done += 1
        if let asset = byId[photo.id], let print = autoreleasepool(invoking: {analysis(asset).print}) {prints.append((photo.id, print))}
      }
      for group in SimilarPhotos.groups(prints) {
        for id in group {result[id] = (group[0], autoreleasepool {byId[id].flatMap {analysis($0, scored: true).score}} ?? NSNull())}
      }
    }
    return result
  }

  // Feature print and score of one photo, kept per app session (keyed by id and
  // edit date) so a new scan after picking a folder doesn't redo the work.
  private static func analysis(_ asset: PHAsset, scored: Bool = false) -> (print: VNFeaturePrintObservation?, score: Double?) {
    let key = "\(asset.localIdentifier)@\(asset.modificationDate?.timeIntervalSince1970 ?? 0)"
    let cached = cache.get(key)
    if let cached, !scored || cached.score != nil {return cached}
    guard let image = thumbnail(asset) else {return (nil, nil)}
    let entry = (print: cached?.print ?? SimilarPhotos.featurePrint(image), score: scored ? SimilarPhotos.score(image) : nil)
    cache.set(key, entry)
    return entry
  }

  // A small local thumbnail; nothing is downloaded from iCloud.
  private static func thumbnail(_ asset: PHAsset) -> CGImage? {
    let options = PHImageRequestOptions()
    options.isSynchronous = true
    options.deliveryMode = .highQualityFormat
    options.resizeMode = .fast
    options.isNetworkAccessAllowed = false
    let box = ImageBox()
    PHImageManager.default().requestImage(for: asset, targetSize: CGSize(width: 256, height: 256), contentMode: .aspectFit, options: options) {image, _ in box.image = image?.cgImage}
    return box.image
  }

  private final class ImageBox: @unchecked Sendable {var image: CGImage?}

  private final class Cache: @unchecked Sendable {
    private var entries: [String: (print: VNFeaturePrintObservation?, score: Double?)] = [:]
    private let lock = NSLock()
    func get(_ key: String) -> (print: VNFeaturePrintObservation?, score: Double?)? {lock.withLock {entries[key]}}
    func set(_ key: String, _ value: (print: VNFeaturePrintObservation?, score: Double?)) {lock.withLock {entries[key] = value}}
  }
  private static let cache = Cache()

  // Items in iCloud Photos: those with a cloud identifier. nil when it can't tell.
  // Asked in batches, so a large library never builds one huge answer.
  private static func inCloud(_ ids: [String]) -> Set<String>? {
    var synced = Set<String>()
    for start in stride(from: 0, to: ids.count, by: 500) {
      let failed: Bool = autoreleasepool {
        for (id, result) in PHPhotoLibrary.shared().cloudIdentifierMappings(forLocalIdentifiers: Array(ids[start..<min(start + 500, ids.count)])) {
          switch result {
          case .success: synced.insert(id)
          case .failure(let error as PHPhotosError) where error.code == .identifierNotFound: continue
          case .failure: return true
          }
        }
        return false
      }
      if failed {return nil}
    }
    return synced
  }

  private static func describe(_ asset: PHAsset, cloud: Set<String>?) -> [String: Any] {
    let resources = PHAssetResource.assetResources(for: asset)
    let main = resources.first {[.photo, .video, .fullSizePhoto, .fullSizeVideo].contains($0.type)} ?? resources.first
    // PhotoKit has no public size or location API; `fileSize` and `locallyAvailable`
    // are what cleaners use. Checked first, so a missing key is unknown, not a crash.
    let sizes = resources.map {value($0, "fileSize") as? Int64}
    let bytes: Any = sizes.isEmpty || sizes.contains(where: {$0 == nil}) ? NSNull() : Double(sizes.reduce(0) {$0 + ($1 ?? 0)})
    let local: Any = main.flatMap {value($0, "locallyAvailable") as? Bool} ?? NSNull()
    var subtypes: [String] = []
    if asset.mediaSubtypes.contains(.photoScreenshot) {subtypes.append("screenshot")}
    if asset.mediaSubtypes.contains(.videoScreenRecording) {subtypes.append("screen-recording")}
    let picked = asset.representsBurst || !asset.burstSelectionTypes.isDisjoint(with: [.autoPick, .userPick])
    return [
      "id": asset.localIdentifier,
      "name": main?.originalFilename ?? "Sem nome",
      "media": asset.mediaType == .image ? "image" : asset.mediaType == .video ? "video" : "other",
      "subtypes": subtypes,
      "burst": asset.burstIdentifier == nil ? "none" : picked ? "key" : "extra",
      "bytes": bytes,
      "created_ms": (asset.creationDate ?? .distantPast).timeIntervalSince1970 * 1000,
      "local": local,
      "cloud": cloud.map {$0.contains(asset.localIdentifier) as Any} ?? NSNull(),
      "width": asset.pixelWidth,
      "height": asset.pixelHeight,
      "duration_ms": (asset.duration * 1000).rounded(),
    ]
  }

  private static func value(_ resource: PHAssetResource, _ key: String) -> Any? {
    resource.responds(to: NSSelectorFromString(key)) ? resource.value(forKey: key) : nil
  }

  // The identity Cleanup checks before deleting: the item still exists, unchanged.
  @Sendable public static func identity(_ path: String) throws -> String {
    guard path.hasPrefix(prefix), let asset = PHAsset.fetchAssets(withLocalIdentifiers: [String(path.dropFirst(prefix.count))], options: nil).firstObject else {
      throw Cleanup.Failure("A foto não existe mais. Analise novamente.")
    }
    return identityString(asset)
  }

  // Identities of many items with one fetch per 500, for Cleanup.prepare right
  // after a scan. Missing items are left out. Cleanup still checks each item
  // again, one by one, right before deleting it.
  public static func identities(_ paths: [String]) -> [String: String] {
    let ids = paths.compactMap {$0.hasPrefix(prefix) ? String($0.dropFirst(prefix.count)) : nil}
    var result: [String: String] = [:]
    for start in stride(from: 0, to: ids.count, by: 500) {
      autoreleasepool {
        PHAsset.fetchAssets(withLocalIdentifiers: Array(ids[start..<min(start + 500, ids.count)]), options: nil).enumerateObjects {asset, _, _ in
          result[prefix + asset.localIdentifier] = identityString(asset)
        }
      }
    }
    return result
  }

  private static func identityString(_ asset: PHAsset) -> String {"\(asset.localIdentifier):\(asset.modificationDate?.timeIntervalSince1970 ?? 0)"}

  // A local file to preview the item with, downloading it from iCloud if needed.
  // Videos come as the library's own file; photos are copied to a temporary file
  // (`temporary`), which the caller removes after the preview.
  public static func previewFile(_ path: String) async throws -> (url: URL, temporary: Bool) {
    guard path.hasPrefix(prefix), let asset = PHAsset.fetchAssets(withLocalIdentifiers: [String(path.dropFirst(prefix.count))], options: nil).firstObject else {
      throw Cleanup.Failure("A foto não existe mais. Analise novamente.")
    }
    if asset.mediaType == .video {
      let options = PHVideoRequestOptions()
      options.isNetworkAccessAllowed = true
      options.version = .original
      let url: URL? = await withCheckedContinuation {continuation in
        PHImageManager.default().requestAVAsset(forVideo: asset, options: options) {video, _, _ in continuation.resume(returning: (video as? AVURLAsset)?.url)}
      }
      guard let url else {throw Cleanup.Failure("Não consegui abrir este vídeo.")}
      return (url, false)
    }
    let options = PHImageRequestOptions()
    options.isNetworkAccessAllowed = true
    options.deliveryMode = .highQualityFormat
    options.version = .current
    let (data, type): (Data?, String?) = await withCheckedContinuation {continuation in
      PHImageManager.default().requestImageDataAndOrientation(for: asset, options: options) {data, type, _, _ in continuation.resume(returning: (data, type))}
    }
    guard let data else {throw Cleanup.Failure("Não consegui abrir esta foto.")}
    let ext = type.flatMap {UTType($0)?.preferredFilenameExtension} ?? "jpg"
    let url = FileManager.default.temporaryDirectory.appendingPathComponent("devclean-preview-\(UUID().uuidString).\(ext)")
    try data.write(to: url)
    return (url, true)
  }

  // Moves the items to Recently Deleted. The system shows its own confirmation;
  // declining it throws Canceled.
  public static func delete(_ paths: [String]) async throws {
    let ids = paths.compactMap {$0.hasPrefix(prefix) ? String($0.dropFirst(prefix.count)) : nil}
    guard ids.count == paths.count, !ids.isEmpty else {throw Cleanup.Failure("Item não autorizado para limpeza.")}
    do {
      try await PHPhotoLibrary.shared().performChanges {
        PHAssetChangeRequest.deleteAssets(PHAsset.fetchAssets(withLocalIdentifiers: ids, options: nil))
      }
    } catch let error as PHPhotosError where error.code == .userCancelled {
      throw Canceled()
    }
  }
}
#endif
