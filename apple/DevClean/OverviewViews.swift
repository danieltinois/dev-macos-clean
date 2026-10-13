// The overview sidebar: Floco's card, the summary, the disk panel and the
// per-tool chart (the web UI's `.mascot`, `.stats`, `.disk` and `.breakdown`).
import DevCleanKit
import SwiftUI

struct MascotCard: View {
  let model: AppModel
  @Environment(\.metrics) private var metrics

  var body: some View {
    VStack(spacing: 10) {
      MascotArt(mascot: model.cat, size: metrics.compact ? 6.4 : 7.6) {model.catFrame = $0}
      Bubble(mascot: model.cat)
    }
    // While Floco guides the tour, his card says he'll be right back.
    .opacity(model.touring ? 0 : 1)
    .overlay {
      if model.touring {
        Text("Fui ali te mostrar o app! Já volto.").font(Theme.mono(11)).foregroundStyle(Theme.muted).multilineTextAlignment(.center)
      }
    }
    .padding(EdgeInsets(top: 14, leading: 16, bottom: 16, trailing: 16))
    .frame(maxWidth: .infinity)
    .background(EllipticalGradient(colors: [Color(hex: 0x23272c), Theme.card], center: UnitPoint(x: 0.45, y: 0.4), endRadiusFraction: 0.7), in: RoundedRectangle(cornerRadius: 4))
    .overlay(RoundedRectangle(cornerRadius: 4).strokeBorder(Theme.line, lineWidth: 1))
    .tourTarget(.mascot, in: model)
  }
}

struct StatsCard: View {
  let model: AppModel
  @Environment(\.metrics) private var metrics

  var body: some View {
    let total = model.report?.totals.bytes ?? 0, safe = model.safeBytes, review = total - safe
    VStack(spacing: 0) {
      article(title: "IDENTIFICADO", dot: nil, value: total, big: !metrics.compact,
              bar: [(barBlocks(safe, of: total, width: 30), Theme.accent), (barBlocks(review, of: total, width: 30), Theme.amber)], duration: 0.8,
              note: model.cloudBytes > 0 ? "\(model.count)\nNo iPhone: \(Labels.bytes(model.onDeviceBytes)) · ☁ só no iCloud: \(Labels.bytes(model.cloudBytes))" : model.count)
      divider
      article(title: "LIMPEZA SEGURA", dot: Theme.accent, value: safe, big: false,
              bar: [(barBlocks(safe, of: total, width: 30), Theme.accent)], duration: 0.65, note: model.platform.safeNote)
      divider
      article(title: "REVISAR", dot: Theme.amber, value: review, big: false,
              bar: [(barBlocks(review, of: total, width: 30), Theme.amber)], duration: 0.65, note: "Conferir antes, ou limpar fora do app")
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(Theme.card, in: RoundedRectangle(cornerRadius: 4))
    .overlay(RoundedRectangle(cornerRadius: 4).strokeBorder(Theme.line, lineWidth: 1))
    .tourTarget(.stats, in: model)
  }

  private var divider: some View {Theme.line.frame(height: 1)}

  private func article(title: String, dot: Color?, value: Int, big: Bool, bar: [(blocks: Int, color: Color)], duration: Double, note: String) -> some View {
    VStack(alignment: .leading, spacing: 0) {
      HStack(spacing: 5) {
        if let dot {Circle().fill(dot).frame(width: 5, height: 5)}
        Text(title).label(tracking: 0.6)
      }
      Group {
        if model.report == nil {Text("—")} else {CountUp(value: value, format: Labels.bytes)}
      }
      .font(Theme.mono(big ? 30 : 24)).tracking(-1).foregroundStyle(Theme.strong).monospacedDigit()
      .padding(.top, 8).padding(.bottom, 6)
      if model.report != nil {
        BlockBar(segments: bar, width: 30, size: 10, duration: duration).padding(.bottom, 8)
      }
      Text(note).font(Theme.sans(11)).foregroundStyle(Theme.muted)
    }
    .padding(EdgeInsets(top: 14, leading: 16, bottom: 14, trailing: 16))
    .frame(maxWidth: .infinity, alignment: .leading)
  }
}

// The volume: everything else in use, what DevClean found, purgeable and free space.
struct DiskCard: View {
  let model: AppModel

  var body: some View {
    if let report = model.report, let storage = report.storage {
      // Only what is on the device comes back as free space.
      let d = DiskParts(storage, found: model.onDeviceBytes), platform = model.platform
      let percent = d.total > 0 ? Int((Double(d.free) / Double(d.total) * 100).rounded()) : 0
      VStack(alignment: .leading, spacing: 0) {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
          Text(platform.disk).label()
          Spacer(minLength: 0)
          Text("\(Labels.bytes(d.total)) no total").label(Color(hex: 0x6f7782))
        }
        .padding(.bottom, 10)
        BlockBar(segments: [(barBlocks(d.other, of: d.total, width: 30), Theme.barUsed), (barBlocks(d.found, of: d.total, width: 30), Theme.accent),
                            (barBlocks(d.purgeable ?? 0, of: d.total, width: 30), Theme.amber)], width: 30, size: 11, duration: 0.8)
          .padding(.bottom, 10)
        row(Theme.barUsed, "Em uso", Labels.bytes(d.other), "Sistema, apps e seus arquivos")
        row(Theme.accent, "DevClean achou", Labels.bytes(d.found), platform.foundNote)
        if let purgeable = d.purgeable {row(Theme.amber, "Liberável pelo sistema", Labels.bytes(purgeable), platform.purgeableNote)}
        row(Theme.barEmpty, "Livre agora", "\(Labels.bytes(d.free)) · \(percent)%", "Até \(Labels.bytes(d.freeAfter)) se você limpar tudo")
      }
      .card(padding: EdgeInsets(top: 14, leading: 16, bottom: 12, trailing: 16))
      .accessibilityElement(children: .combine)
      .tourTarget(.disk, in: model)
    }
  }

  private func row(_ color: Color, _ label: String, _ size: String, _ note: String) -> some View {
    HStack(alignment: .firstTextBaseline, spacing: 8) {
      Text("■").font(.system(size: 10)).foregroundStyle(color).frame(width: 12, alignment: .leading)
      VStack(alignment: .leading, spacing: 2) {
        HStack(alignment: .firstTextBaseline) {
          Text(label).font(Theme.sans(12)).foregroundStyle(Theme.text)
          Spacer(minLength: 8)
          Text(size).font(Theme.mono(12)).foregroundStyle(Theme.strong).monospacedDigit()
        }
        Text(note).font(Theme.sans(10.5)).foregroundStyle(Theme.muted).fixedSize(horizontal: false, vertical: true)
      }
    }
    .padding(.vertical, 4)
  }
}

// One clickable block-chart row per tool, largest first, on a shared scale. Clicking filters the results.
struct BreakdownCard: View {
  let model: AppModel
  @Environment(\.metrics) private var metrics

  var body: some View {
    let scanning = model.busy && model.progress != nil
    let entries = (model.report?.totals.byCategory ?? [:]).filter {$0.value > 0}.sorted {$0.value > $1.value}
    let active = model.filters.category
    VStack(alignment: .leading, spacing: 0) {
      HStack(alignment: .firstTextBaseline, spacing: 12) {
        Text("POR FERRAMENTA").label()
        Spacer(minLength: 0)
        Text(scanning ? "analisando…" : active.isEmpty ? "clique para filtrar" : "× limpar filtro").label(Color(hex: 0x6f7782))
      }
      .padding(.bottom, 10)
      if scanning {
        Sweep()
      } else if model.report != nil && entries.isEmpty {
        Text("Nada encontrado.").font(Theme.sans(11)).foregroundStyle(Theme.muted)
      } else {
        let max = entries.first?.value ?? 0
        VStack(spacing: 0) {
          ForEach(Array(entries.enumerated()), id: \.element.key) {i, entry in
            BarRow(label: Labels.category(entry.key), blocks: barBlocks(entry.value, of: max, width: 26), size: Labels.bytes(entry.value),
                   active: entry.key == active, delay: Double(i) * 0.04, labelWidth: metrics.compact ? 74 : 90) {
              model.toggleCategory(entry.key, size: entry.value)
            }
          }
        }
      }
    }
    .card()
    .tourTarget(.breakdown, in: model)
  }
}

private struct BarRow: View {
  let label: String
  let blocks: Int
  let size: String
  let active: Bool
  let delay: Double
  let labelWidth: CGFloat
  let action: () -> Void
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @State private var hover = false

  var body: some View {
    Button(action: action) {
      HStack(spacing: 10) {
        Text(label).foregroundStyle(active ? Theme.accent : Color(hex: 0x9da7b5)).lineLimit(1).truncationMode(.tail)
          .frame(width: labelWidth, alignment: .leading)
        BlockBar(segments: [(blocks, Theme.accent)], width: 26, size: 11, delay: delay)
          .clipped()
          .layoutPriority(-1)
        Spacer(minLength: 0)
        Text(size).foregroundStyle(Color(hex: 0xd4d9e0)).monospacedDigit().lineLimit(1).fixedSize()
      }
      .font(Theme.mono(11))
      .padding(.vertical, 3).padding(.horizontal, 6)
      .background(active ? Color(hex: 0x2a3127) : hover ? Color(hex: 0x262a2f) : .clear, in: RoundedRectangle(cornerRadius: 3))
      .contentShape(Rectangle())
      .offset(x: hover && !reduceMotion ? 2 : 0)
      .animation(reduceMotion ? nil : .easeOut(duration: 0.15), value: hover)
    }
    .buttonStyle(.plain)
    .padding(.horizontal, -6)
    .onHover {hover = $0}
    .help("Mostrar só \(label)")
    .accessibilityValue(size)
    .accessibilityAddTraits(active ? .isSelected : [])
  }
}
