// Floco, the cat: a little actor around the ASCII cat (the web UI's mascot.ts).
// It talks (typing its bubble while its mouth moves), fidgets on its own
// (blinks, looks around, flicks an ear, tilts its head, yawns, swishes its tail),
// follows the pointer with its eyes on the Mac, and reacts to the app state.
// Frames come from the engine (core/cat.ts), 20 per second.
import DevCleanKit
import SwiftUI

@MainActor
@Observable
final class Mascot {
  private enum Fidget: CaseIterable {case blink, look, ear, tilt, yawn, swish}
  private static let face: [MascotState: String] = [.idle: "idle", .scanning: "idle", .cleaning: "happy", .done: "happy", .error: "worried", .empty: "sleepy"]
  // Broom swing speed (radians of phase per second) while working.
  private static let sweep: [MascotState: Double] = [.scanning: 5, .cleaning: 11]
  private static let fidgets: [MascotState: [Fidget]] = [
    .idle: [.blink, .look, .ear, .tilt, .swish, .blink, .look, .yawn], .scanning: [.blink, .ear, .look], .cleaning: [.ear],
    .done: [.blink, .look, .ear, .tilt, .swish, .blink], .error: [.blink, .look], .empty: [.ear, .yawn, .swish],
  ]
  private static let duration: [Fidget: Double] = [.blink: 0.16, .look: 1.3, .ear: 0.26, .tilt: 1.5, .yawn: 1.7, .swish: 1.8]
  private static let pets = ["prrrr…", "Mais carinho! prrr…", "Hmm, aí atrás da orelha…", "prrr… valeu!"]
  private static let vowels = Set("aeiouáéíóúãõâêôAEIOUÁÉÍÓÚÃÕÂÊÔ")

  // What the view shows.
  private(set) var art = ""
  private(set) var bubble = ""
  // Bumped on every new line, so the bubble pops in.
  private(set) var spoken = 0

  // The whole cat, or the bust (the tutorial guide); seconds per typed character.
  let bust: Bool
  private let typeDelay: Double
  // Lines to chat about between tasks.
  @ObservationIgnored var tips: () -> [String] = {[]}
  var reduceMotion = false {didSet {if reduceMotion != oldValue {restart()}}}

  // Internal state: only `art`, `bubble` and `spoken` change what the views show.
  @ObservationIgnored private var state = MascotState.idle
  @ObservationIgnored private var message = ""
  @ObservationIgnored private var speech: [Character] = []
  @ObservationIgnored private var typed = 0
  @ObservationIgnored private var typedAt = 0.0
  @ObservationIgnored private var spokeAt = 0.0
  @ObservationIgnored private var fidget: (kind: Fidget, until: Double, look: Int)?
  @ObservationIgnored private var nextFidget = 0.0
  @ObservationIgnored private var hopUntil = 0.0
  @ObservationIgnored private var shakeUntil = 0.0
  @ObservationIgnored private var purrUntil = 0.0
  @ObservationIgnored private var reactedAt = 0.0
  @ObservationIgnored private var pointerLook = 0
  @ObservationIgnored private var gaze: Int?
  @ObservationIgnored private let started = ProcessInfo.processInfo.systemUptime
  @ObservationIgnored private var loop: Task<Void, Never>?

  init(bust: Bool = false, typeDelay: Double = 0.032) {
    self.bust = bust; self.typeDelay = typeDelay
    art = Art.cat("idle", CatPose(), bust: bust)
  }

  private var now: Double {ProcessInfo.processInfo.systemUptime}
  var talking: Bool {typed < speech.count}

  // Set the state the cat reflects, and what it says about it.
  func set(_ next: MascotState, _ text: String) {
    let now = self.now
    if next == .done && state != .done {hopUntil = now + 0.72}
    if next == .error {shakeUntil = now + 0.7}
    state = next; message = text; purrUntil = 0; fidget = nil; nextFidget = now + 1.5
    speak(text, now)
    restart()
  }

  // A quick comment on something the user did (selection, filters), with a small hop.
  func react(_ text: String) {
    let now = self.now
    if now - reactedAt < 0.9 {return}
    reactedAt = now; hopUntil = now + 0.36
    speak(text, now)
    if reduceMotion {render()}
  }

  // Petting: purr and say something, then go back to what it was saying.
  func pet() {
    let now = self.now
    purrUntil = now + 1.8; hopUntil = now + 0.36; fidget = nil
    speak(Self.pets.randomElement()!, now)
    if reduceMotion {
      render()
      Task {try? await Task.sleep(for: .seconds(1.8)); purrUntil = 0; speak(message, self.now); render()}
    }
  }

  // Force where the eyes look (what the tutorial points at); nil lets them wander.
  func look(at direction: Int?) {gaze = direction}
  // Eyes follow the pointer when it is clearly to one side of the cat.
  func pointer(at x: CGFloat?, artFrame: CGRect) {
    guard let x, artFrame.width > 0 else {pointerLook = 0; return}
    let dx = x - (artFrame.minX + artFrame.width * 0.4)
    pointerLook = abs(dx) < artFrame.width * 0.35 ? 0 : dx < 0 ? -1 : 1
  }
  // Show the rest of the line at once.
  func finish() {typed = speech.count; bubble = message(upTo: typed)}
  func stop() {loop?.cancel(); loop = nil}

  private func speak(_ text: String, _ now: Double) {
    speech = Array(text); typed = reduceMotion ? speech.count : 0; typedAt = now; spokeAt = now
    bubble = reduceMotion ? text : ""
    spoken += 1
  }
  private func message(upTo count: Int) -> String {String(speech.prefix(count))}

  private func restart() {
    stop()
    if reduceMotion {render(); return}
    loop = Task {[weak self] in
      while !Task.isCancelled {
        self?.step()
        try? await Task.sleep(for: .milliseconds(50))
      }
    }
  }

  private func step() {
    let now = self.now
    // Typewriter.
    if typed < speech.count && now - typedAt >= typeDelay {
      typed = min(speech.count, typed + Int((now - typedAt) / typeDelay)); typedAt = now
      bubble = message(upTo: typed)
    }
    // Fidgets: one at a time, a random one every couple of seconds, never mid-sentence.
    if (fidget == nil || now >= fidget!.until) && now >= nextFidget && now >= purrUntil && !talking {
      let kind = Self.fidgets[state]!.randomElement()!
      fidget = (kind, now + Self.duration[kind]!, Bool.random() ? -1 : 1)
      nextFidget = fidget!.until + 1.2 + Double.random(in: 0..<2.6)
    }
    // Chatter: a tip now and then when nothing else is going on.
    if now - spokeAt > 22 && (state == .done || state == .idle) {
      if let tip = tips().randomElement() {speak(tip, now)} else {spokeAt = now}
    }
    if now >= purrUntil && String(speech).hasPrefix("prr") && !talking && now - spokeAt > 2.6 {speak(message, now)}
    render(now)
  }

  private func render(_ now: Double? = nil) {
    let now = now ?? self.now, t = now - started
    let purring = now < purrUntil
    let active = fidget.flatMap {now < $0.until ? $0 : nil}
    var mood = purring ? "purr" : Self.face[state]!
    if !purring && (active?.kind == .blink || active?.kind == .yawn) {mood = state == .empty ? "sleepy" : "blink"}
    let speed = Self.sweep[state]
    var pose = CatPose()
    pose.t = t
    if !reduceMotion {
      // Mouth follows the letter being typed: open on vowels, half on consonants, shut on spaces.
      let ch = typed < speech.count ? speech[typed] : " "
      pose.mouth = active?.kind == .yawn ? 3 : talking ? (Self.vowels.contains(ch) ? 2 : ch.isWhitespace || ".,!?…".contains(ch) ? 0 : 1) : 0
      pose.sweep = speed.map {purring ? 0 : sin(t * $0) * 0.3} ?? 0
    }
    // Pointer wins over idle glances; while sweeping the cat watches its broom.
    pose.look = gaze ?? (pointerLook != 0 ? pointerLook : active?.kind == .look ? active!.look : speed != nil ? 1 : 0)
    pose.ear = active?.kind == .ear
    pose.tilt = now < shakeUntil ? (Int(now / 0.11) % 2 == 1 ? 1 : -1) : active?.kind == .tilt ? active!.look : 0
    pose.hop = now < hopUntil && Int((hopUntil - now) / 0.18) % 2 == 1
    pose.swish = active?.kind == .swish || state == .cleaning ? 1 : state == .empty ? 0.05 : 0.25
    art = Art.cat(mood, pose, bust: bust)
  }
}

// The cat's ASCII art; tapping it pets the cat.
struct MascotArt: View {
  let mascot: Mascot
  var size: CGFloat
  var onFrame: (CGRect) -> Void = {_ in}
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @State private var hover = false

  var body: some View {
    Button {mascot.pet()} label: {
      AsciiArt(text: mascot.art, size: size)
        .shadow(color: .white.opacity(0.08), radius: 3)
        .padding(4)
        .offset(y: hover && !reduceMotion ? -1 : 0)
        .animation(.easeOut(duration: 0.15), value: hover)
    }
    .buttonStyle(.plain)
    .onHover {hover = $0}
    .accessibilityLabel("Fazer carinho no gato")
    .help("Faça carinho")
    .onGeometryChange(for: CGRect.self) {$0.frame(in: .global)} action: {onFrame($0)}
    .onChange(of: reduceMotion, initial: true) {mascot.reduceMotion = reduceMotion}
  }
}

// The speech bubble under the cat card: an arrow pointing up, popping in on each new line.
struct Bubble: View {
  let mascot: Mascot
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @State private var popped = true

  var body: some View {
    if !mascot.bubble.isEmpty {
      Text(mascot.bubble)
        .font(Theme.mono(11)).lineSpacing(11 * 0.45 - 2).foregroundStyle(Theme.text)
        .multilineTextAlignment(.center)
        .padding(EdgeInsets(top: 8, leading: 11, bottom: 8, trailing: 11))
        .frame(maxWidth: .infinity)
        .background(Color(hex: 0x20242a), in: RoundedRectangle(cornerRadius: 8))
        .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(Color(hex: 0x3b4047), lineWidth: 1))
        .overlay(alignment: .top) {
          Rectangle().fill(Color(hex: 0x20242a)).frame(width: 10, height: 10)
            .overlay(alignment: .topLeading) {
              Path {p in p.move(to: CGPoint(x: 0, y: 10)); p.addLine(to: .zero); p.addLine(to: CGPoint(x: 10, y: 0))}
                .stroke(Color(hex: 0x3b4047), lineWidth: 1)
            }
            .rotationEffect(.degrees(45)).offset(y: -5)
        }
        .scaleEffect(popped ? 1 : 0.9, anchor: .top).opacity(popped ? 1 : 0).offset(y: popped ? 0 : -4)
        .accessibilityHidden(true)
        .onChange(of: mascot.spoken) {
          guard !reduceMotion else {return}
          popped = false
          withAnimation(.timingCurve(0.2, 0.9, 0.3, 1.3, duration: 0.28)) {popped = true}
        }
    }
  }
}
