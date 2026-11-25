import SwiftUI

struct DayView: View {
    @Environment(AppModel.self) private var model
    @State private var sorting: Summary.Item?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    if model.pairing == nil {
                        NotPaired()
                    } else if let day = model.day {
                        if case .failed(let message) = model.load {
                            Text(message).font(.footnote).foregroundStyle(Palette.ink2)
                        }
                        content(day)
                    } else if case .failed(let message) = model.load {
                        Text("No data yet").font(.system(.title, design: .rounded, weight: .bold))
                        Text(message).foregroundStyle(Palette.ink2)
                    } else {
                        ProgressView().frame(maxWidth: .infinity).padding(.top, 80)
                    }
                }
                .padding(16)
            }
            .background(Palette.page)
            .refreshable { await model.refresh() }
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button { model.step(days: -1) } label: { Image(systemName: "chevron.left") }
                        .accessibilityLabel("Earlier day")
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button { model.step(days: 1) } label: { Image(systemName: "chevron.right") }
                        .disabled(model.isToday)
                        .accessibilityLabel("Later day")
                }
            }
            .confirmationDialog(sorting?.name ?? "", isPresented: Binding(get: { sorting != nil }, set: { if !$0 { sorting = nil } }), titleVisibility: .visible) {
                ForEach(Bucket.choices) { bucket in
                    Button(bucket.title) {
                        if let item = sorting { Task { await model.sort(item, into: bucket) } }
                    }
                }
            } message: {
                Text("Where does this belong? Applies to past and future time.")
            }
        }
    }

    private var title: String {
        if model.isToday { return "Today" }
        if Calendar.current.isDateInYesterday(model.date) { return "Yesterday" }
        return model.date.formatted(.dateTime.weekday(.abbreviated).month(.abbreviated).day())
    }

    @ViewBuilder
    private func content(_ day: Summary) -> some View {
        Text(verdict(day))
            .font(.system(.title, design: .rounded, weight: .bold))
            .foregroundStyle(Palette.ink)
            .fixedSize(horizontal: false, vertical: true)

        Panel {
            TapeView(summary: day).padding(14)
        }

        LazyVGrid(columns: [GridItem(.flexible(), spacing: 10), GridItem(.flexible())], spacing: 10) {
            ForEach(Bucket.choices) { bucket in
                Panel {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(bucket.title).font(.subheadline.weight(.semibold)).foregroundStyle(Palette.ink2)
                        Text(formatDuration(day.total(bucket)))
                            .font(.system(.title, design: .rounded, weight: .bold))
                            .foregroundStyle(Palette.ink)
                        Text("\(Int((day.share(bucket) * 100).rounded()))% of your day").font(.caption).foregroundStyle(Palette.ink2)
                        Meter(value: day.share(bucket), color: Palette.color(bucket)).padding(.top, 6)
                    }
                    .padding(14)
                }
            }
        }

        Text(devices(day)).font(.footnote).foregroundStyle(Palette.ink2)

        SectionTitle(text: "Where the time leaked")
        if day.leaks.isEmpty {
            Panel { Text("Nothing worth calling a leak yet.").foregroundStyle(Palette.ink2).padding(14) }
        } else {
            Panel {
                ForEach(Array(day.leaks.enumerated()), id: \.element.id) { index, leak in
                    if index > 0 { Divider().overlay(Palette.line) }
                    VStack(alignment: .leading, spacing: 4) {
                        if leak.ms > 0 {
                            Text(formatDuration(leak.ms))
                                .font(.system(.title3, design: .rounded, weight: .bold))
                                .foregroundStyle(Palette.color(.lost))
                        }
                        Text(leak.title).font(.headline).foregroundStyle(Palette.ink)
                        Text(leak.detail).font(.subheadline).foregroundStyle(Palette.ink2)
                        if let fix = leak.fix {
                            (Text("Fix: ").fontWeight(.bold).foregroundColor(Palette.color(.money)) + Text(fix))
                                .font(.subheadline)
                                .foregroundStyle(Palette.ink)
                        }
                    }
                    .padding(14)
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
        }

        if !day.top.isEmpty {
            SectionTitle(text: "What you spent it on")
            Text("Tap one to change where it belongs.").font(.footnote).foregroundStyle(Palette.ink2)
            Panel { ItemRows(items: Array(day.top.prefix(12))) { sorting = $0 } }
        }

        if !day.calls.isEmpty {
            SectionTitle(text: "Who you were on the phone with")
            Panel { ItemRows(items: day.calls) { sorting = $0 } }
        }
    }

    private func verdict(_ day: Summary) -> String {
        guard day.awakeMs >= 5 * 60_000 else { return day.headline }
        return "Out of \(formatDuration(day.awakeMs)) awake, \(formatDuration(day.total(.money))) made money and \(formatDuration(day.total(.lost))) was lost."
    }

    private func devices(_ day: Summary) -> String {
        var parts: [String] = []
        let d = day.devices
        if d.mac.activeMs > 0 || d.mac.openIdleMs > 0 {
            var text = "Laptop: \(formatDuration(d.mac.activeMs)) in use"
            if d.mac.openIdleMs >= 60_000 { text += ", \(formatDuration(d.mac.openIdleMs)) open with nobody at it" }
            parts.append(text + ".")
        }
        if d.iphone.activeMs > 0 { parts.append("iPhone: \(formatDuration(d.iphone.activeMs)) in your hand, picked up \(d.iphone.pickups) times.") }
        if d.calls.ms > 0 { parts.append("Calls: \(formatDuration(d.calls.ms)) across \(d.calls.count).") }
        if day.total(.away) >= 60_000 { parts.append("Off every screen: \(formatDuration(day.total(.away))).") }
        return parts.joined(separator: " ")
    }
}

/// The day as one line, midnight to midnight, coloured by where the time went.
struct TapeView: View {
    var summary: Summary

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Canvas { context, size in
                let span = max(1, summary.to - summary.from)
                for run in summary.timeline ?? [] {
                    let x = (run.s - summary.from) / span * size.width
                    let w = max(0.5, (run.e - run.s) / span * size.width)
                    context.fill(Path(CGRect(x: x, y: 0, width: w, height: size.height)), with: .color(Palette.color(run.bucket)))
                }
                if summary.now < summary.to {
                    let x = (summary.now - summary.from) / span * size.width
                    context.fill(Path(CGRect(x: x, y: 0, width: 2, height: size.height)), with: .color(Palette.ink))
                }
            }
            .frame(height: 44)
            .background(Palette.page)
            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
            .accessibilityLabel("Your day from midnight to midnight, coloured by where the time went")

            HStack {
                Text("12am"); Spacer(); Text("6am"); Spacer(); Text("12pm"); Spacer(); Text("6pm"); Spacer(); Text("12am")
            }
            .font(.caption2)
            .foregroundStyle(Palette.ink2)

            LegendFlow(buckets: [.money, .life, .busy, .lost, .unsorted, .away, .sleep].filter { summary.total($0) > 0 })
        }
    }
}

struct LegendFlow: View {
    var buckets: [Bucket]

    var body: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 104), alignment: .leading)], alignment: .leading, spacing: 4) {
            ForEach(buckets) { bucket in
                HStack(spacing: 5) {
                    RoundedRectangle(cornerRadius: 3).fill(Palette.color(bucket)).frame(width: 10, height: 10)
                    Text(bucket.title).font(.caption).foregroundStyle(Palette.ink2).lineLimit(1)
                }
            }
        }
    }
}

struct Meter: View {
    var value: Double
    var color: Color

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule().fill(Palette.page)
                Capsule().fill(color).frame(width: geo.size.width * min(1, max(0, value)))
            }
        }
        .frame(height: 6)
    }
}

struct ItemRows: View {
    var items: [Summary.Item]
    var tap: (Summary.Item) -> Void

    var body: some View {
        let top = max(1, items.map(\.ms).max() ?? 1)
        ForEach(items) { item in
            Button {
                tap(item)
            } label: {
                VStack(alignment: .leading, spacing: 5) {
                    HStack(alignment: .firstTextBaseline) {
                        Text(item.name).font(.subheadline.weight(.semibold)).foregroundStyle(Palette.ink).lineLimit(1)
                        Text(item.bucketValue.short).font(.caption).foregroundStyle(Palette.ink2)
                        Spacer()
                        Text(formatDuration(item.ms)).font(.subheadline.weight(.semibold)).foregroundStyle(Palette.ink).monospacedDigit()
                    }
                    Meter(value: item.ms / top, color: Palette.color(item.bucketValue))
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 9)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(item.kind == "manual")
        }
    }
}

struct NotPaired: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Connect to your computer")
                .font(.system(.title, design: .rounded, weight: .bold))
                .foregroundStyle(Palette.ink)
            Text("The tracking happens on your computer. This app shows the results, logs your drives, and lets you say what you did off screen.")
                .foregroundStyle(Palette.ink2)
            Panel {
                VStack(alignment: .leading, spacing: 10) {
                    Label("Open WDMTG on your computer and go to Setup.", systemImage: "1.circle.fill")
                    Label("Point this phone's Camera at the code under \"Your phone\".", systemImage: "2.circle.fill")
                    Label("On the page that opens, tap Setup, then \"Connect the iPhone app\".", systemImage: "3.circle.fill")
                }
                .foregroundStyle(Palette.ink)
                .padding(14)
            }
        }
    }
}
