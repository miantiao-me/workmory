# Workmory

[English](README.md) · [OKF v0.2 规范](SPEC.md) · [Workmory OKF Profile](OKF_RULES.md)

Workmory 为你的 AI Agent 提供持久的跨会话记忆与混合检索，让你能够安全沉淀项目事实、上下文检查点与用户偏好，并具备完整的版本追溯能力。

服务采用无状态设计，基于 Cloudflare Workers 架构构建，通过标准 MCP（Model Context Protocol）端点提供 11 个记忆工具与 3 个画像工具，同时提供私有附件处理 API。

- **跨会话持久上下文**：让 Agent 摆脱单次会话长度限制，在任务启动时快速恢复历史状态，并在达成里程碑时记录成果。
- **精准混合检索**：融合精确匹配、标签过滤、全文关键词（FTS5）与语义向量，准确召回所需信息。
- **透明可追溯的版本记录**：基于不可变的 [OKF 规范](SPEC.md) 存储，每一次更新与删除均留存版本历史，支持随时回溯或审计。
- **轻量云原生基础设施**：基于 Cloudflare D1、R2、Vectorize 和 Workers AI，无需自建或维护繁重的数据库实例。

## 接入

Workmory 的 MCP 服务端点为 `POST /mcp`（基于 Streamable HTTP，首选 MCP v2/2026，同时兼容 `2025-11-25`）。

### Agent 配置示例

在 MCP 客户端配置中添加服务端点与凭据：

```json
{
  "mcpServers": {
    "workmory": {
      "url": "https://memory.example.com/mcp",
      "headers": {
        "Authorization": "Bearer <access-application-jwt>"
      }
    }
  }
}
```

### 认证方式

服务支持两种凭据认证：

- **Cloudflare Access JWT**：通过 `Authorization: Bearer <jwt>` 或 `Cf-Access-Jwt-Assertion: <jwt>` 传递。每个 Access 用户主体拥有相互隔离的独立数据空间。
- **Root API Key**：通过 `X-API-Key: <key>` 传递。对应独立的 `root` 数据域，适用于自动化运维或系统级调用。

不支持自定义请求头的 MCP 客户端可使用 `https://memory.example.com/mcp/<url-encoded-root-key>`。请使用 `encodeURIComponent` 编码实际的 `ROOT_API_KEY`，此 URL 无需额外认证请求头。

只要存在 `X-API-Key` 请求头，就优先且只校验该密钥。空密钥或错误密钥会认证失败，不回退到 JWT 或路径密钥。没有该请求头时，路径密钥、Bearer JWT 和 assertion 只能提供一种。Access service-token 请求头不受支持。Cookie 可以随请求附带，但不作为凭据读取，`CF_Authorization` 也不例外。

Access API 调用需要有效的应用 JWT。仪表盘目前仅支持 root 密钥登录。网页 API 客户端有密钥时省略浏览器凭据，无密钥时使用同源凭据。若 API 路径受 Cloudflare Access 边缘保护，需通过 Access 策略允许省略浏览器凭据的请求到达 Worker；应用代码无法绕过边缘策略。

### 发现经验记忆 Skill

公开的 [Agent Skills Discovery RFC](https://github.com/cloudflare/agent-skills-discovery-rfc) Draft v0.2.0 索引位于 `https://memory.example.com/.well-known/agent-skills/index.json`，无需认证。从索引条目的 `url`（相对于该站点）下载 `workmory-memory`，将下载文件原始字节的 SHA-256 与 `digest` 核对后，再安装到 Agent 的 Skill 目录。这份自包含的中文 Skill 帮助 Agent 在用户授权下核验历史经验的适用性并保存可复用成果；它不会自行安装或启用自动记忆调用。

## 工具一览

Workmory 提供 14 个标准的 MCP 工具。记忆工具使用 `project` 作为工作区隔离边界，`namespace` 默认为 `default`；用户画像工具针对全局或指定项目偏好。

### 记忆工具

| 工具 | 帮 Agent 做什么 |
|---|---|
| `memory_store` | 存储或更新记忆，支持纯文本、Markdown、文档附件或网页 URL |
| `memory_retrieve` | 按唯一 key 精确读取当前记忆记录 |
| `memory_search` | 混合检索记忆，融合精确匹配、标签、全文（FTS5）与语义向量 |
| `memory_list` | 分页浏览记忆列表，支持按类型、状态和标签筛选 |
| `memory_get_last` | 读取最近的工作检查点（`system/last_memory`），快速恢复上下文 |
| `memory_update_last` | 更新工作检查点，记录最新任务进度 |
| `memory_history` | 查看记忆的历史版本与变更审计记录 |
| `memory_retrieve_revision` | 查看指定历史版本的快照或删除记录 |
| `memory_restore` | 将某个历史快照恢复为最新记录（不改写历史链条） |
| `memory_graph` | 查询知识节点及其关联网络（一跳邻居或子图） |
| `memory_delete` | 逻辑删除指定记忆，并记录删除墓碑版本 |

`memory_search` 返回 `snippet` 摘录，完整正文用 `memory_retrieve` 读取。`max_response_chars` 默认 16000（整数范围 2000–100000），按 `JSON.stringify(SearchResult).length` 的 UTF-16 代码单元计量，包含元数据，不含传输封装。结果保留完整排名前缀；`responseBudget.omittedItems` 仅计本次 `limit` 内因预算省略的条目，不代表总命中数。首条超限时 `items` 可为空且省略数非零，可缩小查询或提高预算。

### 用户画像工具

| 工具 | 帮 Agent 做什么 |
|---|---|
| `profile_get` | 读取当前有效画像（自动合并全局设置与项目覆盖偏好） |
| `profile_update` | 更新画像字段，支持用户提供、导入或带置信度与陈旧日期 `stale_after` 的推断字段 |
| `profile_delete` | 逻辑删除整份全局画像或指定项目的画像 |

### 推荐 Agent 工作流

1. **任务启动**：Agent 先调用 `memory_get_last` 获取上次任务状态，结合 `memory_search` 检索相关背景知识；需要针对性个性化交互时调用 `profile_get`。
2. **任务进行与达成**：在产生重要结论或任务完成时，调用 `memory_store` 沉淀记录，并调用 `memory_update_last` 推进检查点；捕获到明确偏好变化时调用 `profile_update`。

## 附件与内容导入

除了纯文本，Workmory 允许直接接入文档和网页：

- **私有附件 API**：通过 `POST /v1/projects/:project/attachments` 上传文件（图片、PDF、办公文档），服务会自动将其转换为 Markdown 并安全存储在私有 R2 中，返回附件 ID 供 `memory_store` 引用。可通过 `GET .../:id/content/original` 与 `GET .../:id/content/markdown` 下载。
- **网页内容导入**：在 `memory_store` 中直接提供公开 HTTPS 网页链接，服务会自动抓取并转换网页内容。

## 本地开发

运行环境需要 Node.js 24 与 pnpm。

```bash
corepack enable
pnpm install --frozen-lockfile
cp .env.example .env.local
```

编辑 `.env.local`：将 `ROOT_API_KEY` 替换为至少 32 字节的随机密钥（例如通过 `openssl rand -hex 32` 生成），并将 `VECTOR_INDEX_VERSION` 设置为版本标识（例如 `v1`）。

```bash
pnpm migration:apply:local
pnpm dev
```

`pnpm dev` 启动前端看板（Vite）与 Nitro API 服务，使用本地 D1 与 R2 模拟。注意 Cloudflare Vectorize 与 Workers AI 无本地模拟；向量检索与 AI 特性需在远端 Cloudflare 服务中运行。

### 开发模式

| 命令 | 用途 |
|---|---|
| `pnpm dev` | Vite 前端看板 + Nitro API 服务，使用本地 D1/R2 模拟（Vectorize 与 Workers AI 需远端服务） |
| `pnpm dev:wrangler` | 基于 `wrangler.jsonc` 的本地 Worker 运行（`--local`，本地 D1/R2 模拟） |
| `pnpm dev:local-bindings` | 基于 `wrangler.local.jsonc` 的远端测试（`--remote`，连接独立的 `workmory-local` 远端资源） |
| `pnpm dev:remote` | 基于 `wrangler.production.jsonc` 的远端运行（`--remote`，连接生产 `workmory` 远端资源） |

### 环境变量

| 变量 | 说明 |
|---|---|
| `ROOT_API_KEY` | 必填，至少 32 字节的随机密钥 |
| `ACCESS_TEAM_DOMAIN` | 可选，Cloudflare Access 团队域名（与 `ACCESS_AUD` 配对使用） |
| `ACCESS_AUD` | 可选，Cloudflare Access 应用程序 Audience |
| `EMBEDDING_MODEL` | 必填，Workers AI 向量模型，例如 `@cf/qwen/qwen3-embedding-0.6b` |
| `EMBEDDING_DIMENSIONS` | 必填，向量维度，例如 `1024` |
| `VECTOR_INDEX_VERSION` | 可重建向量索引的版本标识 |

若仅使用 Root Key 运行，保持 Access 变量留空即可；启用 Access 时需同时设置两项。

## 部署与运维

Workmory 部署至 Cloudflare Workers，依赖 D1（数据库）、R2（对象存储）、Vectorize（向量索引）与 Workers AI（智能模型）。

### 前置准备

1. **创建 Cloudflare 资源**：
   - D1 数据库：`pnpm wrangler d1 create workmory`
   - R2 存储桶：`pnpm wrangler r2 bucket create workmory`
   - Vectorize 索引：`pnpm wrangler vectorize create workmory --dimensions 1024 --metric cosine`（维度须与 `EMBEDDING_DIMENSIONS` 一致）
2. **更新配置**：在 `wrangler.jsonc` 中，将 `database_id`、存储桶名与向量索引名替换为你自己的资源标识。（如需使用 `pnpm dev:local-bindings` 进行独立的远端测试，可在 `wrangler.local.jsonc` 中配置对应的开发资源。）
3. **配置密钥与环境变量**：通过 `pnpm wrangler secret put ROOT_API_KEY`（或 Cloudflare 控制台）配置 `ROOT_API_KEY`，并配置其余必填变量（`EMBEDDING_MODEL`、`EMBEDDING_DIMENSIONS`、`VECTOR_INDEX_VERSION`，以及可选的 Access 凭据）。

### 部署

```bash
pnpm migration:apply:remote
pnpm build
pnpm deploy:dry-run
pnpm deploy
```

- **数据维护**：拥有 Root Key 的系统可通过 `POST /v1/maintenance` 触发异步索引处理与资源清理。
- **状态检查**：调用 `POST /v1/maintenance`（请求体 `{ "action": "status" }`）可查看当前任务队列与索引状态。

## 架构与标准

- **存储分离**：D1 负责权威状态、元数据、版本链与 FTS5 全文索引；R2 负责私有且不可变的规范文档与附件；Vectorize 维护高性能向量检索。
- **开放知识标准**：遵循 [Open Knowledge Format (OKF v0.2)](SPEC.md)，内容以人机通用的 Markdown + YAML Frontmatter 格式组织，无数据锁定。
- **Web 看板**：根路径 `/` 提供基于浏览器的轻量看板，支持知识检索与图谱可视化浏览（`/graph`）。

## 许可证

[AGPL-3.0-or-later](LICENSE) © 2026 Workmory contributors。

### 第三方归属

- [`web/coss-globals.css`](web/coss-globals.css)、[`web/components/app/`](web/components/app/)、[`web/components/shared/`](web/components/shared/)、[`web/components/settings/`](web/components/settings/)、[`web/components/list-item.tsx`](web/components/list-item.tsx)、[`web/components/mobile-header.tsx`](web/components/mobile-header.tsx)、[`web/hooks/use-scroll-hide.ts`](web/hooks/use-scroll-hide.ts)：复制/改写自 [Coss](https://github.com/cosscom/coss) Cal.com 示例（commit `19620ae8`），上游许可 AGPL-3.0-or-later（见各文件头部注释）。
- [`web/components/ui/`](web/components/ui/)：复制自 [Coss](https://github.com/cosscom/coss) `apps/ui/registry/`（上游 LICENSING 中的 MIT 例外目录）。
- [`SPEC.md`](SPEC.md)：改写自 [GoogleCloudPlatform/open-knowledge-format](https://github.com/GoogleCloudPlatform/open-knowledge-format)，上游许可 [Apache-2.0](licenses/OKF-LICENSE-Apache-2.0.md)。
