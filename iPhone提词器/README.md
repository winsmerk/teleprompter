# 随行提词 · iPhone 录制提词器

原生 SwiftUI App，最低 iOS 17。当前实现为 **2.0（build 22）**：在 App 内拍摄，取景画面上显示滚动提词，视频文件只包含相机画面与麦克风声音。build 22 加入青绿色摄像机与提词行 App 图标，录制逻辑沿用已验证的 build 21；设计原稿及生成提示词见 [图标设计说明](design/README.md)。

2026-10-27，签名真机版本和模拟器版本均构建成功，2.0 已安装到“文子”iPhone。用户已确认提词滚动、录像画面与声音、成片不含提词、相册保存均正常。日志确认此次独立运行未连接调试器，前置相机短片写入 2,097,790 字节并成功保存相册；本次实际开始至停止请求约 1.1 秒，不能据此声称长时间录像已验证。证据为 `diagnostics/captures/session-BA9D5368-v2-in-app-success.jsonl`。项目尚未作为正式产品发布。

## 使用

1. 在首页输入文案，设置字号与滚动速度；文案和设置保存在本机。
2. 点击“进入拍摄”，首次使用允许相机和麦克风权限。
3. 等待相机就绪，可在未录制时切换前后摄像头。
4. 点击红色录制按钮，提词从头自动滚动。拍摄时可暂停/继续提词、重播，或打开设置调整滚动速度。
5. 再次点击红色按钮停止录制，App 保留本机视频，并尝试保存到系统相册；首次保存时申请相册添加权限。

当前支持竖屏拍摄。字号在首页调整，拍摄页可调整速度。返回后台、锁屏或相机发生中断时，App 会尝试结束录制并保留文件；长时间拍摄和中断恢复仍需真机验证。

## 视频与权限

录像由 `AVCaptureSession` 和 `AVCaptureMovieFileOutput` 完成，支持时优先使用 1080p 和 HEVC。相机配置、启动与录制在专用串行队列执行，SwiftUI 提词仅叠加在预览界面，没有合成进输出文件。

需要相机、麦克风权限才能进入录制流程。保存相册只申请 `.addOnly`，不读取照片库；拒绝相册权限或保存失败时，本机视频仍保留，可使用“导出视频”分享。

视频保存在 App 的 `Documents/Recordings`。可通过“文件 → 我的 iPhone → 随行提词 → Recordings”查看，也可从最近录制入口分享。成功保存相册后本机仍留有一份。

2.0 不包含画中画播放或 B 实验容器的正常使用流程，录制和提词均在本 App 内完成。

## 安装与调试

1. 用 Xcode 打开 `Teleprompter.xcodeproj`。
2. 在 target → Signing & Capabilities 中选择开发团队，必要时修改 Bundle Identifier。
3. 数据线连接并解锁 iPhone，完成信任电脑和开发者模式设置。
4. 选择对应真机，使用共享 `Teleprompter` scheme 的 Debug 配置运行。

真机安装需要开发者签名；本项目不是可通过网页直接安装的 App。共享 scheme 配有 LLDB，控制台以 `TP_DIAG` 前缀输出诊断记录。

日志位于 `Documents/Diagnostics/session-UUID.jsonl`，首页“诊断日志”可导出。当前记录 `camera.*` 录制/权限/保存事件、提词播放操作和应用生命周期，不记录提词文案；单个会话上限 8 MB。

在项目目录编译模拟器版本：

```sh
xcodebuild -project Teleprompter.xcodeproj -scheme Teleprompter -sdk iphonesimulator -derivedDataPath /tmp/teleprompter-build CODE_SIGNING_ALLOWED=NO build
```

编译通过仅确认工程构建成功；模拟器也不能代替真机验证摄像头、麦克风和输出文件。

## 先前黑屏诊断

此前的 A 播放型画中画在持续生成与提交文字帧时仍黑屏，B 实验容器则在一次连接 Xcode 的系统相机录像中显示成功，证据指向内容源/窗口呈现路径差异，尚未确定具体 iOS 内部策略。

SDK 将 B 内容源明确限定于实际视频通话，故未将该探针作为普通提词器的正式方案。用户选择了当前 App 内录制实现。原始日志、实验条件与证据边界见 [诊断记录](diagnostics/README.md)。
