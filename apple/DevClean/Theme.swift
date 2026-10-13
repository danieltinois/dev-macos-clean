// The look of the app: the colors, type and sizes of the original web UI
// (ui/style.css), so the native screens keep the same layout. Metrics follow
// the window width with the same breakpoints the CSS used.
import SwiftUI

extension Color {
  init(hex: UInt32, opacity: Double = 1) {
    self.init(.sRGB, red: Double((hex >> 16) & 0xff) / 255, green: Double((hex >> 8) & 0xff) / 255, blue: Double(hex & 0xff) / 255, opacity: opacity)
  }
}

enum Theme {
  static let background = Color(hex: 0x191b1e)
  static let text = Color(hex: 0xc8cbd1)
  static let line = Color(hex: 0x303338)
  static let muted = Color(hex: 0x9298a2)
  static let accent = Color(hex: 0xb5caa1)
  static let accentHover = Color(hex: 0xc5d7b4)
  static let amber = Color(hex: 0xd2ad76)
  static let danger = Color(hex: 0xe39692)
  static let card = Color(hex: 0x1c1e22)
  static let titlebar = Color(hex: 0x15171a)
  static let panel = Color(hex: 0x1e2024)
  static let barEmpty = Color(hex: 0x3a3e44)
  static let barUsed = Color(hex: 0x6b7480)
  static let strong = Color(hex: 0xe0e3e7)

  static func sans(_ size: CGFloat, _ weight: Font.Weight = .regular) -> Font {.system(size: size, weight: weight)}
  static func mono(_ size: CGFloat, _ weight: Font.Weight = .regular) -> Font {.system(size: size, weight: weight, design: .monospaced)}
}

// Sizes that change with the window width, like the CSS media queries.
struct Metrics: Equatable {
  let width: CGFloat
  // max-width: 600px: the phone layout (one column, cards for rows, touch-sized controls).
  var compact: Bool {width < 600}
  // max-width: 760px: the overview in one column.
  var overviewSingle: Bool {width < 760}
  // max-width: 1000px: tighter table columns, no scope note.
  var narrow: Bool {width < 1000}
  // max-width: 1100px: the overview above the results, in two columns.
  var stacked: Bool {width < 1100}

  var padding: EdgeInsets {
    compact ? EdgeInsets(top: 16, leading: 12, bottom: 0, trailing: 12) : narrow ? EdgeInsets(top: 24, leading: 20, bottom: 0, trailing: 20) : EdgeInsets(top: 28, leading: 30, bottom: 0, trailing: 30)
  }
  // Table columns: tool, risk, size and chevron (the name takes the rest).
  var columns: (tool: CGFloat, risk: CGFloat, size: CGFloat, chevron: CGFloat, gap: CGFloat) {
    narrow ? (75, 85, 80, 10, 10) : (95, 95, 94, 12, 14)
  }
}

private struct MetricsKey: EnvironmentKey {static let defaultValue = Metrics(width: 1280)}
extension EnvironmentValues {
  var metrics: Metrics {
    get {self[MetricsKey.self]}
    set {self[MetricsKey.self] = newValue}
  }
}

// MARK: Buttons

// The three button looks of the CSS: plain, `.primary` (accent) and `.subtle` (small, transparent).
struct DevButtonStyle: ButtonStyle {
  enum Kind {case plain, primary, subtle}
  var kind: Kind = .plain
  var fontSize: CGFloat?
  var padding: EdgeInsets?
  var minHeight: CGFloat = 0
  var fill = false
  // While scanning, the Analisar button pulses instead of fading like other disabled buttons.
  var pulsing = false

  func makeBody(configuration: Configuration) -> some View {
    StyledButton(configuration: configuration, style: self)
  }

  private struct StyledButton: View {
    let configuration: Configuration
    let style: DevButtonStyle
    @Environment(\.isEnabled) private var enabled
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var hover = false
    @State private var pulse = false

    var body: some View {
      let primary = style.kind == .primary, subtle = style.kind == .subtle
      let background = primary ? (hover && enabled ? Theme.accentHover : Theme.accent) : subtle ? (hover && enabled ? Color(hex: 0x2b2f34) : .clear) : (hover && enabled ? Color(hex: 0x2b2f34) : Color(hex: 0x24272b))
      let border = primary ? background : hover && enabled ? Color(hex: 0x50565f) : Theme.line
      configuration.label
        .font(Theme.sans(style.fontSize ?? (subtle ? 11 : 13), primary ? .semibold : .regular))
        .foregroundStyle(primary ? Color(hex: 0x20251b) : Theme.text)
        .lineLimit(1)
        .padding(style.padding ?? (subtle ? EdgeInsets(top: 6, leading: 10, bottom: 6, trailing: 10) : EdgeInsets(top: 8, leading: 12, bottom: 8, trailing: 12)))
        .frame(maxWidth: style.fill ? .infinity : nil, minHeight: style.minHeight)
        .background(background, in: RoundedRectangle(cornerRadius: 4))
        .overlay(RoundedRectangle(cornerRadius: 4).strokeBorder(border, lineWidth: 1))
        .contentShape(Rectangle())
        .opacity(style.pulsing && !enabled ? (pulse ? 0.65 : 1) : enabled ? 1 : 0.38)
        .scaleEffect(configuration.isPressed && enabled && !reduceMotion ? 0.97 : 1)
        .animation(reduceMotion ? nil : .easeOut(duration: 0.15), value: hover)
        .animation(reduceMotion ? nil : .easeOut(duration: 0.1), value: configuration.isPressed)
        .onHover {hover = $0}
        .onChange(of: style.pulsing && !enabled, initial: true) {_, on in
          guard !reduceMotion else {return}
          if on {withAnimation(.easeInOut(duration: 0.75).repeatForever(autoreverses: true)) {pulse = true}} else {withAnimation(.default) {pulse = false}}
        }
    }
  }
}

extension View {
  func devButton(_ kind: DevButtonStyle.Kind = .plain, fontSize: CGFloat? = nil, padding: EdgeInsets? = nil, minHeight: CGFloat = 0, fill: Bool = false, pulsing: Bool = false) -> some View {
    buttonStyle(DevButtonStyle(kind: kind, fontSize: fontSize, padding: padding, minHeight: minHeight, fill: fill, pulsing: pulsing))
  }

  // A bordered card (`.stats`, `.breakdown`, `.disk`).
  func card(padding: EdgeInsets = EdgeInsets(top: 14, leading: 16, bottom: 10, trailing: 16)) -> some View {
    self.padding(padding)
      .frame(maxWidth: .infinity, alignment: .leading)
      .background(Theme.card, in: RoundedRectangle(cornerRadius: 4))
      .overlay(RoundedRectangle(cornerRadius: 4).strokeBorder(Theme.line, lineWidth: 1))
  }

  // `.label`: small monospaced caption.
  func label(_ color: Color = Theme.muted, tracking: CGFloat = 0) -> some View {
    font(Theme.mono(10)).tracking(tracking).foregroundStyle(color)
  }
}

// A checkbox drawn like the web one (`accent-color` on a dark page).
struct CheckBox: View {
  @Binding var isOn: Bool
  var size: CGFloat = 13
  var label: String
  @Environment(\.isEnabled) private var enabled

  var body: some View {
    Button {isOn.toggle()} label: {
      RoundedRectangle(cornerRadius: 3)
        .fill(isOn ? Theme.accent : Color(hex: 0x24272b))
        .overlay(RoundedRectangle(cornerRadius: 3).strokeBorder(isOn ? Theme.accent : Color(hex: 0x6b7480), lineWidth: 1))
        .overlay {
          if isOn {Image(systemName: "checkmark").font(.system(size: size * 0.62, weight: .heavy)).foregroundStyle(Color(hex: 0x20251b))}
        }
        .frame(width: size, height: size)
        .opacity(enabled ? 1 : 0.3)
        .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .accessibilityLabel(label)
    .accessibilityValue(isOn ? "marcado" : "desmarcado")
  }
}
