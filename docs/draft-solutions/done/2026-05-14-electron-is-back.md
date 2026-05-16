Feature: Electron Wrapper (Native Features)

现在我们是 web + server 分离嘛，现在我就打算做，web+server 合在 Electron 里面，在 Electron 里面启动这个 Server 是最方便的了，然后 web 就作为renderer 嘛，
我现在能想到的优先是一些功能得回归了，比如说我们的 Tabbar 原本是可以 DnD 把 Tab Item拖动到窗口外的话就会创建一个新的 browser Window 的（然后左右侧栏都是默认隐藏的，不受到全局干扰，这里头切换也不干扰全局，我之前把这个叫tearoff 功能，不过不知道这个名字对不对了）然后的话就是那个添加项目的选择器，肯定是得调用系统自带的那个 Picker 才是最对味的
然后还是不是得设计一个 End-to-end typesafe IPC for Electron？用来做 Native Feature 用的，其他的情况下还是走 HTTP APi 就好了
不过的话，你需要处理好端口冲突（server 启动的时候）的问题，然后你还得往 window 里注入这个 API 最终链接的全局变量才行，然后我们的 Web 端也得做好适配，能在 Electron 里跑的好好的，不能因为 Electron 的环境导致功能缺失或者说体验不佳了，应该是比在 Web 里更好的才对的
反正你先把要做的先给我列出来，我怕我没数清楚

  Electron Wrapper 回归清单
  
  一、Electron Shell（新建）

  - 创建 apps/desktop/ 目录结构
  - electron-vite 配置、alias等等
  - electron-builder 配置 — appId、productName、asar unpack（wasm 文件）、extraResources（drizzle migrations）、mac/win/linux 平台配置
  - Main process 入口 — app.whenReady() 启动 Elysia server → 创建 BrowserWindow
  - Preload
  - Dev 的时候就直接让 Electron 自己 concurrently 跑 server dev + web dev + electron，production 打包就打包成一个 app，反正都是 TS，你自己来搞就行
  - 资源文件 — icon.png、entitlements、system-workflow.md 等我都还存着

  三、Tab Tearoff（回归）

  把 tab 拖出窗口变成独立 BrowserWindow：

  - WindowManager — 管理 session tearoff windows（复用旧代码 src/main/window/window-manager.ts，这可能需要你 git 拉回来才有）
    - openSessionWindow(sessionId, x, y) — 创建新 BrowserWindow，居中到 drop 位置
    - 已有同 session 的窗口则 focus 而不是新建
    - 关闭时清理 Map
    - 新窗口 sidebar 默认隐藏、不干扰全局 tab 切换
  - Tab bar DnD 集成 — 拖 tab item 到窗口外 → 调 ipc.window.tearOffSession(sessionId, x, y)
    - 需要 tab runtime 的 TabBar 支持 dragend 事件 + 屏幕坐标捕获

  四、Native Features
     
     扫全部应该用 Electron API 来实现才对味的，要和文件系统要和系统打交道的功能，像是那个添加项目的选择器，肯定是得调用系统自带的那个 Picker 才是最对味的了，然后再扫一下有没有别的，有的话就一起全搞定它

    四、End-to-end Typesafe IPC: 使用 @cradle/ipc 包，具体自行查看 packages/ipc 里的实现

    五、Electron Only 的 Devbar：Devtool Window 啊！

    六、E2E Testing 要同时支持 Web + Electron 两种环境，可能需要做好环境区分的适配


————————

You should active Skills: multi-work, exec-plan

只有完全完成了 Electron Wrapper 的开发，才需要向用户报告，其他时间，靠 multi-work 和 exec-plan 来管理开发进度和细节就好
