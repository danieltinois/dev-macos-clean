// Reviewing photos on the iPhone, like the cleaner apps people know: a card with
// each set (copies, burst extras, similar photos, big videos…), then a full-screen
// review with a grid of thumbnails (copies and similar photos grouped around the
// one that stays) or a quick mode, one photo at a time, swipe left to delete and
// right to keep. Whatever is picked goes in one go, after the system's confirmation.
#if os(iOS)
import DevCleanKit
import SwiftUI

// The overview card that lists the photo sets to review.
struct PhotoReviewCard: View {
  let model: AppModel

  var body: some View {
    let sets = model.photoSets
    if !sets.isEmpty {
      VStack(alignment: .leading, spacing: 0) {
        HStack(alignment: .firstTextBaseline) {
          Text("REVISAR FOTOS").label(tracking: 0.6)
          Spacer()
          Text("toque para revisar").label(Color(hex: 0x6f7782))
        }
        .padding(.bottom, 10)
        ForEach(sets) {set in
          Button {model.reviewing = set.rule} label: {
            HStack(spacing: 10) {
              HStack(spacing: 3) {
                ForEach(set.items.prefix(3)) {PhotoThumb(path: $0.finding.path, side: 40).frame(width: 40, height: 40).clipShape(RoundedRectangle(cornerRadius: 3))}
              }
              VStack(alignment: .leading, spacing: 3) {
                Text(set.name).font(Theme.sans(12, .medium)).foregroundStyle(Color(hex: 0xd4d9e0))
                Text("\(set.items.count) · \(Labels.bytes(set.bytes))").font(Theme.mono(10)).foregroundStyle(Theme.muted)
              }
              Spacer(minLength: 0)
              Text("›").foregroundStyle(Color(hex: 0x747d89))
            }
            .padding(.vertical, 6)
            .contentShape(Rectangle())
          }
          .buttonStyle(.plain)
          .disabled(model.busy)
          .accessibilityLabel("Revisar \(set.name), \(set.items.count) itens, \(Labels.bytes(set.bytes))")
        }
      }
      .card(padding: EdgeInsets(top: 14, leading: 16, bottom: 10, trailing: 16))
    }
  }
}

// A photo from the library, square and cropped (thumbnails) or whole (quick mode).
struct PhotoThumb: View {
  let path: String
  var side: CGFloat
  var fill = true
  @Environment(\.displayScale) private var scale
  @State private var image: UIImage?
  @State private var duration: Double?

  var body: some View {
    ZStack(alignment: .bottomTrailing) {
      Color(hex: 0x24272b)
      if let image {
        Image(uiImage: image).resizable().aspectRatio(contentMode: fill ? .fill : .fit)
          .frame(maxWidth: .infinity, maxHeight: .infinity)
      }
      if let duration {
        Text(Duration.seconds(duration).formatted(.time(pattern: duration >= 3600 ? .hourMinuteSecond : .minuteSecond)))
          .font(Theme.mono(9, .semibold)).foregroundStyle(.white)
          .padding(.horizontal, 4).padding(.vertical, 2)
          .background(.black.opacity(0.55), in: RoundedRectangle(cornerRadius: 3))
          .padding(4)
      }
    }
    .clipped()
    .task(id: path) {
      duration = PhotoLibrary.duration(path)
      image = await PhotoLibrary.image(path, side: side * scale, fill: fill)
    }
    .accessibilityHidden(true)
  }
}

// The full-screen review of one set.
struct PhotoReviewView: View {
  let model: AppModel
  let set: AppModel.PhotoSet
  enum Mode: String, CaseIterable {case grid = "Grade", quick = "Rápido"}
  @State private var mode = Mode.grid
  @State private var picked = Set<Int>()
  @State private var started = false

  var body: some View {
    let bytes = set.items.filter {picked.contains($0.index)}.reduce(0) {$0 + $1.finding.sizeBytes}
    VStack(spacing: 0) {
      header
      Picker("Modo", selection: $mode) {ForEach(Mode.allCases, id: \.self) {Text($0.rawValue)}}
        .pickerStyle(.segmented).padding(.horizontal, 12).padding(.bottom, 10)
      Group {
        switch mode {
        case .grid: grid
        case .quick: QuickReview(set: set, picked: $picked, preview: preview)
        }
      }
      .frame(maxHeight: .infinity)
      Button(picked.isEmpty ? "Nada selecionado" : "Apagar \(picked.count) · \(Labels.bytes(bytes))") {
        let chosen = picked
        Task {await model.deleteReviewed(chosen)}
      }
      .devButton(.primary, fontSize: 14, minHeight: 48, fill: true)
      .disabled(picked.isEmpty)
      .padding(12)
      .background(Theme.titlebar)
      .overlay(alignment: .top) {Theme.line.frame(height: 1)}
    }
    .background(Theme.background.ignoresSafeArea())
    .foregroundStyle(Theme.text)
    .preferredColorScheme(.dark)
    .overlay {if model.opening {OpeningOverlay(text: model.platform.opening)}}
    .onAppear {
      guard !started else {return}
      started = true
      if set.preselected {picked = Set(set.items.map(\.index))}
    }
  }

  private var header: some View {
    VStack(alignment: .leading, spacing: 4) {
      HStack {
        Button("Fechar") {model.reviewing = nil}.devButton(.subtle, minHeight: 36)
        Spacer()
        Button(picked.count == set.items.count ? "Desmarcar tudo" : "Marcar tudo") {
          picked = picked.count == set.items.count ? [] : Set(set.items.map(\.index))
        }
        .devButton(.subtle, minHeight: 36)
      }
      Text(set.name).font(Theme.sans(20, .semibold)).foregroundStyle(Color(hex: 0xe7e9ec)).padding(.top, 8)
      Text("\(set.items.count) itens · \(Labels.bytes(set.bytes)) · \(set.items.first?.finding.description ?? "")")
        .font(Theme.sans(11)).foregroundStyle(Theme.muted).lineLimit(3)
    }
    .padding(12)
  }

  private func preview(_ index: Int) {Task {await model.preview(index)}}

  // MARK: Grid

  private let columns = Array(repeating: GridItem(.flexible(), spacing: 3), count: 3)

  @ViewBuilder private var grid: some View {
    ScrollView {
      if set.grouped {
        LazyVStack(alignment: .leading, spacing: 14) {
          ForEach(groups, id: \.keeper) {group in
            VStack(alignment: .leading, spacing: 6) {
              HStack(spacing: 10) {
                PhotoThumb(path: group.keeper, side: 56).frame(width: 56, height: 56)
                  .clipShape(RoundedRectangle(cornerRadius: 4))
                  .overlay(RoundedRectangle(cornerRadius: 4).strokeBorder(Theme.accent, lineWidth: 2))
                  .overlay(alignment: .bottom) {
                    Text("FICA").font(Theme.mono(8, .bold)).foregroundStyle(Color(hex: 0x20251b))
                      .padding(.horizontal, 4).background(Theme.accent, in: RoundedRectangle(cornerRadius: 2)).offset(y: 6)
                  }
                VStack(alignment: .leading, spacing: 2) {
                  Text("Fica: \(group.keeperName)").font(Theme.sans(12, .medium)).foregroundStyle(Color(hex: 0xd4d9e0)).lineLimit(1)
                  Text("\(group.items.count) para apagar · \(Labels.bytes(group.items.reduce(0) {$0 + $1.finding.sizeBytes}))").font(Theme.mono(10)).foregroundStyle(Theme.muted)
                }
              }
              LazyVGrid(columns: columns, spacing: 3) {ForEach(group.items) {tile($0)}}
            }
          }
        }
        .padding(.horizontal, 12).padding(.bottom, 12)
      } else {
        LazyVGrid(columns: columns, spacing: 3) {ForEach(set.items) {tile($0)}}
          .padding(.horizontal, 12).padding(.bottom, 12)
      }
    }
  }

  // Copies and similar photos, grouped around the photo that stays.
  private var groups: [(keeper: String, keeperName: String, items: [Indexed])] {
    var order: [String] = [], byKeeper: [String: [Indexed]] = [:]
    for item in set.items {
      let keeper = item.finding.metadata["keeper"] ?? item.finding.path
      if byKeeper[keeper] == nil {order.append(keeper)}
      byKeeper[keeper, default: []].append(item)
    }
    return order.map {($0, byKeeper[$0]?.first?.finding.metadata["Fica"] ?? "", byKeeper[$0] ?? [])}
  }

  private func tile(_ item: Indexed) -> some View {
    let on = picked.contains(item.index)
    return Color.clear.aspectRatio(1, contentMode: .fit)
      .overlay(PhotoThumb(path: item.finding.path, side: 130))
      .clipped()
      .overlay(on ? Color.black.opacity(0.25) : .clear)
      .overlay(alignment: .topTrailing) {
        ZStack {
          Circle().fill(on ? Theme.accent : Color.black.opacity(0.25))
          Circle().strokeBorder(on ? Theme.accent : .white.opacity(0.9), lineWidth: 1.5)
          if on {Image(systemName: "checkmark").font(.system(size: 11, weight: .heavy)).foregroundStyle(Color(hex: 0x20251b))}
        }
        .frame(width: 22, height: 22).padding(6)
      }
      .overlay(alignment: .bottomLeading) {
        Text(Labels.bytes(item.finding.sizeBytes)).font(Theme.mono(9, .semibold)).foregroundStyle(.white)
          .padding(.horizontal, 4).padding(.vertical, 2)
          .background(.black.opacity(0.55), in: RoundedRectangle(cornerRadius: 3)).padding(4)
      }
      .contentShape(Rectangle())
      .onTapGesture {if on {picked.remove(item.index)} else {picked.insert(item.index)}}
      .onLongPressGesture {preview(item.index)}
      .accessibilityElement()
      .accessibilityLabel("\(item.finding.location), \(Labels.bytes(item.finding.sizeBytes))")
      .accessibilityValue(on ? "para apagar" : "fica")
      .accessibilityAddTraits(.isButton)
      .accessibilityAction(named: "Abrir para conferir") {preview(item.index)}
  }
}

// Quick mode: one photo at a time; swipe left (or Apagar) to delete, right (or Manter) to keep.
private struct QuickReview: View {
  let set: AppModel.PhotoSet
  @Binding var picked: Set<Int>
  let preview: (Int) -> Void
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @State private var position = 0
  // Each decision, with whether the photo was picked before, so Desfazer restores it.
  @State private var history: [(index: Int, wasPicked: Bool)] = []
  @State private var drag = CGSize.zero

  var body: some View {
    VStack(spacing: 12) {
      if position < set.items.count {
        let item = set.items[position]
        Text("\(position + 1) de \(set.items.count)").label()
        GeometryReader {geometry in
          PhotoThumb(path: item.finding.path, side: max(geometry.size.width, geometry.size.height), fill: false)
            .frame(width: geometry.size.width, height: geometry.size.height)
            .background(Color(hex: 0x111315))
            .clipShape(RoundedRectangle(cornerRadius: 10))
            .overlay(alignment: .topLeading) {stamp("APAGAR", Theme.danger).opacity(drag.width < -30 ? min(1, -drag.width / 120) : 0)}
            .overlay(alignment: .topTrailing) {stamp("MANTER", Theme.accent).opacity(drag.width > 30 ? min(1, drag.width / 120) : 0)}
            .offset(x: drag.width, y: drag.height * 0.2)
            .rotationEffect(.degrees(reduceMotion ? 0 : Double(drag.width) / 25))
            .gesture(DragGesture()
              .onChanged {drag = $0.translation}
              .onEnded {value in
                if value.translation.width < -110 {decide(delete: true)} else if value.translation.width > 110 {decide(delete: false)} else {withAnimation(.spring) {drag = .zero}}
              })
            .onTapGesture(count: 2) {preview(item.index)}
            .id(item.index)
        }
        VStack(spacing: 2) {
          Text(item.finding.location).font(Theme.mono(11)).foregroundStyle(Color(hex: 0xd4d9e0)).lineLimit(1)
          Text("\(Labels.bytes(item.finding.sizeBytes))\(item.finding.modifiedDate.map {" · \(Labels.dateTime($0))"} ?? "")").font(Theme.mono(10)).foregroundStyle(Theme.muted)
        }
        HStack(spacing: 10) {
          Button("✕ Apagar") {decide(delete: true)}.devButton(fontSize: 14, minHeight: 48, fill: true)
          Button("Desfazer") {undo()}.devButton(.subtle, minHeight: 48).disabled(history.isEmpty)
          Button("✓ Manter") {decide(delete: false)}.devButton(fontSize: 14, minHeight: 48, fill: true)
        }
      } else {
        Spacer()
        Text("Pronto, revisou tudo!").font(Theme.sans(18, .semibold)).foregroundStyle(Color(hex: 0xe7e9ec))
        Text("\(picked.count) para apagar. Toque no botão abaixo para mandar para Apagados.").font(Theme.sans(12)).foregroundStyle(Theme.muted).multilineTextAlignment(.center)
        Button("Desfazer a última") {undo()}.devButton(.subtle, minHeight: 40).disabled(history.isEmpty)
        Spacer()
      }
    }
    .padding(.horizontal, 12)
  }

  private func stamp(_ text: String, _ color: Color) -> some View {
    Text(text).font(Theme.mono(16, .bold)).foregroundStyle(color)
      .padding(.horizontal, 8).padding(.vertical, 4)
      .overlay(RoundedRectangle(cornerRadius: 4).strokeBorder(color, lineWidth: 2))
      .padding(14)
  }

  private func decide(delete: Bool) {
    guard position < set.items.count else {return}
    let index = set.items[position].index
    history.append((index, picked.contains(index)))
    if delete {picked.insert(index)} else {picked.remove(index)}
    drag = .zero
    if reduceMotion {position += 1} else {withAnimation(.easeOut(duration: 0.2)) {position += 1}}
  }

  private func undo() {
    guard let last = history.popLast() else {return}
    position = max(0, position - 1)
    if last.wasPicked {picked.insert(last.index)} else {picked.remove(last.index)}
  }
}
#endif
