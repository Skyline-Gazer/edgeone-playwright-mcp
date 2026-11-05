# LIMITS — time, concurrency, resources, browser

Observed on the live authenticated deployment (2026-11-05). No theoretical quota presented as measured.

## Observed timings (live)

| Item | Value | Source |
|---|---|---|
| Sandbox cold start (`commands.run` warmup) | **0.9–1.3 s** (`warmMs` 915–1255) | `/probe` |
| MCP `initialize` round trip | **0.99–1.13 s** | matrix runs |
| `browser_navigate` round trip | **3.2–5.4 s**（含平台网关 RTT） | matrix runs |
| `browser_screenshot` (viewport/fullpage) | **1.9–3.1 s** | matrix runs |
| 3 个并发会话并行导航 | **5.5 s**（A=5.5/B=5.1/C=4.3 s 并行完成） | multi-agent.json |
| 工具调用成功率（最终矩阵） | **21/21 PASS**；multi-agent **7/7 PASS** | evidence/*.json |
| 内部 CDP warmup（沙箱内 @playwright/mcp 启动） | ~12 s（含 npx 下载，进程驻留后 <1 s） | native relay |

## Sandbox lifecycle（lifecycle 长测完成，evidence/progress.json + lifecycle-run.log）

| Item | Value | Source |
|---|---|---|
| **连续可用时长（实测）** | **≥56 min**（04:38:55 首次导航 → 05:34:20 仍正常 getContent，同一 instanceId `7oui…`，跨 3 个空闲检查点） | lifecycle run |
| 空闲 6 min 后复用 | **PASS**（getContent 7.0 s） | progress.json |
| 30 分钟标记复用 | **PASS**（5.0 s） | progress.json |
| 55 分钟标记复用 | **PASS**（5.9 s） | progress.json |
| `extendTimeout(900)` | 调用 PASS；**返回的 expiresAt（05:24 UTC）与实测矛盾**——55 分钟时仍可用。该字段不可信，真实寿命 ≥56 min（与 ~60 min 平台默认一致） | progress.json |
| `browser_close` 后重建 | **PASS**（close 3.3 s → 新导航 5.0 s，自动重新 acquire） | progress.json |
| Cookie/localStorage | 同实例内跨请求保持（PASS）；实例回收即丢 | state 检查 |
| 断开重连 | 无长连接（每请求独立 HTTP），天然可重连 | 架构性质 |
| `/tmp` 持久性 | 实例回收即丢（实测实例 id 在多次实验间变化）；`playwright_native_call` 的会话文件丢失后自动重启内层 MCP 并重建会话 | native relay 自愈 |
| 首次调用竞态 | 新 conversation 首次 acquire 可能 "not initialized"——服务端 3 次退避重试已消化 | 实测 |

## Concurrency

| Item | Value |
|---|---|
| 并发会话 | **3 个同时连接 PASS**（各自独立沙箱，cookie/页面互不可见） |
| 单浏览器多客户端 | 沙箱内 Chromium 为实例级单例；Route B 工具共享该实例（conversation 粘性保证不串台） |
| 压力测试 | 未做（按任务约束） |

## Free 配额估算（月浏览器小时）

只按实测外推并标注假设，**不把理论 GB-s 当平台保证**：

- 每个活跃 conversation 占一个沙箱实例，实测连续可用 ≥56 min；60 min 边界后的确切行为：**56 min 时仍可用，精确过期点未单独复测**（避免无意义配额消耗；`extendTimeout` 返回的 expiresAt 字段不可信）。
- 假设单人使用、每天 2 个会话、每会话 30–60 min：≈ **2–4 浏览器小时/天 ≈ 60–120 h/月**，全部落在 Free 层级内（前提：平台不按沙箱小时另行计费/限流——文档未给出沙箱小时配额，此项 UNKNOWN，需以控制台用量页为准）。
- 请求侧：Makers Free 100 万次请求/月；本服务每次工具调用 ≈ 2 个请求（tools/call + 内部命令），日常使用远低于上限。

## 未测/受限项

- **Codex 端到端**：MCP 传输握手成功（rmcp session 建立），模型调用因 ChatGPT 配额（2026-11-06 10:28 重置）未完成——重置后可直接补测。
- 精确 60 min 过期点、断连后平台侧沙箱重建耗时：未单独复测（`browser_close` 后客户端侧重建 5.0 s PASS）。
- 平台对沙箱的并发实例上限：未触发（最多同时 5 个 conversation），具体上限 UNKNOWN。
- UDP / 原生 QUIC：Chromium 无平台级 UDP 出口，未测。
