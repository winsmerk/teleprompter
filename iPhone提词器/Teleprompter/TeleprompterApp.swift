import SwiftUI
import AVFoundation
import Combine

@main
struct TeleprompterApp: App {
    init() { _ = DiagnosticLog.shared }
    var body: some Scene { WindowGroup { ContentView() } }
}

struct ContentView: View {
    @AppStorage("script") private var script = "欢迎来到我的视频。\n\n把想说的话写在这里，调整到舒服的速度，再开始拍摄。\n\n放松，看向镜头，按照自己的节奏表达。"
    @AppStorage("speed") private var speed = 32.0
    @AppStorage("fontSize") private var fontSize = 38.0
    @StateObject private var recorder = CameraRecorder()
    @State private var showingCamera = false
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    Text("看向镜头，自然表达。").font(.title2.bold())
                    Text("在这里拍摄，一边看稿，一边表达。提词只显示在取景画面上，录好的视频不带文字。")
                        .foregroundStyle(.secondary)
                    GroupBox("我的文案") {
                        TextEditor(text: $script).frame(minHeight: 210).padding(4)
                            .accessibilityLabel("提词文案")
                    }
                    VStack(alignment: .leading, spacing: 12) {
                        Text("滚动速度 · \(Int(speed)) 点/秒")
                        Slider(value: $speed, in: 5...100, step: 1).accessibilityLabel("滚动速度")
                        Text("字号 · \(Int(fontSize))")
                        Slider(value: $fontSize, in: 24...64, step: 1).accessibilityLabel("提词字号")
                    }
                    Button { showingCamera = true } label: {
                        Label("进入拍摄", systemImage: "video.fill").frame(maxWidth: .infinity).padding(10)
                    }.buttonStyle(.borderedProminent)
                        .disabled(script.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    Text("支持前后摄像头、竖屏录像，拍摄时可调整提词速度。停止录制后保存到相册。")
                        .font(.footnote).foregroundStyle(.secondary)
                    if let url = recorder.savedURL {
                        GroupBox("最近录制") {
                            VStack(alignment: .leading, spacing: 10) {
                                Text(recorder.status).font(.callout)
                                ShareLink(item: url) { Label("导出视频", systemImage: "square.and.arrow.up") }
                            }.frame(maxWidth: .infinity, alignment: .leading)
                        }
                    }
                    DisclosureGroup("诊断日志") {
                        VStack(alignment: .leading, spacing: 10) {
                            Text("版本 2.0 · 本机记录运行与录制状态，不记录提词文案。")
                                .font(.footnote).foregroundStyle(.secondary)
                            ShareLink("导出诊断日志", item: DiagnosticLog.shared.fileURL)
                        }.frame(maxWidth: .infinity, alignment: .leading).padding(.top, 8)
                    }.font(.callout)
                }.padding()
            }
            .navigationTitle("随行提词").tint(.teal)
            .fullScreenCover(isPresented: $showingCamera) {
                CameraScreen(recorder: recorder, script: script, speed: $speed, fontSize: $fontSize)
            }
        }
    }
}

private struct CameraScreen: View {
    @ObservedObject var recorder: CameraRecorder
    let script: String
    @Binding var speed: Double
    @Binding var fontSize: Double
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var scenePhase
    @State private var scrolling = false
    @State private var resetID = 0
    @State private var recordingStarted: Date?
    @State private var showingSettings = false
    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            CameraPreview(session: recorder.session, mirrored: recorder.isFrontCamera).ignoresSafeArea()
            VStack(spacing: 12) {
                HStack {
                    Button { dismiss() } label: { Image(systemName: "xmark").frame(width: 44, height: 44) }
                        .disabled(recorder.isRecording || recorder.isBusy)
                    Spacer()
                    if let start = recordingStarted {
                        HStack(spacing: 6) {
                            Circle().fill(.red).frame(width: 8, height: 8)
                            Text(start, style: .timer).monospacedDigit()
                        }.padding(.horizontal, 12).padding(.vertical, 8)
                            .background(.black.opacity(0.6), in: Capsule())
                    } else { Text("竖屏拍摄").font(.callout) }
                    Spacer()
                    Button { recorder.switchCamera() } label: {
                        Image(systemName: "arrow.triangle.2.circlepath.camera").frame(width: 44, height: 44)
                    }.disabled(recorder.isRecording || recorder.isBusy || !recorder.isReady)
                        .accessibilityLabel("切换前后摄像头")
                }
                ScrollingPrompt(script: script, speed: speed, fontSize: fontSize, playing: scrolling, resetID: resetID)
                    .frame(height: 190)
                    .background(.black.opacity(0.65), in: RoundedRectangle(cornerRadius: 16))
                HStack(spacing: 24) {
                    Button {
                        scrolling.toggle()
                        DiagnosticLog.shared.log("prompt.playback", ["playing": scrolling])
                    } label: {
                        Label(scrolling ? "暂停提词" : "播放提词", systemImage: scrolling ? "pause.fill" : "play.fill")
                    }
                    Button { resetID += 1 } label: { Label("重播", systemImage: "backward.end.fill") }
                    Spacer()
                    Button { showingSettings.toggle() } label: { Image(systemName: "slider.horizontal.3") }
                        .accessibilityLabel("调整提词设置")
                }.font(.callout).padding(12)
                    .background(.black.opacity(0.6), in: RoundedRectangle(cornerRadius: 12))
                if showingSettings {
                    VStack(alignment: .leading) {
                        Text("速度 · \(Int(speed)) 点/秒")
                        Slider(value: $speed, in: 5...100, step: 1)
                    }.font(.callout).padding(14)
                        .background(.black.opacity(0.8), in: RoundedRectangle(cornerRadius: 12))
                }
                Spacer(minLength: 0)
                if let error = recorder.error {
                    VStack(spacing: 10) {
                        Text(error).font(.callout).multilineTextAlignment(.center)
                        if recorder.needsSettings {
                            Button("前往系统设置") {
                                if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) }
                            }.buttonStyle(.bordered)
                        }
                    }.padding().background(.black.opacity(0.8), in: RoundedRectangle(cornerRadius: 12))
                }
                if !recorder.isReady && !recorder.isBusy {
                    Button("重新启动相机") { recorder.startSession() }.buttonStyle(.bordered)
                }
                Text(recorder.status).font(.footnote).multilineTextAlignment(.center)
                    .padding(.horizontal, 12).padding(.vertical, 6)
                    .background(.black.opacity(0.6), in: Capsule())
                HStack {
                    if let url = recorder.savedURL, !recorder.isRecording {
                        ShareLink(item: url) { Image(systemName: "square.and.arrow.up").frame(width: 54, height: 54) }
                            .accessibilityLabel("导出最近视频")
                    } else { Color.clear.frame(width: 54, height: 54) }
                    Spacer()
                    Button {
                        if recorder.isRecording { recorder.stopRecording() }
                        else { resetID += 1; recorder.startRecording() }
                    } label: {
                        ZStack {
                            Circle().stroke(.white, lineWidth: 4).frame(width: 80, height: 80)
                            if recorder.isRecording {
                                RoundedRectangle(cornerRadius: 6).fill(.red).frame(width: 32, height: 32)
                            } else { Circle().fill(.red).frame(width: 66, height: 66) }
                            if recorder.isBusy { ProgressView().tint(.white) }
                        }
                    }.disabled(recorder.isBusy || (!recorder.isRecording && !recorder.isReady))
                        .accessibilityLabel(recorder.isRecording ? "停止录制" : "开始录制")
                    Spacer()
                    Color.clear.frame(width: 54, height: 54)
                }.padding(.bottom, 12)
            }.padding(.horizontal, 16)
        }.foregroundStyle(.white).tint(.white).preferredColorScheme(.dark)
            .task { await recorder.prepare() }
            .onAppear { UIApplication.shared.isIdleTimerDisabled = true }
            .onDisappear {
                scrolling = false; recorder.stopSession()
                UIApplication.shared.isIdleTimerDisabled = false
            }
            .onChange(of: recorder.isRecording) { _, recording in
                recordingStarted = recording ? Date() : nil; scrolling = recording
            }
            .onChange(of: scenePhase) { _, phase in
                if phase == .background { scrolling = false; recorder.stopSession() }
                else if phase == .active { recorder.startSession() }
            }
    }
}

private struct CameraPreview: UIViewRepresentable {
    let session: AVCaptureSession
    let mirrored: Bool
    func makeUIView(context: Context) -> PreviewView {
        let view = PreviewView()
        view.previewLayer.session = session
        view.previewLayer.videoGravity = .resizeAspectFill
        return view
    }
    func updateUIView(_ view: PreviewView, context: Context) {
        guard let connection = view.previewLayer.connection else { return }
        if connection.isVideoRotationAngleSupported(90) { connection.videoRotationAngle = 90 }
        if connection.isVideoMirroringSupported {
            connection.automaticallyAdjustsVideoMirroring = false
            connection.isVideoMirrored = mirrored
        }
    }
    final class PreviewView: UIView {
        override class var layerClass: AnyClass { AVCaptureVideoPreviewLayer.self }
        var previewLayer: AVCaptureVideoPreviewLayer { layer as! AVCaptureVideoPreviewLayer }
    }
}

private struct ScrollingPrompt: View {
    let script: String
    let speed: Double
    let fontSize: Double
    let playing: Bool
    let resetID: Int
    @State private var offset = 0.0
    @State private var textHeight = 0.0
    @State private var lastTick = Date()
    private let ticker = Timer.publish(every: 1.0 / 30, on: .main, in: .common).autoconnect()
    var body: some View {
        GeometryReader { geometry in
            Text(script)
                .font(.system(size: fontSize, weight: .semibold)).lineSpacing(10)
                .frame(width: max(1, geometry.size.width - 32), alignment: .leading)
                .fixedSize(horizontal: false, vertical: true)
                .background(GeometryReader { text in
                    Color.clear.preference(key: PromptHeightKey.self, value: text.size.height)
                })
                .offset(x: 16, y: 16 - offset)
                .onPreferenceChange(PromptHeightKey.self) { textHeight = $0 }
                .onReceive(ticker) { now in
                    let delta = min(max(0, now.timeIntervalSince(lastTick)), 0.1)
                    lastTick = now
                    if playing {
                        offset = min(offset + delta * speed, max(0, textHeight - geometry.size.height + 32))
                    }
                }
                .onChange(of: resetID) { _, _ in offset = 0; lastTick = Date() }
                .onChange(of: playing) { _, _ in lastTick = Date() }
                .onChange(of: fontSize) { _, _ in offset = 0 }
        }.clipped().accessibilityLabel("滚动提词")
    }
}

private struct PromptHeightKey: PreferenceKey {
    static var defaultValue = 0.0
    static func reduce(value: inout Double, nextValue: () -> Double) { value = nextValue() }
}
