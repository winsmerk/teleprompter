import Foundation
import UIKit
import AVFAudio
import Darwin

/// Diagnostic work stays independent of the render queue, including when that queue stalls.
/// This logger never requests background execution or changes playback/audio behavior.
final class DiagnosticLog {
    static let shared = DiagnosticLog()

    let fileURL: URL
    let sessionID: String

    private let ioQueue = DispatchQueue(label: "teleprompter.diagnostic-file", qos: .utility)
    private let watchdogQueue = DispatchQueue(label: "teleprompter.diagnostic-watchdog", qos: .utility)
    private let metricsLock = NSLock()
    private var metrics = FrameMetrics()
    private var watchdog: DispatchSourceTimer?
    private var notificationTokens: [NSObjectProtocol] = []
    private var file: FileHandle?
    private var writtenBytes = 0
    private var capReported = false
    private let maximumFileBytes = 8 * 1024 * 1024
    private let dateFormatter: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()

    private struct FrameMetrics {
        var attempts = 0
        var enqueued = 0
        var ticks = 0
        var activeStage = "idle"
        var stageStarted = ProcessInfo.processInfo.systemUptime
        var frameStarted: Double?
        var frameEnded: Double?
        var lastEnqueued: Double?
        var lastTick: Double?
        var rawDelta = 0.0
        var playing = false
        var offset = 0.0
    }

    private init() {
        sessionID = UUID().uuidString
        let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first
            ?? FileManager.default.temporaryDirectory
        let directory = documents.appendingPathComponent("Diagnostics", isDirectory: true)
        fileURL = directory.appendingPathComponent("session-\(sessionID).jsonl")
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            guard FileManager.default.createFile(atPath: fileURL.path, contents: nil) else {
                throw CocoaError(.fileWriteUnknown)
            }
            // Diagnostic files remain writable after the phone's first unlock.
            try? FileManager.default.setAttributes([.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication], ofItemAtPath: fileURL.path)
            file = try FileHandle(forWritingTo: fileURL)
        } catch {
            fputs("TP_DIAG cannot open diagnostic file: \(error)\n", stderr)
        }
        var hardware = utsname()
        uname(&hardware)
        let machineCapacity = MemoryLayout.size(ofValue: hardware.machine)
        let model = withUnsafePointer(to: &hardware.machine) {
            $0.withMemoryRebound(to: CChar.self, capacity: machineCapacity) {
                String(cString: $0)
            }
        }
        log("session.start", [
            "schemaVersion": 1,
            "file": fileURL.lastPathComponent,
            "os": ProcessInfo.processInfo.operatingSystemVersionString,
            "hardware": model,
            "appVersion": Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "unknown",
            "diagnosticRevision": Bundle.main.object(forInfoDictionaryKey: "TPDiagnosticRevision") as? String ?? "baseline",
            "build": Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "unknown",
            "bundleID": Bundle.main.bundleIdentifier ?? "unknown",
            "debuggerAttached": Self.debuggerIsAttached(),
            "processID": ProcessInfo.processInfo.processIdentifier,
            "scriptContentCollected": false,
            "maximumFileBytes": maximumFileBytes
        ])

        let timer = DispatchSource.makeTimerSource(queue: watchdogQueue)
        timer.schedule(deadline: .now() + 1, repeating: 1, leeway: .milliseconds(50))
        timer.setEventHandler { [weak self] in
            guard let self else { return }
            self.log("heartbeat.watchdog", self.frameSnapshot())
        }
        timer.resume()
        watchdog = timer

        if Thread.isMainThread {
            registerNotifications()
        } else {
            DispatchQueue.main.async { [weak self] in self?.registerNotifications() }
        }
    }

    /// Every record carries its call-site wall/monotonic time, even if I/O runs later.
    func log(_ event: String, _ fields: [String: Any] = [:]) {
        let safeFields = Self.jsonValue(fields, depth: 0)
        let record: [String: Any] = [
            "event": event,
            "uptime": ProcessInfo.processInfo.systemUptime,
            "wallSeconds": Date().timeIntervalSince1970,
            "session": sessionID,
            "mainThread": Thread.isMainThread,
            "threadID": pthread_mach_thread_np(pthread_self()),
            "fields": safeFields
        ]
        ioQueue.async { [weak self] in self?.append(record) }
    }

    func beginFrame() {
        let now = ProcessInfo.processInfo.systemUptime
        metricsLock.lock()
        metrics.attempts += 1
        metrics.frameStarted = now
        metrics.activeStage = "begin"
        metrics.stageStarted = now
        metricsLock.unlock()
    }

    func frameStage(_ stage: String) {
        let now = ProcessInfo.processInfo.systemUptime
        metricsLock.lock()
        metrics.activeStage = stage
        metrics.stageStarted = now
        metricsLock.unlock()
    }

    func endFrame(enqueued: Bool) {
        let now = ProcessInfo.processInfo.systemUptime
        metricsLock.lock()
        if enqueued {
            metrics.enqueued += 1
            metrics.lastEnqueued = now
        }
        metrics.frameEnded = now
        metrics.activeStage = "idle"
        metrics.stageStarted = now
        metricsLock.unlock()
    }

    func tick(rawDelta: Double, playing: Bool, offset: Double) {
        let now = ProcessInfo.processInfo.systemUptime
        metricsLock.lock()
        metrics.ticks += 1
        metrics.lastTick = now
        metrics.rawDelta = rawDelta
        metrics.playing = playing
        metrics.offset = offset
        metricsLock.unlock()
    }

    func noteError(_ error: Error?, where location: String) {
        log("renderer.error", [
            "where": location,
            "error": error.map { Self.errorFields($0 as NSError, depth: 0) } ?? NSNull()
        ])
    }

    /// Must be called on main; the watchdog never reads UIApplication/UIScene.
    func snapshotUI() -> [String: Any] {
        precondition(Thread.isMainThread, "UI diagnostic snapshots must run on main")
        let app = UIApplication.shared
        let state: String
        switch app.applicationState {
        case .active: state = "active"
        case .inactive: state = "inactive"
        case .background: state = "background"
        @unknown default: state = "unknown"
        }
        let scenes = app.connectedScenes.map { scene -> [String: Any] in
            let activation: String
            switch scene.activationState {
            case .unattached: activation = "unattached"
            case .foregroundActive: activation = "foregroundActive"
            case .foregroundInactive: activation = "foregroundInactive"
            case .background: activation = "background"
            @unknown default: activation = "unknown"
            }
            return ["id": scene.session.persistentIdentifier, "activation": activation, "role": scene.session.role.rawValue]
        }.sorted { ($0["id"] as? String ?? "") < ($1["id"] as? String ?? "") }
        let remaining = app.backgroundTimeRemaining
        return [
            "applicationState": state,
            "scenes": scenes,
            "protectedDataAvailable": app.isProtectedDataAvailable,
            "backgroundTimeRemaining": remaining.isFinite && remaining < 1.0e10 ? remaining : -1,
            "thermalState": ProcessInfo.processInfo.thermalState.rawValue,
            "lowPowerMode": ProcessInfo.processInfo.isLowPowerModeEnabled,
            "debuggerAttached": Self.debuggerIsAttached()
        ]
    }

    private func frameSnapshot() -> [String: Any] {
        let now = ProcessInfo.processInfo.systemUptime
        metricsLock.lock()
        let current = metrics
        metricsLock.unlock()
        return [
            "attempts": current.attempts,
            "enqueued": current.enqueued,
            "ticks": current.ticks,
            "activeStage": current.activeStage,
            "stageAge": max(0, now - current.stageStarted),
            "frameAge": current.frameEnded.map { max(0, now - $0) } ?? -1,
            "frameStartAge": current.frameStarted.map { max(0, now - $0) } ?? -1,
            "enqueueAge": current.lastEnqueued.map { max(0, now - $0) } ?? -1,
            "tickAge": current.lastTick.map { max(0, now - $0) } ?? -1,
            "rawDelta": current.rawDelta,
            "playing": current.playing,
            "offset": current.offset
        ]
    }

    private func registerNotifications() {
        precondition(Thread.isMainThread)
        let uiNames: [Notification.Name] = [
            UIApplication.willResignActiveNotification,
            UIApplication.didEnterBackgroundNotification,
            UIApplication.willEnterForegroundNotification,
            UIApplication.didBecomeActiveNotification,
            UIApplication.willTerminateNotification,
            UIApplication.didReceiveMemoryWarningNotification,
            UIApplication.protectedDataWillBecomeUnavailableNotification,
            UIApplication.protectedDataDidBecomeAvailableNotification,
            UIScene.willConnectNotification,
            UIScene.didDisconnectNotification,
            UIScene.didActivateNotification,
            UIScene.willDeactivateNotification,
            UIScene.willEnterForegroundNotification,
            UIScene.didEnterBackgroundNotification,
            ProcessInfo.thermalStateDidChangeNotification,
            .NSProcessInfoPowerStateDidChange
        ]
        for name in uiNames {
            notificationTokens.append(NotificationCenter.default.addObserver(forName: name, object: nil, queue: .main) { [weak self] notification in
                guard let self else { return }
                var fields = self.snapshotUI()
                fields["notification"] = notification.name.rawValue
                if let userInfo = notification.userInfo { fields["userInfo"] = userInfo }
                if let scene = notification.object as? UIScene {
                    fields["notificationScene"] = scene.session.persistentIdentifier
                    fields["sceneClass"] = String(describing: type(of: scene))
                    fields["sceneActivation"] = scene.activationState.rawValue
                    if let windowScene = scene as? UIWindowScene {
                        fields["sceneWindows"] = windowScene.windows.map { ["class": String(describing: type(of: $0)), "hidden": $0.isHidden, "alpha": $0.alpha] as [String: Any] }
                    }
                }
                self.log("lifecycle.notification", fields)
            })
        }
        let audioNames: [Notification.Name] = [
            AVAudioSession.interruptionNotification,
            AVAudioSession.routeChangeNotification,
            AVAudioSession.mediaServicesWereLostNotification,
            AVAudioSession.mediaServicesWereResetNotification,
            AVAudioSession.silenceSecondaryAudioHintNotification
        ]
        for name in audioNames {
            notificationTokens.append(NotificationCenter.default.addObserver(forName: name, object: nil, queue: nil) { [weak self] notification in
                var fields: [String: Any] = ["notification": notification.name.rawValue]
                if let userInfo = notification.userInfo { fields["userInfo"] = userInfo }
                self?.log("audio.notification", fields)
            })
        }
        log("lifecycle.initial", snapshotUI())
    }

    private func append(_ source: [String: Any]) {
        guard !capReported else { return }
        var record = source
        let wallSeconds = record.removeValue(forKey: "wallSeconds") as? Double ?? Date().timeIntervalSince1970
        record["wall"] = dateFormatter.string(from: Date(timeIntervalSince1970: wallSeconds))
        guard var data = try? JSONSerialization.data(withJSONObject: record, options: [.sortedKeys, .fragmentsAllowed]) else {
            fputs("TP_DIAG diagnostic JSON encoding failed\n", stderr)
            return
        }
        data.append(0x0A)
        if writtenBytes + data.count > maximumFileBytes {
            capReported = true
            let cap: [String: Any] = [
                "event": "session.file-cap-reached",
                "session": sessionID,
                "uptime": ProcessInfo.processInfo.systemUptime,
                "wall": dateFormatter.string(from: Date()),
                "mainThread": false,
                "fields": ["maximumFileBytes": maximumFileBytes, "bytesWritten": writtenBytes]
            ]
            if var capData = try? JSONSerialization.data(withJSONObject: cap, options: [.sortedKeys]) {
                capData.append(0x0A)
                try? file?.write(contentsOf: capData)
                try? file?.synchronize()
                print("TP_DIAG " + (String(data: capData, encoding: .utf8) ?? "file cap reached"), terminator: "")
            }
            return
        }
        do {
            try file?.write(contentsOf: data)
            writtenBytes += data.count
        } catch {
            fputs("TP_DIAG diagnostic file write failed: \(error)\n", stderr)
        }
        print("TP_DIAG " + (String(data: data, encoding: .utf8) ?? "encoding error"), terminator: "")
    }

    private static func errorFields(_ error: NSError, depth: Int) -> [String: Any] {
        guard depth < 8 else { return ["domain": error.domain, "code": error.code, "truncated": true] }
        return [
            "domain": error.domain,
            "code": error.code,
            "description": error.localizedDescription,
            "userInfo": jsonValue(error.userInfo, depth: depth + 1)
        ]
    }

    private static func jsonValue(_ value: Any, depth: Int) -> Any {
        guard depth < 10 else { return "<maximum diagnostic depth>" }
        if value is NSNull { return NSNull() }
        if let error = value as? NSError { return errorFields(error, depth: depth + 1) }
        if let number = value as? NSNumber {
            return number.doubleValue.isFinite ? number : String(describing: number)
        }
        if let string = value as? String { return string }
        if let date = value as? Date { return date.timeIntervalSince1970 }
        if let url = value as? URL { return url.absoluteString }
        if let dict = value as? [AnyHashable: Any] {
            var result: [String: Any] = [:]
            for (key, item) in dict {
                let fieldName = String(describing: key)
                let sensitive = ["script", "rendertext", "prompttext", "scriptcontent"].contains(fieldName.lowercased())
                result[fieldName] = sensitive ? "<not collected>" : jsonValue(item, depth: depth + 1)
            }
            return result
        }
        if let array = value as? [Any] { return array.map { jsonValue($0, depth: depth + 1) } }
        return String(describing: value)
    }

    private static func debuggerIsAttached() -> Bool {
        var process = kinfo_proc()
        var length = MemoryLayout<kinfo_proc>.stride
        var query: [Int32] = [CTL_KERN, KERN_PROC, KERN_PROC_PID, getpid()]
        let result = query.withUnsafeMutableBufferPointer { queryBuffer in
            sysctl(queryBuffer.baseAddress, u_int(queryBuffer.count), &process, &length, nil, 0)
        }
        return result == 0 && (process.kp_proc.p_flag & P_TRACED) != 0
    }

    deinit {
        watchdog?.cancel()
        notificationTokens.forEach { NotificationCenter.default.removeObserver($0) }
        try? file?.close()
    }
}
