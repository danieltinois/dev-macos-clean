// The details dialog for one finding (the web UI's `<dialog id="details">`)
// and the loading layer shown while an item opens.
import DevCleanKit
import SwiftUI

struct DetailsOverlay: View {
  let model: AppModel
  @Environment(\.metrics) private var metrics
  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  var body: some View {
    ZStack {
      if let item = model.details {
        Color(hex: 0x090b0d, opacity: 0.73).ignoresSafeArea()
          .transition(.opacity)
        GeometryReader {geometry in
          card(item.finding, view: geometry.size)
            .frame(width: geometry.size.width, height: geometry.size.height)
        }
        .transition(reduceMotion ? .opacity : .opacity.combined(with: .offset(y: 8)).combined(with: .scale(scale: 0.98)))
      }
    }
    .animation(reduceMotion ? nil : .timingCurve(0.2, 0.7, 0.3, 1, duration: 0.2), value: model.details?.index)
  }

  private func card(_ f: Finding, view: CGSize) -> some View {
    let compact = metrics.compact
    return ScrollView {
      VStack(alignment: .leading, spacing: 0) {
        HStack(spacing: 20) {
          Text(f.name).font(Theme.mono(13, .semibold)).foregroundStyle(Color(hex: 0xd5d9df))
          Spacer(minLength: 0)
          Button {model.details = nil} label: {
            HStack(spacing: 6) {
              Text("Fechar")
              if !compact {Text("esc").font(Theme.mono(9)).foregroundStyle(Color(hex: 0x8e97a4))}
            }
          }
          .devButton(fontSize: 10, padding: compact ? EdgeInsets(top: 6, leading: 12, bottom: 6, trailing: 12) : EdgeInsets(top: 5, leading: 8, bottom: 5, trailing: 8), minHeight: compact ? 36 : 0)
          .keyboardShortcut(.cancelAction)
          .accessibilityLabel("Fechar detalhes")
        }
        .padding(.bottom, 16)
        .overlay(alignment: .bottom) {Theme.line.frame(height: 1)}
        VStack(alignment: .leading, spacing: 0) {
          paragraph(f.description)
          section(f.metadata["label"] != nil ? "Arquivo" : "Caminho", f.location)
          section("Tamanho e classificação", "\(f.sizeComplete ? "" : "Medição parcial: pelo menos ")\(Labels.bytes(f.sizeBytes)) · \(Labels.risk(f.severity)) · \(f.reclaimable ? "Recriável" : "Pode conter dados locais")")
          section("Última modificação", f.modifiedDate.map(Labels.dateTime) ?? "Indisponível")
          section("Como recriar", f.rebuild?.description ?? "Sem instruções de reconstrução.")
          if let commands = f.rebuild?.commands, !commands.isEmpty {
            Text(commands.joined(separator: "\n")).font(Theme.mono(11)).lineSpacing(11 * 0.7 - 2).textSelection(.enabled)
              .frame(maxWidth: .infinity, alignment: .leading)
              .padding(12).background(Theme.titlebar).overlay(Rectangle().strokeBorder(Theme.line, lineWidth: 1))
          }
          section("Limpeza", cleanupText(f))
          // `label` is shown as the path and `keeper` is for grouping; the rest are notes.
          ForEach(f.metadata.keys.sorted().filter {$0 != "label" && $0 != "keeper"}, id: \.self) {section($0, f.metadata[$0] ?? "")}
        }
        .padding(.vertical, 20)
        Button(model.platform.reveal) {Task {await model.reveal()}}
          .devButton(.primary, minHeight: compact ? 44 : 0, fill: compact)
          .disabled(model.opening)
      }
      .padding(compact ? 16 : 22)
    }
    .scrollBounceBehavior(.basedOnSize)
    .frame(width: compact ? view.width - 20 : min(590, view.width - 40))
    .fixedSize(horizontal: false, vertical: true)
    .frame(maxHeight: view.height * (compact ? 0.88 : 0.85))
    .background(Color(hex: 0x1c1f23), in: RoundedRectangle(cornerRadius: 6))
    .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(Color(hex: 0x484e57), lineWidth: 1))
    .shadow(color: .black.opacity(0.44), radius: 40, y: 20)
  }

  private func cleanupText(_ f: Finding) -> String {
    let to = model.platform.toTrash
    if f.cleanupAllowed != true {return f.cleanupReason ?? ""}
    if f.autoClean == true {return "Incluído na limpeza automática."}
    if f.cleanupReview == true {return "Pode ir \(to) se você selecionar. Confira antes: pode conter dados que não voltam sozinhos."}
    return "Pode ir \(to) se você selecionar."
  }

  private func paragraph(_ text: String) -> some View {
    Text(text).font(Theme.sans(12)).foregroundStyle(Color(hex: 0xb0b7c2)).lineSpacing(12 * 0.6 - 3)
      .fixedSize(horizontal: false, vertical: true).textSelection(.enabled)
      .frame(maxWidth: .infinity, alignment: .leading)
  }

  private func section(_ title: String, _ text: String) -> some View {
    VStack(alignment: .leading, spacing: 8) {
      Text(title.uppercased()).font(Theme.mono(10)).foregroundStyle(Color(hex: 0x8692a2))
      paragraph(text)
    }
    .padding(.top, 22)
  }
}

// Covers the screen while an item opens (on the iPhone it may download from iCloud first).
struct OpeningOverlay: View {
  let text: String

  var body: some View {
    VStack(spacing: 12) {
      Spinning {Text($0).font(Theme.mono(28)).foregroundStyle(Theme.accent)}
      Text(text).font(Theme.sans(13)).foregroundStyle(Theme.text).multilineTextAlignment(.center).frame(maxWidth: 320)
    }
    .padding(24)
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .background(Color(hex: 0x111315, opacity: 0.94).ignoresSafeArea())
    .accessibilityElement(children: .combine)
    .accessibilityAddTraits(.updatesFrequently)
  }
}
