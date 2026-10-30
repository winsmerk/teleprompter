import AVFoundation
import Combine
import Photos
import UIKit

/// Main-thread UI state; capture configuration and recording live on the worker's queue.
@MainActor
final class CameraRecorder: ObservableObject {
    let session: AVCaptureSession
    @Published private(set) var isReady = false
    @Published private(set) var isRecording = false
    @Published private(set) var isBusy = false
    @Published private(set) var isFrontCamera = true
    @Published private(set) var needsSettings = false
    @Published private(set) var error: String?
    @Published private(set) var status = "准备相机和麦克风"
    @Published private(set) var savedURL: URL?

    var exportableURL: URL? { savedURL }
    var settingsURL: URL? { URL(string: UIApplication.openSettingsURLString) }

    private let worker: CameraSessionWorker
    private var requestGeneration = 0
    private var wantsSession = false
    private var preparing = false
    private var resumeRequested = false
    private var backgroundTask: UIBackgroundTaskIdentifier = .invalid

    init() {
        let captureSession = AVCaptureSession()
        session = captureSession
        worker = CameraSessionWorker(session: captureSession)
        worker.onEvent = { [weak self] event in
            Task { @MainActor [weak self] in self?.handle(event) }
        }
    }

    func prepare() async {
        wantsSession = true
        guard !preparing, !isRecording, !isBusy else {
            resumeRequested = !isRecording
            return
        }
        resumeRequested = false
        requestGeneration += 1
        let generation = requestGeneration
        preparing = true
        isBusy = true
        error = nil
        needsSettings = false
        status = "正在准备相机和麦克风…"
        defer {
            preparing = false
            if generation == requestGeneration { isBusy = false }
            resumeIfRequested()
        }

        for (mediaType, name) in [(AVMediaType.video, "相机"), (.audio, "麦克风")] {
            let authorization = AVCaptureDevice.authorizationStatus(for: mediaType)
            let allowed: Bool
            if authorization == .notDetermined {
                allowed = await AVCaptureDevice.requestAccess(for: mediaType)
            } else {
                allowed = authorization == .authorized
            }
            DiagnosticLog.shared.log("camera.permission", ["mediaType": mediaType.rawValue, "allowed": allowed])
            guard generation == requestGeneration, wantsSession else { return }
            guard allowed else {
                isReady = false
                needsSettings = true
                error = "尚未获得\(name)权限。请在“设置 → 随行提词”中允许访问\(name)，然后返回重试。"
                status = "需要\(name)权限"
                DiagnosticLog.shared.log("camera.permission.denied", ["mediaType": mediaType.rawValue])
                return
            }
        }

        do {
            let front = try await worker.configureAndStart()
            guard generation == requestGeneration, wantsSession else { return }
            isFrontCamera = front
            isReady = true
            status = "相机已就绪，点击开始录制"
        } catch {
            guard generation == requestGeneration, wantsSession else { return }
            isReady = false
            self.error = error.localizedDescription
            status = "相机未能启动，可重试"
            DiagnosticLog.shared.log("camera.prepare.failed", ["description": error.localizedDescription])
        }
    }

    func startSession() {
        wantsSession = true
        if preparing || isBusy {
            resumeRequested = true
            return
        }
        Task { await prepare() }
    }

    /// Finalizes a pending take before stopping capture when the screen disappears.
    func stopSession() {
        wantsSession = false
        resumeRequested = false
        requestGeneration += 1
        isReady = false
        if isRecording || (isBusy && !preparing) {
            isBusy = true
            status = "正在结束录制并保留视频…"
        } else {
            isBusy = false
            status = "相机已暂停"
        }
        worker.stopSession()
    }

    func switchCamera() {
        guard isReady, !isRecording, !isBusy else { return }
        isBusy = true
        error = nil
        worker.switchCamera { [weak self] result in
            Task { @MainActor [weak self] in
                guard let self else { return }
                self.isBusy = false
                switch result {
                case .success(let front):
                    self.isFrontCamera = front
                    self.status = front ? "已切换到前置相机" : "已切换到后置相机"
                case .failure(let issue): self.error = issue.localizedDescription
                }
            }
        }
    }

    func startRecording() {
        guard isReady, !isRecording, !isBusy else { return }
        isBusy = true
        error = nil
        status = "正在开始录制…"
        beginRecordingBackgroundTask()
        worker.startRecording()
    }

    func stopRecording() {
        guard isRecording, !isBusy else { return }
        isBusy = true
        status = "正在完成视频…"
        worker.stopRecording()
    }

    func clearError() { error = nil }

    private func resumeIfRequested() {
        guard resumeRequested, wantsSession, !preparing, !isBusy, !isRecording else { return }
        resumeRequested = false
        Task { await prepare() }
    }

    private func beginRecordingBackgroundTask() {
        guard backgroundTask == .invalid else { return }
        backgroundTask = UIApplication.shared.beginBackgroundTask(withName: "完成视频文件") { [weak self] in
            Task { @MainActor [weak self] in
                guard let self else { return }
                DiagnosticLog.shared.log("camera.backgroundTask.expired")
                self.worker.stopRecording()
                self.endRecordingBackgroundTask()
            }
        }
    }

    private func endRecordingBackgroundTask() {
        guard backgroundTask != .invalid else { return }
        UIApplication.shared.endBackgroundTask(backgroundTask)
        backgroundTask = .invalid
    }

    private func handle(_ event: CameraWorkerEvent) {
        switch event {
        case .recordingStarted:
            isRecording = true
            isBusy = !wantsSession
            status = wantsSession ? "正在录制" : "正在结束录制…"
        case .recordingFinished(let result):
            endRecordingBackgroundTask()
            isRecording = false
            if result.fileExists { savedURL = result.url }
            guard result.playable else {
                isBusy = false
                error = "录制未能完整写入：\(result.warning ?? "没有可播放的视频数据")。"
                    + (result.fileExists ? "原始文件已保留在“文件 → 我的 iPhone → 随行提词 → Recordings”，也可通过分享导出。" : "请重试。")
                status = result.fileExists ? "录制未完成，原始文件已保留" : "录制未完成"
                resumeIfRequested()
                return
            }
            isBusy = true
            status = "视频已保留，正在保存到相册…"
            Task { await saveToPhotos(result) }
        case .failure(let message):
            endRecordingBackgroundTask()
            isBusy = false
            error = message
            status = "操作未完成，可重试"
            resumeIfRequested()
        case .interrupted(let message):
            isReady = false
            error = message
            if isRecording { isBusy = true }
            status = "相机被中断"
        case .stopped:
            isReady = false
            if !isRecording && !isBusy { status = "相机已暂停" }
        }
    }

    private func saveToPhotos(_ result: CameraRecordingResult) async {
        let authorization = await PHPhotoLibrary.requestAuthorization(for: .addOnly)
        DiagnosticLog.shared.log("camera.photos.authorization", ["status": authorization.rawValue])
        guard authorization == .authorized || authorization == .limited else {
            isBusy = false
            needsSettings = true
            error = "视频已保存到本机，尚未获得相册添加权限。可分享导出，或到“设置 → 随行提词 → 照片”允许添加后再保存。"
            status = "视频已保留在本机，可分享导出"
            DiagnosticLog.shared.log("camera.photos.denied", ["file": result.url.lastPathComponent, "localFileRetained": true])
            resumeIfRequested()
            return
        }
        do {
            try await PHPhotoLibrary.shared().performChanges {
                let request = PHAssetCreationRequest.forAsset()
                let options = PHAssetResourceCreationOptions()
                options.shouldMoveFile = false
                request.addResource(with: .video, fileURL: result.url, options: options)
            }
            status = "视频已保存到相册，本机也保留了一份"
            DiagnosticLog.shared.log("camera.photos.saved", ["file": result.url.lastPathComponent, "localFileRetained": true])
            if let warning = result.warning { error = "录制提前结束：\(warning)。已保留可播放的视频。" }
        } catch {
            self.error = "保存到相册失败：\(error.localizedDescription)。视频仍保留在本机，可通过分享导出。"
            status = "视频已保留在本机，可分享导出"
            DiagnosticLog.shared.log("camera.photos.failed", ["file": result.url.lastPathComponent, "description": error.localizedDescription, "localFileRetained": true])
        }
        isBusy = false
        resumeIfRequested()
    }
}

private struct CameraIssue: LocalizedError {
    let message: String
    var errorDescription: String? { message }
}

private struct CameraRecordingResult: Sendable {
    let url: URL
    let playable: Bool
    let fileExists: Bool
    let warning: String?
}

private enum CameraWorkerEvent: Sendable {
    case recordingStarted
    case recordingFinished(CameraRecordingResult)
    case failure(String)
    case interrupted(String)
    case stopped
}

/// All mutable capture state and AVCaptureMovieFileOutput access belong to queue.
/// onEvent is installed once, before any queued operations begin.
private final class CameraSessionWorker: NSObject, AVCaptureFileOutputRecordingDelegate, @unchecked Sendable {
    let session: AVCaptureSession
    var onEvent: ((CameraWorkerEvent) -> Void)?
    private let queue = DispatchQueue(label: "teleprompter.camera-session", qos: .userInitiated)
    private let output = AVCaptureMovieFileOutput()
    private var videoInput: AVCaptureDeviceInput?
    private var configured = false
    private var wantsRunning = false
    private var recordingRequested = false
    private var stopAfterRecording = false
    private var observers: [NSObjectProtocol] = []

    init(session: AVCaptureSession) {
        self.session = session
        super.init()
        for name in [AVCaptureSession.runtimeErrorNotification, AVCaptureSession.wasInterruptedNotification] {
            observers.append(NotificationCenter.default.addObserver(forName: name, object: session, queue: nil) { [weak self] note in
                self?.queue.async { [weak self] in self?.handleNotification(note) }
            })
        }
    }

    func configureAndStart() async throws -> Bool {
        try await withCheckedThrowingContinuation { continuation in
            queue.async {
                self.wantsRunning = true
                self.stopAfterRecording = false
                do {
                    if !self.configured { try self.configure() }
                    DiagnosticLog.shared.log("camera.session.startRequested")
                    if !self.session.isRunning { self.session.startRunning() }
                    guard self.session.isRunning else { throw CameraIssue(message: "相机当前不可用。请结束其他相机或通话后重试。") }
                    DiagnosticLog.shared.log("camera.session.ready", ["running": self.session.isRunning, "front": self.videoInput?.device.position == .front])
                    continuation.resume(returning: self.videoInput?.device.position == .front)
                } catch { continuation.resume(throwing: error) }
            }
        }
    }

    private func configure() throws {
        session.beginConfiguration()
        defer { session.commitConfiguration() }
        do {
            if session.canSetSessionPreset(.hd1920x1080) { session.sessionPreset = .hd1920x1080 }
            session.automaticallyConfiguresApplicationAudioSession = true
            guard let camera = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .front)
                ?? AVCaptureDevice.default(for: .video) else { throw CameraIssue(message: "没有找到可用的相机。") }
            let video = try AVCaptureDeviceInput(device: camera)
            guard session.canAddInput(video) else { throw CameraIssue(message: "无法接入相机，请稍后重试。") }
            session.addInput(video)
            videoInput = video
            guard let microphone = AVCaptureDevice.default(for: .audio) else { throw CameraIssue(message: "没有找到可用的麦克风。") }
            let audio = try AVCaptureDeviceInput(device: microphone)
            guard session.canAddInput(audio) else { throw CameraIssue(message: "无法接入麦克风，请结束其他录音或通话后重试。") }
            session.addInput(audio)
            guard session.canAddOutput(output) else { throw CameraIssue(message: "当前设备无法录制视频。") }
            session.addOutput(output)
            configureMovieConnection()
            configured = true
        } catch {
            for input in session.inputs { session.removeInput(input) }
            if session.outputs.contains(output) { session.removeOutput(output) }
            videoInput = nil
            throw error
        }
    }

    private func configureMovieConnection() {
        guard let connection = output.connection(with: .video) else { return }
        if connection.isVideoRotationAngleSupported(90) { connection.videoRotationAngle = 90 }
        if connection.isVideoMirroringSupported {
            connection.automaticallyAdjustsVideoMirroring = false
            connection.isVideoMirrored = false
        }
        if connection.isVideoStabilizationSupported { connection.preferredVideoStabilizationMode = .auto }
        if output.availableVideoCodecTypes.contains(.hevc) {
            output.setOutputSettings([AVVideoCodecKey: AVVideoCodecType.hevc], for: connection)
        }
    }

    func switchCamera(completion: @escaping (Result<Bool, Error>) -> Void) {
        queue.async {
            guard self.configured, self.wantsRunning, !self.recordingRequested, !self.output.isRecording,
                  let oldInput = self.videoInput else {
                completion(.failure(CameraIssue(message: "请在相机就绪、未录制时切换镜头。"))); return
            }
            let position: AVCaptureDevice.Position = oldInput.device.position == .front ? .back : .front
            do {
                guard let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: position) else {
                    throw CameraIssue(message: "此设备没有可用的\(position == .front ? "前置" : "后置")相机。")
                }
                let replacement = try AVCaptureDeviceInput(device: device)
                self.session.beginConfiguration()
                self.session.removeInput(oldInput)
                if self.session.canAddInput(replacement) {
                    self.session.addInput(replacement)
                    self.videoInput = replacement
                    self.configureMovieConnection()
                    self.session.commitConfiguration()
                    DiagnosticLog.shared.log("camera.cameraSwitched", ["front": position == .front])
                    completion(.success(position == .front))
                } else {
                    let restored = self.session.canAddInput(oldInput)
                    if restored { self.session.addInput(oldInput) }
                    self.session.commitConfiguration()
                    throw CameraIssue(message: restored ? "切换镜头失败，已保留原镜头。" : "切换镜头失败，请退出拍摄页面后重试。")
                }
            } catch { completion(.failure(error)) }
        }
    }

    func startRecording() {
        queue.async {
            guard self.wantsRunning, self.session.isRunning, !self.recordingRequested, !self.output.isRecording else {
                self.onEvent?(.failure("相机尚未就绪，请稍后重试。")); return
            }
            do {
                let folder = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("Recordings", isDirectory: true)
                try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
                let formatter = DateFormatter()
                formatter.locale = Locale(identifier: "en_US_POSIX")
                formatter.dateFormat = "yyyyMMdd-HHmmss"
                let name = "随行提词-\(formatter.string(from: Date()))-\(UUID().uuidString.prefix(6)).mov"
                let url = folder.appendingPathComponent(name)
                self.configureMovieConnection()
                self.recordingRequested = true
                DiagnosticLog.shared.log("camera.recording.requested", ["file": url.lastPathComponent])
                self.output.startRecording(to: url, recordingDelegate: self)
            } catch {
                DiagnosticLog.shared.log("camera.recording.failed", ["description": error.localizedDescription])
                self.onEvent?(.failure("无法创建视频文件：\(error.localizedDescription)"))
            }
        }
    }

    func stopRecording() {
        queue.async {
            DiagnosticLog.shared.log("camera.recording.stopRequested", ["recordingRequested": self.recordingRequested])
            if self.recordingRequested || self.output.isRecording { self.output.stopRecording() }
        }
    }

    func stopSession() {
        queue.async {
            self.wantsRunning = false
            DiagnosticLog.shared.log("camera.session.stopRequested", ["recordingRequested": self.recordingRequested])
            if self.recordingRequested || self.output.isRecording {
                self.stopAfterRecording = true
                self.output.stopRecording()
            } else {
                if self.session.isRunning { self.session.stopRunning() }
                self.onEvent?(.stopped)
            }
        }
    }

    private func handleNotification(_ notification: Notification) {
        let message: String
        if notification.name == AVCaptureSession.runtimeErrorNotification {
            let issue = notification.userInfo?[AVCaptureSessionErrorKey] as? NSError
            message = "相机运行中断：\(issue?.localizedDescription ?? "设备暂时不可用")。视频会保留，请返回相机重试。"
        } else {
            message = "相机或麦克风被来电、锁屏或其他应用中断，录制会自动结束并保留视频。"
        }
        wantsRunning = false
        DiagnosticLog.shared.log("camera.session.interrupted", ["notification": notification.name.rawValue, "description": message])
        onEvent?(.interrupted(message))
        if recordingRequested || output.isRecording {
            stopAfterRecording = true
            output.stopRecording()
        } else if session.isRunning {
            session.stopRunning()
        }
    }

    func fileOutput(_ output: AVCaptureFileOutput, didStartRecordingTo fileURL: URL, from connections: [AVCaptureConnection]) {
        queue.async {
            DiagnosticLog.shared.log("camera.recording.started", ["file": fileURL.lastPathComponent])
            self.onEvent?(.recordingStarted)
        }
    }

    func fileOutput(_ output: AVCaptureFileOutput, didFinishRecordingTo outputFileURL: URL, from connections: [AVCaptureConnection], error: Error?) {
        queue.async {
            self.recordingRequested = false
            let issue = error as NSError?
            let completed = issue == nil || (issue?.userInfo[AVErrorRecordingSuccessfullyFinishedKey] as? Bool == true)
            let attributes = try? FileManager.default.attributesOfItem(atPath: outputFileURL.path)
            let exists = attributes != nil
            let size = (attributes?[.size] as? NSNumber)?.int64Value ?? 0
            var fields: [String: Any] = ["file": outputFileURL.lastPathComponent, "bytes": size, "playable": completed && size > 0, "localFileRetained": exists]
            if let issue { fields["error"] = ["domain": issue.domain, "code": issue.code, "description": issue.localizedDescription] }
            DiagnosticLog.shared.log("camera.recording.finished", fields)
            let result = CameraRecordingResult(url: outputFileURL, playable: completed && size > 0, fileExists: exists, warning: issue?.localizedDescription)
            self.onEvent?(.recordingFinished(result))
            if self.stopAfterRecording || !self.wantsRunning {
                self.stopAfterRecording = false
                if self.session.isRunning { self.session.stopRunning() }
                self.onEvent?(.stopped)
            }
        }
    }

    deinit {
        for observer in observers { NotificationCenter.default.removeObserver(observer) }
    }
}
