// The photo library side of the iPhone app: lists items for the engine
// (core/host.ts PhotoAsset), captures their identity and deletes them.
// Deleting goes through PhotoKit, so the system asks for confirmation and the
// items go to Recently Deleted for 30 days. Nothing here deletes files directly.
// iOS only, so the Mac app doesn't link Photos.
#if os(iOS)
import Foundation
import Photos

public enum PhotoLibrary {
  public static let prefix = "photos://"

  public struct Canceled: Error {}

  // Asks once; afterwards returns the stored answer.
  public static func requestAccess() async -> PHAuthorizationStatus {
    await PHPhotoLibrary.requestAuthorization(for: .readWrite)
  }

  public static var hasLimitedAccess: Bool {PHPhotoLibrary.authorizationStatus(for: .readWrite) == .limited}

  // Every visible item (hidden ones stay out) as the engine's PhotoAsset.
  @Sendable public static func assets() throws -> [[String: Any]] {
    let status = PHPhotoLibrary.authorizationStatus(for: .readWrite)
    guard status == .authorized || status == .limited else {
      throw EngineError(message: "Sem acesso às Fotos. Permita em Ajustes › DevClean › Fotos.")
    }
    let options = PHFetchOptions()
    options.includeAllBurstAssets = true
    var assets: [PHAsset] = []
    PHAsset.fetchAssets(with: options).enumerateObjects {asset, _, _ in assets.append(asset)}
    let cloud = inCloud(assets.map(\.localIdentifier))
    return assets.map {describe($0, cloud: cloud)}
  }

  // Items in iCloud Photos: those with a cloud identifier. nil when it can't tell.
  private static func inCloud(_ ids: [String]) -> Set<String>? {
    guard !ids.isEmpty else {return []}
    var synced = Set<String>()
    for (id, result) in PHPhotoLibrary.shared().cloudIdentifierMappings(forLocalIdentifiers: ids) {
      switch result {
      case .success: synced.insert(id)
      case .failure(let error as PHPhotosError) where error.code == .identifierNotFound: continue
      case .failure: return nil
      }
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
    return "\(asset.localIdentifier):\(asset.modificationDate?.timeIntervalSince1970 ?? 0)"
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
