// ASCII art and its motion, like the web UI's motion.ts: block bars that grow,
// numbers that count up, the logo typed in column by column, the scanning sweep
// and the braille spinner. The art itself (logo, spinner, Floco) is drawn by the
// TypeScript engine (core/ascii.ts, core/cat.ts), the same code as the CLI.
// Everything snaps to its final state when the system asks to reduce motion.
import DevCleanKit
import SwiftUI

// The engine instance that draws the art, on the main thread (JavaScriptCore
// contexts are not thread-safe). Loaded once; frames are cheap.
@MainActor
enum Art {
  private static let engine = try? Engine.bundled()
  static let banner = (try? engine?.banner()) ?? "DEVCLEAN"
  static let spinner = (try? engine?.spinner()).flatMap {$0.isEmpty ? nil : $0} ?? ["·"]
  static func cat(_ mood: String, _ pose: CatPose, bust: Bool = false) -> String {(try? engine?.cat(mood, pose, bust: bust)) ?? ""}
}

private func easeOut(_ t: Double) -> Double {1 - pow(1 - t, 3)}

// Width of one character of the monospaced font at `size`.
enum Mono {
  static func advance(_ size: CGFloat) -> CGFloat {
#if os(macOS)
    let font = NSFont.monospacedSystemFont(ofSize: size, weight: .regular)
#else
    let font = UIFont.monospacedSystemFont(ofSize: size, weight: .regular)
#endif
    return ("M" as NSString).size(withAttributes: [.font: font]).width
  }
}

// Multi-line ASCII art with an exact line height (CSS `font: 7.6px/1`), drawn in one pass.
struct AsciiArt: View {
  let text: String
  var size: CGFloat
  var lineHeight: CGFloat = 1
  var color: Color = Color(hex: 0xe4e7eb)

  var body: some View {
    let lines = text.split(separator: "\n", omittingEmptySubsequences: false)
    let columns = lines.map(\.count).max() ?? 0, step = size * lineHeight
    Canvas {context, _ in
      for (row, line) in lines.enumerated() where !line.isEmpty {
        let resolved = context.resolve(Text(String(line)).font(Theme.mono(size)).foregroundStyle(color))
        // Center each glyph row in its line box, like CSS line-height does.
        context.draw(resolved, at: CGPoint(x: 0, y: CGFloat(row) * step + step / 2), anchor: .leading)
      }
    }
    .frame(width: CGFloat(columns) * Mono.advance(size), height: CGFloat(lines.count) * step)
    .accessibilityHidden(true)
  }
}

// A row of blocks: colored segments, then empty blocks up to `width` (`██████░░░░`).
// It grows from empty to its blocks every time they change, like growBar/growStack.
struct BlockBar: View {
  let segments: [(blocks: Int, color: Color)]
  var width = 30
  var size: CGFloat = 10
  var duration = 0.65
  var delay = 0.0
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @State private var start = Date.distantPast

  var body: some View {
    let key = segments.map {"\($0.blocks)"}.joined(separator: ",")
    TimelineView(.animation(minimumInterval: 1 / 60, paused: reduceMotion || Date().timeIntervalSince(start) > duration + delay)) {timeline in
      let t = reduceMotion ? 1 : easeOut(min(max((timeline.date.timeIntervalSince(start) - delay) / duration, 0), 1))
      Text(attributed(progress: t))
        .font(Theme.mono(size)).tracking(-0.5).lineLimit(1).fixedSize()
    }
    .onChange(of: key, initial: true) {start = Date()}
    .accessibilityHidden(true)
  }

  private func attributed(progress: Double) -> AttributedString {
    let total = min(width, segments.reduce(0) {$0 + $1.blocks})
    var left = Int((Double(total) * progress).rounded()), result = AttributedString()
    for segment in segments {
      let take = min(segment.blocks, left)
      left -= take
      var run = AttributedString(String(repeating: "█", count: take))
      run.foregroundColor = segment.color
      result += run
    }
    let shown = Int((Double(total) * progress).rounded())
    var empty = AttributedString(String(repeating: "░", count: max(0, width - shown)))
    empty.foregroundColor = Theme.barEmpty
    return result + empty
  }
}

// A number shown through `format` that tweens from the last value shown (900 ms).
struct CountUp: View {
  let value: Int
  let format: (Int) -> String
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @State private var from = 0
  @State private var to = 0
  @State private var start = Date.distantPast

  var body: some View {
    TimelineView(.animation(minimumInterval: 1 / 60, paused: reduceMotion || Date().timeIntervalSince(start) > 0.9)) {timeline in
      let t = reduceMotion ? 1 : easeOut(min(max(timeline.date.timeIntervalSince(start) / 0.9, 0), 1))
      Text(format(from + Int((Double(to - from) * t).rounded())))
    }
    .onChange(of: value, initial: true) {old, new in
      from = start == .distantPast ? 0 : to
      to = new; start = Date()
    }
  }
}

// The DEVCLEAN banner, revealed column by column like a terminal printing it.
struct TypedLogo: View {
  var size: CGFloat
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @State private var start = Date()

  var body: some View {
    let lines = Art.banner.split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
    let width = lines.map(\.count).max() ?? 0
    TimelineView(.animation(minimumInterval: 1 / 60, paused: reduceMotion || Date().timeIntervalSince(start) > 0.85)) {timeline in
      let t = reduceMotion ? 1 : easeOut(min(max((timeline.date.timeIntervalSince(start) - 0.12) / 0.7, 0), 1))
      let cols = Int((Double(width) * t).rounded())
      AsciiArt(text: lines.map {String($0.prefix(cols)) + (cols < width ? "▌" : "")}.joined(separator: "\n"), size: size, lineHeight: 1.15, color: Theme.accent)
        .frame(width: CGFloat(width + 1) * Mono.advance(size), alignment: .leading)
    }
    .shadow(color: Theme.accent.opacity(0.2), radius: 6)
  }
}

// Indeterminate "scanning" rows: a ░▒▓█ wave sweeping across each line.
struct Sweep: View {
  var rows = 6, width = 30
  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  var body: some View {
    TimelineView(.periodic(from: .now, by: 0.045)) {timeline in
      let frame = reduceMotion ? 0 : Int(timeline.date.timeIntervalSinceReferenceDate / 0.045)
      AsciiArt(text: (0..<rows).map {line(frame, row: $0)}.joined(separator: "\n"), size: 11, lineHeight: 1.5, color: Color(hex: 0x4c6340))
    }
  }

  private func line(_ frame: Int, row: Int) -> String {
    let wave = Array("▒▓██▓▒")
    var cells = Array(repeating: Character("░"), count: width)
    let head = (frame + row * 5) % (width + wave.count) - wave.count
    for (i, char) in wave.enumerated() where head + i >= 0 && head + i < width {cells[head + i] = char}
    return String(cells)
  }
}

// The braille spinner frame for now (80 ms per frame); still under reduced motion.
struct Spinning<Content: View>: View {
  var active = true
  @ViewBuilder let content: (String) -> Content
  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  var body: some View {
    TimelineView(.periodic(from: .now, by: 0.08)) {timeline in
      let frame = active && !reduceMotion ? Int(timeline.date.timeIntervalSinceReferenceDate / 0.08) : 0
      content(Art.spinner[frame % Art.spinner.count])
    }
  }
}
