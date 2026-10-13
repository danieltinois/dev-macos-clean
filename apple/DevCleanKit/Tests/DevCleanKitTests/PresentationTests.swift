// What the app shows: labels, filters and selections, the disk panel and the tour.
import CoreGraphics
import Foundation
import Testing
@testable import DevCleanKit

@Suite struct PresentationTests {
  func finding(_ path: String, category: String = "node", name: String = "Cache", severity: Severity = .safe, allowed: Bool = true, review: Bool = false) -> Finding {
    var f = Finding(ruleId: "npm-cache", name: name, category: category, severity: severity, path: path, sizeBytes: 1)
    f.cleanupAllowed = allowed; f.cleanupReview = review; f.autoClean = false
    return f
  }

  var findings: [Finding] {[
    finding("/h/.npm/_cacache"),
    finding("/h/Library/Developer/Xcode/DerivedData", category: "xcode", name: "Derived Data"),
    finding("/h/.android/avd/a.avd", category: "android", severity: .review, review: true),
    finding("/h/Downloads", category: "downloads", severity: .review, allowed: false),
  ]}

  @Test func visibleAppliesFiltersAndKeepsReportIndices() {
    #expect(Selection.visible(findings, Filters()).map(\.index) == [0, 1, 2, 3])
    #expect(Selection.visible(findings, Filters(category: "xcode")).map(\.index) == [1])
    #expect(Selection.visible(findings, Filters(severity: "REVIEW")).map(\.index) == [2, 3])
    #expect(Selection.visible(findings, Filters(query: "derived")).map(\.index) == [1])
    #expect(Selection.visible(findings, Filters(query: ".ANDROID")).map(\.index) == [2])
  }

  @Test func onlyOnDeviceHidesWhatIsOnlyInICloud() {
    var cloud = finding("photos://a", category: "videos")
    cloud.metadata["on_device"] = "no"
    let list = [finding("photos://b", category: "videos"), cloud]
    #expect(Selection.visible(list, Filters()).map(\.index) == [0, 1])
    #expect(Selection.visible(list, Filters(onDeviceOnly: true)).map(\.index) == [0])
    #expect(!cloud.onDevice && list[0].onDevice && Filters(onDeviceOnly: true).isActive)
  }

  @Test func selectingAllOnlyPicksCleanableItemsInsideTheFilter() {
    #expect(Selection.pick(Selection.visible(findings, Filters()), {_ in true}) == [0, 2, 1])
    #expect(Selection.pick(Selection.visible(findings, Filters(category: "xcode")), {_ in true}) == [1])
    #expect(Selection.pick(Selection.visible(findings, Filters(severity: "REVIEW")), {_ in true}) == [2])
    #expect(Selection.pick(Selection.visible(findings, Filters(category: "downloads")), {_ in true}) == [])
  }

  @Test func pickSkipsItemsInsideAnAlreadyPickedFolder() {
    let nested = [finding("/h/Library/Caches/a/b"), finding("/h/Library/Caches/a"), finding("/h/Library/Caches/ab")]
    #expect(Selection.pick(Selection.visible(nested, Filters()), {_ in true}) == [1, 2])
  }

  @Test func formatsBytesAndAgesInPortuguese() {
    #expect(Labels.bytes(0) == "0 B")
    #expect(Labels.bytes(512) == "512 B")
    #expect(Labels.bytes(1024) == "1 KB")
    #expect(Labels.bytes(Int(2.46 * 1024 * 1024 * 1024)) == "2,5 GB")
    #expect([nil, 0, 5, 45, 400, 730].map(Labels.ago) == ["", "hoje", "há 5 dia(s)", "há 1 mês(es)", "há 1,1 ano(s)", "há 2 ano(s)"])
    #expect(Labels.category("xcode") == "Xcode" && Labels.category("new-thing") == "new-thing")
    #expect(barBlocks(0, of: 10, width: 30) == 0 && barBlocks(1, of: 1000, width: 30) == 1 && barBlocks(5, of: 10, width: 30) == 15 && barBlocks(9, of: 0, width: 30) == 0)
  }

  @Test func diskSplitsIntoOtherFoundPurgeableAndFree() {
    let gb = 1024 * 1024 * 1024
    let parts = DiskParts(Storage(totalBytes: 500 * gb, freeBytes: 100 * gb, purgeableBytes: 50 * gb), found: 30 * gb)
    #expect([parts.other, parts.found, parts.free, parts.freeAfter] as [Int] == [320 * gb, 30 * gb, 100 * gb, 130 * gb] && parts.purgeable == 50 * gb)
    let unknown = DiskParts(Storage(totalBytes: 100, freeBytes: 40, purgeableBytes: nil), found: 10)
    #expect([unknown.other, unknown.found, unknown.freeAfter] as [Int] == [50, 10, 50] && unknown.purgeable == nil)
    let capped = DiskParts(Storage(totalBytes: 100, freeBytes: 90, purgeableBytes: 0), found: 500)
    #expect([capped.other, capped.found, capped.freeAfter] as [Int] == [0, 10, 100])
  }

  @Test func toursOpenCenteredCloseDoneAndFitTheBubble() {
    for platform in [Platform.mac, .ios] {
      let steps = Tour.steps(for: platform)
      #expect(steps.first?.targets == [] && steps.last?.mood == .done)
      for step in steps {
        for scanned in [false, true] {
          let text = step.text(scanned: scanned)
          #expect(text.count > 20 && text.count <= 190, "\(text)")
        }
      }
      #expect(steps.last!.text(scanned: false).contains("começo a análise") && !steps.last!.text(scanned: true).contains("começo a análise"))
    }
  }

  @Test func theIPhoneTourTalksAboutTheIPhone() {
    let steps = Tour.steps(for: .ios), text = steps.map {$0.text(scanned: true)}.joined(separator: " ")
    #expect(!steps.contains {$0.targets.contains(.auto)} && steps.contains {$0.targets.contains(.addFolder)})
    #expect(!Platform.ios.automatic && !Platform.ios.staleProjects && Platform.mac.automatic && Platform.mac.staleProjects)
    #expect(text.contains("iPhone") && !text.contains("Mac") && !text.contains("Finder") && !text.contains("Lixeira"))
    #expect(Tour.steps(for: .mac).contains {$0.targets.contains(.auto)})
  }

  @Test func theGuideStaysOnScreenAndOffTheTarget() {
    let view = CGSize(width: 1280, height: 850), guide = CGSize(width: 560, height: 230)
    let targets = [
      CGRect(x: 40, y: 300, width: 400, height: 500), CGRect(x: 700, y: 300, width: 540, height: 400), CGRect(x: 40, y: 40, width: 1200, height: 120),
      CGRect(x: 40, y: 690, width: 1200, height: 140), CGRect(x: 1150, y: 160, width: 90, height: 40),
    ]
    for target in targets {
      let placed = Tour.place(target, guide: guide, in: view), box = CGRect(origin: placed.origin, size: guide)
      #expect(box.minX >= 12 && box.minY >= 12 && box.maxX <= view.width - 12 && box.maxY <= view.height - 12)
      #expect(!box.intersects(target), "covers \(target) (\(placed.side))")
    }
    #expect(Tour.place(targets[0], guide: guide, in: view).side == .right)
    #expect(Tour.place(targets[1], guide: guide, in: view).side == .left)
    #expect(Tour.place(nil, guide: guide, in: view).origin == CGPoint(x: 360, y: 310))
  }
}
