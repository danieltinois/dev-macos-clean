// Folders the user picked in the Files app, the iPhone app's way to look beyond
// the photo library. iOS only hands the app security-scoped URLs; they are kept
// as bookmarks so later launches can read them again, and listed for the engine
// as core/host.ts FileItem. Nothing here deletes anything.
// iOS only: the Mac app scans the disk directly.
#if os(iOS)
import CryptoKit
import Foundation

public struct PickedFolder: Sendable {
  public let url: URL
  // Canonical path; picked files must be inside it.
  public let root: String
  public let label: String
}

public enum PickedFolders {
  private static let key = "devclean.folders"
  private static let maxItems = 200_000

  // The saved folders, with access open for the rest of the app's life.
  // Folders that can't be resolved anymore (deleted, moved off the device) are dropped.
  public static func load() -> [PickedFolder] {
    var folders: [PickedFolder] = [], kept: [Data] = []
    for data in saved() {
      var stale = false
      guard let url = try? URL(resolvingBookmarkData: data, bookmarkDataIsStale: &stale), url.startAccessingSecurityScopedResource(),
            let folder = folder(url) else {continue}
      folders.append(folder)
      kept.append(stale ? (try? url.bookmarkData()) ?? data : data)
    }
    UserDefaults.standard.set(kept, forKey: key)
    return folders
  }

  // Remember a folder from the document picker. Picking one already saved is a no-op.
  public static func add(_ url: URL) throws -> [PickedFolder] {
    guard url.startAccessingSecurityScopedResource() else {throw Cleanup.Failure("O iOS não liberou esta pasta.")}
    let current = load()
    guard let picked = folder(url) else {throw Cleanup.Failure("Pasta indisponível.")}
    if current.contains(where: {$0.root == picked.root}) {return current}
    UserDefaults.standard.set(saved() + [try url.bookmarkData()], forKey: key)
    return current + [picked]
  }

  public static func remove(at index: Int) throws -> [PickedFolder] {
    var list = saved()
    guard list.indices.contains(index) else {throw Cleanup.Failure("Pasta inválida.")}
    list.remove(at: index)
    UserDefaults.standard.set(list, forKey: key)
    return load()
  }

  // Regular files in `folders` (no symlinks, hidden files or package contents).
  // `progress` gets status lines (pt-BR) while big folders are walked.
  public static func items(in folders: [PickedFolder], progress: @Sendable (String) -> Void = {_ in}) -> [[String: Any]] {
    let keys: [URLResourceKey] = [.isRegularFileKey, .isSymbolicLinkKey, .fileSizeKey, .contentModificationDateKey, .isUbiquitousItemKey, .ubiquitousItemDownloadingStatusKey]
    var list: [[String: Any]] = [], seen = Set<String>()
    walking: for folder in folders {
      guard let walk = FileManager.default.enumerator(at: folder.url, includingPropertiesForKeys: keys, options: [.skipsHiddenFiles, .skipsPackageDescendants], errorHandler: {_, _ in true}) else {continue}
      let depth = folder.url.pathComponents.count
      // One autorelease pool per file, so walking a big folder stays within memory limits.
      while let next = autoreleasepool(invoking: {walk.nextObject()}) {
        if list.count >= maxItems {break walking}
        if list.count % 500 == 0 {progress("Lendo pastas do Arquivos… \(list.count) arquivos")}
        autoreleasepool {
          guard let url = next as? URL, let values = try? url.resourceValues(forKeys: Set(keys)), values.isRegularFile == true, values.isSymbolicLink != true,
                let path = NativeHost.realpath(url.path), seen.insert(path).inserted else {return}
          let cloud = values.isUbiquitousItem
          let status = values.ubiquitousItemDownloadingStatus
          // Outside iCloud Drive the file is always here; inside, it is unless not downloaded.
          let local: Any = if cloud != true {true} else if let status {status != .notDownloaded} else {NSNull()}
          list.append([
            "path": path,
            "label": ([folder.label] + url.pathComponents.dropFirst(depth)).joined(separator: " › "),
            "bytes": Double(values.fileSize ?? 0),
            "modified_ms": (values.contentModificationDate ?? .distantPast).timeIntervalSince1970 * 1000,
            "local": local,
            "cloud": cloud.map {$0 as Any} ?? NSNull(),
          ])
        }
      }
    }
    hashSameSizes(&list, progress: progress)
    return list
  }

  // Files of the same size might hold the same content: hash them (from 100 KB,
  // only what is on the device), so duplicates are judged by content, not name.
  private static func hashSameSizes(_ list: inout [[String: Any]], progress: @Sendable (String) -> Void) {
    var bySize: [Double: [Int]] = [:]
    for (index, item) in list.enumerated() {
      guard let bytes = item["bytes"] as? Double, bytes >= 100_000, item["local"] as? Bool == true else {continue}
      bySize[bytes, default: []].append(index)
    }
    let candidates = bySize.values.filter {$0.count > 1}.flatMap {$0}
    for (done, index) in candidates.enumerated() {
      if done % 20 == 0 {progress("Conferindo arquivos duplicados… \(done) de \(candidates.count)")}
      list[index]["digest"] = autoreleasepool {(list[index]["path"] as? String).flatMap(digest)} ?? NSNull()
    }
  }

  // SHA-256 of a file, read in 1 MB chunks; nil when it can't be read.
  private static func digest(_ path: String) -> String? {
    guard let handle = FileHandle(forReadingAtPath: path) else {return nil}
    defer {try? handle.close()}
    var sha = SHA256()
    while true {
      let read: Bool? = autoreleasepool {
        guard let chunk = try? handle.read(upToCount: 1 << 20) else {return nil}
        if chunk.isEmpty {return false}
        sha.update(data: chunk)
        return true
      }
      guard let more = read else {return nil}
      if !more {break}
    }
    return sha.finalize().map {String(format: "%02x", $0)}.joined()
  }

  private static func saved() -> [Data] {UserDefaults.standard.array(forKey: key) as? [Data] ?? []}

  private static func folder(_ url: URL) -> PickedFolder? {
    guard let root = NativeHost.realpath(url.path) else {return nil}
    let name = (try? url.resourceValues(forKeys: [.localizedNameKey]).localizedName) ?? url.lastPathComponent
    return PickedFolder(url: url, root: root, label: name)
  }
}
#endif
