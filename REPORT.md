# REPORT — EdgeOne Free 远程 Playwright MCP 实测（最终）

**日期**: 2026-11-05 · **项目**: `~/workspace/edgeone-playwright-mcp`
**部署**: 登录账号（API token），`-a overseas` → `https://edgeone-playwright-mcp-ov.edgeone.dev`
**鉴权**: Bearer（`edgeone makers env set MCP_BEARER_TOKEN`），已实测

## 最终等级判定（全部有实测证据）

### **Level 2 — Browser MCP：达成 ✅**

外部 Agent 经标准 MCP（Streamable HTTP + Bearer）完成导航、交互、截图、内容获取；鉴权矩阵 6/6 PASS；3 会话并发 + 隔离 7/7 PASS。

### **Level 3 — Full Playwright MCP：达成（带工程限制）✅**

微软原生 `@playwright/mcp@latest`（**25 个完整工具**：a11y snapshot、tabs、file_upload、console/network、drag/hover/select、handle_dialog、press_key、navigate_back、emulate_media…）跑在沙箱内（`--cdp-endpoint 127.0.0.1:9222`，Chrome 152），经 `playwright_native_call` 中继对外可用，`browser_snapshot` 实测返回 ref 化 a11y 树。
限制：每跳多 ~1–3 s（命令隧道）；沙箱回收后 /tmp 会话文件丢失（服务端自动重启进程并重建会话）；未做 OAuth。

**Level 1（Browser API without MCP）**：被 Level 2 覆盖并超越。

## 架构决策记录

| 路线 | 结果 |
|---|---|
| A1：外部 Agent 直连沙箱 CDP + 本地 @playwright/mcp | **FAIL** — CDP WebSocket 升级 401（平台只允许运行时内部驱动；HTTP /json/version 可达但 WS 被拒） |
| A2：@playwright/mcp 跑沙箱内 + `getHost(port)` 外部暴露 | **FAIL** — `310508 endpoint not configured`（任意端口不可暴露） |
| **A3（采用）**：@playwright/mcp 沙箱内 + `commands.run` curl 隧道 → 我们的 MCP 工具 `playwright_native_call` | **PASS** — 25 工具、snapshot 实测 |
| B（Route B）：自研 10 个 MCP 工具直包 `context.sandbox.browser` | **PASS** — 21/21 矩阵 |

最终架构 = **B 为一等接口 + A3 为完整能力扩展**，单一 Bearer 入口，无额外服务器/数据库。

## 问题 1–8 最终回答

1. **EdgeOne Free 最高等级？** **Level 3（Full Playwright MCP）可达**——含全部 25 个原生工具，但原生层经中继（+1–3 s/跳），且依赖沙箱存活（60 min/实例，可续期）。
2. **完整 MCP Tool 列表？** Route B 10 个 + 原生 25 个（全列见 CAPABILITIES.md）。
3. **单个浏览器真正可持续多久？** 沙箱实例 `expiresAt` ≈ **60 分钟**；`sandbox_extend_timeout(900)` 通路 PASS，实测延长效果见 lifecycle 证据；浏览器由平台惰性重建，重建后 /tmp 丢失。
4. **多 Agent 最优会话模式？** 每 Agent 一个独立 `makers-conversation-id`（粘性路由 → 独立沙箱 → 强隔离，实测 cookie/页面互不可见）；同一 token 下勿共享 CID。
5. **Bearer 是否全部生效？** **是**——缺失/错误 token 401 且先于 sandbox acquire（1.1–2.0 s 快速失败），/probe 同样受保护。
6. **哪些无法提供 / 必须本地？** 外部直连 CDP（平台拒绝 WS）、任意端口暴露（310508）、UDP/QUIC 出口、跨实例持久 /tmp。本地 Playwright MCP 仍适合：极低延迟、长时会话、需安装本机浏览器的场景。
7. **适合作 ALNILAM 日常备用浏览器？** **适合作为远程 MCP 浏览器备用**：免本地 Chromium、Bearer 鉴权、a11y snapshot/截图齐全；不适合对延迟敏感的密集交互（每跳 1–3 s + 会话 60 min 边界）。配额重置后建议以 Codex/OpenCode 长期挂载。
8. **能否保留为免费按需正式服务？** **可以**——本项目已登录部署（项目 `makers-ostgmsajojne`，常驻）；成本全部落在 Makers Free 层级（估算 60–120 浏览器小时/月，单人模式；沙箱小时级计费未在文档中出现，以控制台用量为准）。token 轮换：`edgeone makers env set` 后 redeploy。

## 实测证据索引

| 项 | 结果 | 证据 |
|---|---|---|
| 能力矩阵 | 21/21 PASS | `evidence/matrix-basic-1793850048507.json` |
| 多 Agent 并发/隔离 | 7/7 PASS | `evidence/multi-agent.json` |
| 截图 | PNG 36.6 KB ×2 | `evidence/shot-*.png` |
| Codex MCP 握手 | 会话建立（模型配额耗尽，e2e 待重置） | codex 日志（rmcp streamable_http session_id） |
| 生命周期 | **全 PASS**：6/30/55 min 空闲复用 ✓、同实例连续可用 ≥56 min、close→重建 ✓；`extendTimeout` 返回的 expiresAt 与实测矛盾（不可信） | `evidence/progress.json` + `evidence/lifecycle-run.log` |

## 接入示例（现网可用，替换 <TOKEN>）

**Codex**（`~/.codex/config.toml` 追加；勿覆盖现有条目）：

```toml
[mcp_servers.edgeone_playwright]
url = "https://edgeone-playwright-mcp-ov.edgeone.dev/mcp"
http_headers = { "Authorization" = "Bearer <TOKEN>", "makers-conversation-id" = "codex-main" }
```

**OpenCode**（`~/.config/opencode/opencode.jsonc` 的 `mcp.servers` 内追加）：

```jsonc
"edgeone_playwright": {
  "type": "remote",
  "url": "https://edgeone-playwright-mcp-ov.edgeone.dev/mcp",
  "headers": { "Authorization": "Bearer <TOKEN>", "makers-conversation-id": "opencode-main" },
  "enabled": true
}
```

**Orca / 其它**：MCP Streamable HTTP 客户端按上面 url+headers 配置即可；`codex mcp add`/`opencode mcp` 亦可交互添加。

**curl 直接调用**：

```bash
curl -sS -X POST https://edgeone-playwright-mcp-ov.edgeone.dev/mcp \
  -H "Authorization: Bearer <TOKEN>" -H "makers-conversation-id: my-session" \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"browser_navigate","arguments":{"url":"https://example.com"}}}'
```

**原生 25 工具调用**（经中继）：

```json
{"name":"playwright_native_call","arguments":{"method":"tools/call","params":{"name":"browser_snapshot","arguments":{}}}}
```

## 遗留事项

- Codex 端到端（导航+截图由真实编码 Agent 发起）：模型配额 2026-11-06 10:28 重置后即可补测；MCP 传输层已验证。
- lifecycle 后台长测结束后将证据补入 LIMITS.md。
- 若需更强隔离（多 token 持有者）：conversation id 需按身份派生（见 SECURITY.md 已知缺口）。
