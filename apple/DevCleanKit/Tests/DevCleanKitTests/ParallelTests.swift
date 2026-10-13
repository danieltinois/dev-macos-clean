// The parallel loop keeps results in order and reports progress.
import Foundation
import Testing
@testable import DevCleanKit

@Suite struct ParallelTests {
  @Test func mapsInOrderOnEveryCore() {
    let seen = Counter()
    let squares = Parallel.map(1000, every: 100, progress: {seen.add($0)}) {$0 * $0}
    #expect(squares == (0..<1000).map {$0 * $0})
    #expect(seen.values.sorted() == Array(stride(from: 100, through: 1000, by: 100)))
    #expect(Parallel.map(0) {$0}.isEmpty)
  }

  private final class Counter: @unchecked Sendable {
    private let lock = NSLock()
    private var list: [Int] = []
    func add(_ value: Int) {lock.withLock {list.append(value)}}
    var values: [Int] {lock.withLock {list}}
  }
}
