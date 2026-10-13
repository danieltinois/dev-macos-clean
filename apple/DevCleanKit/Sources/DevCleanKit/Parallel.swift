// Runs a loop on every core. The iPhone's slow scan steps (reading each photo,
// Vision on thumbnails, hashing) are independent per item, so this cuts their time
// by about the number of cores.
import Foundation

public enum Parallel {
  // `body` for 0..<count, in parallel, results in order. Each call gets its own
  // autorelease pool (PhotoKit and Vision hand out autoreleased objects), and
  // `progress` hears how many are done every `every` items.
  public static func map<T>(_ count: Int, every: Int = 50, progress: (Int) -> Void = {_ in}, _ body: (Int) -> T) -> [T] {
    guard count > 0 else {return []}
    return withoutActuallyEscaping(body) {body in
      withoutActuallyEscaping(progress) {progress in
        let run = Run(count: count, every: every, body: body, progress: progress)
        DispatchQueue.concurrentPerform(iterations: count) {run.step($0)}
        return run.results.map {$0!}
      }
    }
  }

  // The loop's shared state. Each index writes only its own slot and the counter
  // sits behind a lock, so sharing it across threads is safe.
  private final class Run<T>: @unchecked Sendable {
    var results: [T?]
    private let every: Int
    private let body: (Int) -> T
    private let progress: (Int) -> Void
    private let lock = NSLock()
    private var done = 0

    init(count: Int, every: Int, body: @escaping (Int) -> T, progress: @escaping (Int) -> Void) {
      results = Array(repeating: nil, count: count)
      self.every = every; self.body = body; self.progress = progress
    }

    func step(_ index: Int) {
      let value = autoreleasepool {body(index)}
      let finished: Int = lock.withLock {
        results[index] = value
        done += 1
        return done
      }
      if finished % every == 0 {progress(finished)}
    }
  }
}
