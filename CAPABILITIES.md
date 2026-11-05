# CAPABILITIES — MCP tool & browser capability matrix

All statuses below are from the **live authenticated deployment** `https://edgeone-playwright-mcp-ov.edgeone.dev` (2026-11-05, Run matrix @03:40 UTC: **21 checks, 0 FAIL**; multi-agent run: **7 checks, 0 FAIL**).

Two tool surfaces exist:

1. **Route B tools** (10, first-class MCP tools on `POST /mcp`) — implemented in this repo over `context.sandbox`.
2. **Native Playwright MCP** (25 tools) — Microsoft `@playwright/mcp@latest` running **inside the sandbox**, reachable via the `playwright_native_call` relay tool. Full toolset available; relay adds ~1–3 s per call.

## Route B matrix (verified live)

| 分组 | 项目 | MCP tool | 远程可调 | 额外 capability | 实测 | 差异 vs 本地 Playwright MCP |
|---|---|---|---|---|---|---|
| 基础 | 导航 | `browser_navigate` | ✓ | 无 | PASS (4.6 s round trip) | 一致 |
| 基础 | HTML/标题 | `browser_get_content` | ✓ | 无 | PASS (2076 B HTML) | 本地另有 `browser_snapshot`(a11y) |
| 基础 | 关闭 | `browser_close` | ✓ | 无 | PASS | 一致 |
| DOM | 元素查找/求值 | `browser_evaluate` | ✓ | 无 | PASS (自控页面) | 本地用 a11y ref；此处 CSS selector |
| 交互 | 点击/输入 | `browser_click` / `browser_type` | ✓ | 无 | PASS（错选择器正确报错） | 一致（弱于本地语义定位） |
| 交互 | select/hover/drag | — | — | — | **缺失** | 本地有；可用 native relay 的 `browser_select_option`/`browser_hover`/`browser_drag` |
| 截图 | viewport / fullpage | `browser_screenshot` | ✓ | 无 | PASS (PNG 36.6 KB, ~2 s) | 一致（MCP image content 直返 Agent） |
| 状态 | cookie/localStorage | evaluate 读写 | ✓ | 无 | PASS（跨导航保持） | 本地有专门 cookie API |
| 调试 | — | — | — | — | **缺失** | native relay 有 `browser_console_messages` / `browser_network_requests` |
| 性能 | LCP | evaluate + PerformanceObserver | ✓ | 无 | PARTIAL（页内指标，LCP=52 ms 读到） | 本地可跑 trace |
| 文件 | 沙箱 /tmp | `sandbox_run_command` | ✓ | 无 | PASS | 上传/下载走 native relay |
| 安全 | SSRF 拒绝 | `browser_navigate` guard | ✓ | 无 | PASS（127.0.0.1 被拒） | 本地无此层 |
| 控制 | 沙箱信息/命令/续期 | `sandbox_info` / `sandbox_run_command` / `sandbox_extend_timeout` | ✓ | 无 | PASS | 本地无对应物（平台能力） |

## Native Playwright MCP toolset（经 `playwright_native_call` 中继，25 个）

browser_close, browser_resize, browser_console_messages, browser_handle_dialog, browser_emulate_media, browser_evaluate, browser_file_upload, browser_drop, browser_find, browser_fill_form, browser_press_key, browser_type, browser_navigate, browser_navigate_back, browser_network_requests, browser_network_request, browser_run_code_unsafe, browser_take_screenshot, browser_snapshot, browser_click, browser_drag, browser_hover, browser_select_option, browser_tabs, browser_wait_for

实测抽样：`browser_navigate` ✓、`browser_snapshot` ✓（返回 ref 化 a11y 树）。中继实现：沙箱内 `npx @playwright/mcp --cdp-endpoint http://127.0.0.1:9222 --port 8931`（沙箱内 Chromium `--remote-debugging-port=9222`，Chrome 152），经 `commands.run` curl 隧道转发 JSON-RPC，SSE `data:` 帧已解析。会话存于沙箱 `/tmp/pw-session`，进程掉线自动重启。

## 架构 A 记录（原生 Playwright MCP 直连）

| 尝试 | 结果 |
|---|---|
| `sandbox.browser.cdpUrl` 存在且 HTTP 可达（`/json/version` 携 token 200） | ✓ |
| **外部 CDP WebSocket 升级** | **401 AUTHENTICATION_FAILED**（Playwright `connectOverCDP` 与裸 ws 均被拒；平台只允许运行时内部驱动） |
| 沙箱内 localhost:9222 CDP | ✓（Chrome 152 存活） |
| 沙箱内 @playwright/mcp + `getHost(8931)` 外部暴露 | **BLOCKED** — `310508 sandbox endpoint is not configured`（平台仅预配置 9000/6080 等端口，任意端口不可暴露） |
| 结论 | 原生 MCP 只能经 `playwright_native_call` 命令隧道中继暴露 |

## 已知平台怪癖（实测发现）

1. **首次 sandbox acquire 竞态**：新 conversation 第一次调用可抛 "Sandbox is not initialized"，重试即恢复（服务端已内置 3 次退避重试）。
2. **example.com 出站改写**：沙箱 egress 将 example.com body 替换为平台通告页（title 保留）——DOM 断言须用自控页面。
3. **每 conversation 一个独立沙箱实例**（`distinct-sandbox-instances` PASS）；conversation id 是粘性路由键。
