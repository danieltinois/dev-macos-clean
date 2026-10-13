// The guided tour (the web UI's tutorial.ts): a spotlight on one part of the
// screen at a time while a bust of Floco talks next to it. Targets report their
// frames through `.tourTarget`; Tour.place decides where the guide goes.
import DevCleanKit
import SwiftUI

struct TourOverlay: View {
  let model: AppModel
  let view: CGSize
  @Environment(\.metrics) private var metrics
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @State private var guideSize = CGSize(width: 560, height: 230)
  @State private var appeared = false
  @State private var pulse = false

  var body: some View {
    let pad: CGFloat = 8
    let spot = model.stepTarget.map {$0.frame.insetBy(dx: -pad, dy: -pad)}
    let placed = Tour.place(spot, guide: guideSize, in: view)
    let motion: Animation? = reduceMotion ? nil : .timingCurve(0.2, 0.7, 0.3, 1, duration: 0.45)
    ZStack(alignment: .topLeading) {
      // The page dims around the spotlight; with nothing to point at, all of it dims.
      Path {path in
        path.addRect(CGRect(x: -2000, y: -2000, width: view.width + 4000, height: view.height + 4000))
        if let spot {path.addRoundedRect(in: spot, cornerSize: CGSize(width: 6, height: 6))}
      }
      .fill(Color(hex: 0x07090b, opacity: 0.8), style: FillStyle(eoFill: true))
      .contentShape(Rectangle())
      .onTapGesture {}
      if let spot {
        RoundedRectangle(cornerRadius: 6).strokeBorder(Theme.accent, lineWidth: 1)
          .shadow(color: Theme.accent.opacity(pulse ? 0.53 : 0.33), radius: pulse ? 17 : 12)
          .frame(width: spot.width, height: spot.height)
          .offset(x: spot.minX, y: spot.minY)
          .allowsHitTesting(false)
      }
      guide
        .onGeometryChange(for: CGSize.self) {$0.size} action: {guideSize = $0}
        .offset(x: placed.origin.x, y: placed.origin.y)
        .opacity(appeared ? 1 : 0)
        .scaleEffect(appeared ? 1 : 0.96)
    }
    .animation(motion, value: spot)
    .animation(motion, value: placed.origin)
    .onChange(of: placed.side, initial: true) {
      // Look at what is being shown.
      model.guideCat.look(at: placed.side == .right ? -1 : placed.side == .left ? 1 : 0)
    }
    .onAppear {
      if reduceMotion {appeared = true} else {withAnimation(.timingCurve(0.2, 0.9, 0.3, 1.2, duration: 0.35)) {appeared = true}}
      if !reduceMotion {withAnimation(.easeInOut(duration: 1).repeatForever(autoreverses: true)) {pulse = true}}
    }
  }

  @ViewBuilder private var guide: some View {
    let compact = metrics.compact
    if compact {
      // No room beside the bubble: Floco sits on top of it, smaller, and the bubble points up at him.
      VStack(alignment: .leading, spacing: 2) {
        MascotArt(mascot: model.guideCat, size: 3.4).padding(.leading, 14)
        bubble(arrowOnTop: true)
      }
      .frame(width: view.width - 24)
    } else {
      HStack(spacing: 6) {
        MascotArt(mascot: model.guideCat, size: 5.6)
        bubble(arrowOnTop: false)
      }
      .frame(width: min(560, view.width - 24))
    }
  }

  private func bubble(arrowOnTop: Bool) -> some View {
    let index = model.tourIndex ?? 0, last = index == model.steps.count - 1, compact = metrics.compact
    return VStack(alignment: .leading, spacing: 0) {
      HStack {
        Text("FLOCO · TUTORIAL").label()
        Spacer()
        Text("\(index + 1) / \(model.steps.count)").label()
      }
      .padding(.bottom, 8)
      Text(model.guideCat.bubble)
        .font(Theme.mono(12.5)).lineSpacing(12.5 * 0.55 - 3).foregroundStyle(Color(hex: 0xdfe3e8))
        .fixedSize(horizontal: false, vertical: true)
        .frame(maxWidth: .infinity, minHeight: 12.5 * 4.4, alignment: .topLeading)
        .accessibilityLabel(model.step?.text(scanned: model.scanned) ?? "")
      HStack(spacing: 8) {
        Button("Pular") {model.endTour()}
          .devButton(.subtle, minHeight: compact ? 36 : 0)
          .keyboardShortcut(.cancelAction)
        Spacer(minLength: 0)
        Button("Voltar") {model.previousStep()}
          .devButton(.subtle, minHeight: compact ? 36 : 0)
          .disabled(index == 0)
          .keyboardShortcut(.leftArrow, modifiers: [])
        Button(last ? "Concluir" : "Próximo") {model.nextStep()}
          .devButton(.primary, minHeight: compact ? 36 : 0)
          .keyboardShortcut(.rightArrow, modifiers: [])
      }
      .padding(.top, 12)
    }
    .padding(EdgeInsets(top: 14, leading: 16, bottom: 12, trailing: 16))
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(Color(hex: 0x1f2328), in: RoundedRectangle(cornerRadius: 10))
    .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(Color(hex: 0x4a5058), lineWidth: 1))
    .overlay(alignment: arrowOnTop ? .topLeading : .leading) {
      Arrow().fill(Color(hex: 0x1f2328)).overlay(Arrow(open: true).stroke(Color(hex: 0x4a5058), lineWidth: 1))
        .frame(width: 12, height: 12)
        .rotationEffect(.degrees(arrowOnTop ? 90 : 0))
        .offset(x: arrowOnTop ? 40 : -7, y: arrowOnTop ? -7 : 0)
    }
    .shadow(color: .black.opacity(0.67), radius: 30, y: 18)
    .accessibilityElement(children: .contain)
    .accessibilityLabel("Tutorial do DevClean")
  }
}

// The bubble's pointer, facing left: a square turned 45° showing two sides.
private struct Arrow: Shape {
  var open = false
  func path(in rect: CGRect) -> Path {
    var path = Path()
    let mid = CGPoint(x: rect.midX, y: rect.midY), r = rect.width / 2
    path.move(to: CGPoint(x: mid.x, y: mid.y - r))
    path.addLine(to: CGPoint(x: mid.x - r, y: mid.y))
    path.addLine(to: CGPoint(x: mid.x, y: mid.y + r))
    if !open {path.addLine(to: CGPoint(x: mid.x + r * 0.2, y: mid.y)); path.closeSubpath()}
    return path
  }
}
