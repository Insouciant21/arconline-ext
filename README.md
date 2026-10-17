# Arcaea Online Extension

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/Insouciant21/arconline-ext)

单账号 Arcaea B50 与潜力值归档面板，使用 Astro、React 和 Cloudflare Workers。正式入口为 <https://arc.moeblue.top>。

## 架构

- Astro 服务端页面与 API；原 React 成绩卡片、PTT 图表和历史对比作为交互组件保留。
- D1 保存快照、官网原始 PTT、图片缓存、谱面别名、日志、会话和后台任务。
- R2 原生绑定保存 `snapshots/`、`charts/`、`characters/`、`potential/` 与 `exports/`，保留现有对象键和媒体域名。
- Queues 分阶段处理同步、历史导入及媒体重试。关闭浏览器不会终止任务，页面每两秒更新进度。
- Cron 在 UTC `15:59`（北京时间 `23:59`）提交每日任务，每五分钟恢复过期任务和补投遗漏消息。
- 管理口令登录，随机 Cookie 会话有效期七天；会话摘要保存在 D1，退出立即撤销。

B50 未变化时不新增快照、不上传媒体；官网历史仍会更新。PTT 图表合并官网历史和快照，按北京时间取每日最高值。历史页直接查询 D1，不在每次请求中扫描 R2。日志保留最近 500 条。

后台使用 D1 事务保存任务及待投递记录；队列每次处理一个步骤，媒体每批最多八项、并行两项。步骤完成后记录检查点，失败最多自动重试三次，之后可以手动重试。确定性的 R2 对象键避免中断后重复上传。D1 租约持续二十分钟，长于队列调用上限，恢复任务由五分钟调度器负责。

## 本地开发

需要 Node.js 22.12+（建议当前 LTS）和 pnpm 10。

```bash
pnpm install --frozen-lockfile
cp .dev.vars.example .dev.vars
pnpm db:migrate
pnpm dev
```

开发使用本地 D1/R2/队列模拟器，默认不连接正式数据。`pnpm dev` 的输出会说明本机访问地址；Astro 7 可使用 `pnpm exec astro dev stop` 停止后台开发服务。

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm preview
```

浏览器冒烟测试需要本地有至少两份历史快照：

```bash
pnpm exec playwright install chromium
pnpm test:browser
```

默认访问 `http://127.0.0.1:4321`、口令 `local-test-token`。可通过 `SMOKE_ORIGIN`、`SMOKE_TOKEN` 或 `SMOKE_ENV_FILE` 指定目标与凭据。截图写入已忽略的 `.migration/`。

## 配置与部署

`wrangler.jsonc` 声明 `DB`、`ARCHIVE`、`JOBS` 绑定、定时任务及 `arc.moeblue.top` 的 Worker 自定义域名。Cloudflare 管理该域名的 DNS 与证书，站点不依赖旧服务器地址。生产凭据使用 Workers Secrets：

```bash
pnpm exec wrangler login
pnpm exec wrangler secret put ADMIN_TOKEN
pnpm exec wrangler secret put USERNAME
pnpm exec wrangler secret put PASSWD
pnpm db:migrate:remote
pnpm run deploy
```

必须使用 `pnpm run deploy`，因为 `pnpm deploy` 是 pnpm 自身的工作区命令。

`env.ARCHIVE`、`env.DB`、`env.JOBS` 是 Cloudflare 注入的资源绑定对象，不是 `.env` 字符串配置。线上代码使用 `ARCHIVE.get()/put()`、`DB.prepare()`、`JOBS.send()` 直接访问资源；绑定在 `wrangler.jsonc` 声明，运行时不需要 Cloudflare API Token。管理口令和 Lowiro 账号仍通过 Workers Secrets 保存。

`DAILY_SYNC_ENABLED` 控制每日同步；`MUTATIONS_ENABLED=false` 用于维护期间拒绝新任务并暂停处理。生产环境不配置 `R2_PUBLIC_URL`，图片默认通过同域 `/api/media/*` 读取；保留该可选配置用于切回公开媒体域名，不参与 R2 鉴权。

媒体请求先校验登录，再读取 Worker Cache API，未命中时通过 `ARCHIVE` binding 流式读取 R2。边缘缓存和浏览器私有缓存均为一小时，支持 ETag / `If-None-Match` 返回 `304`、HEAD 请求；浏览器响应带 `Vary: Cookie`，避免切换会话复用缓存。`X-Media-Cache: HIT/MISS` 可用于诊断。缓存异常时回退 R2，错误响应不缓存。边缘缓存仅在正式自定义域名上验证，`workers.dev` 不提供相同缓存行为；缓存可能在 TTL 前被淘汰。同 key 对象更新最多延迟一小时可见。页面和业务响应不进入公共缓存。

原 R2 公共域名仍然保留，切换应用图片地址不会关闭该入口；Worker 的登录控制仅适用于同域接口。

更换 Cloudflare 账户时，需要先创建 D1、`arcaea-jobs` 和 `arcaea-jobs-failed` 队列，更新账户、数据库及 bucket 配置。首次上线先保持每日同步关闭，在 `workers.dev` 完成验证后再启用正式自定义域名。

## GitHub 自动构建与部署

GitHub Actions 在推送 `main` 或提交目标为 `main` 的 PR 时自动运行 `pnpm run ci:build`，依次执行类型检查、测试和 Astro 构建；不需要生产凭据。工作流位于 `.github/workflows/ci.yml`，仅请求仓库读取权限。

Cloudflare 自动上线使用 Workers Builds，需在控制台完成一次仓库连接：构建命令同样为 `pnpm run ci:build`，通过后执行 `pnpm run ci:deploy`。部署步骤先应用尚未执行的 D1 迁移，再发布 Worker；数据库迁移必须兼容部署前仍在运行的版本。

一次性连接步骤及权限要求见 [部署运行手册](docs/deployment.md#github-自动部署)。构建器使用 `.node-version` 指定的 Node.js 24，pnpm 版本固定为 `package.json` 中的 `10.33.2`。生产口令留在 Worker Secrets，检查和构建不需要访问生产数据。

## API

| 方法 | 路径 | 行为 |
| --- | --- | --- |
| POST | `/api/auth/login` | 校验管理口令并建立会话 |
| POST | `/api/auth/logout` | 撤销会话 |
| GET | `/api/auth/session` | 查询登录状态 |
| GET | `/api/dashboard` | 当前 B50、每日 PTT、活动任务 |
| POST | `/api/sync` | 提交同步，返回 `202 { jobId, status }` |
| POST | `/api/history/import` | 提交官网 PTT 历史导入 |
| POST | `/api/media/retry` | 重试最新失败快照的媒体 |
| GET | `/api/jobs/{id}` | 查询阶段、进度、结果或错误 |
| POST | `/api/jobs/{id}/retry` | 从检查点重试失败任务 |
| POST | `/api/cron/daily` | 登录后的手动同步入口；GET 返回 405 |
| GET / HEAD | `/api/media/{key}` | 登录后读取曲绘、角色和潜力图；内部边缘缓存、浏览器私有缓存、ETag 条件请求 |
| GET | `/api/health` | 检查 D1 可访问及 R2 绑定配置 |

除登录入口外，业务接口均需会话；修改状态的请求必须来自同一 origin。原 NextAuth 协议接口和 Cookie 不再使用，迁移后需要重新登录。

## 旧数据迁移

先执行 `pnpm exec wrangler login`；维护工具从 `wrangler.jsonc` 读取账户和 `ARCHIVE` 桶绑定，连接真实的云端资源。登录需要 R2 和 D1 的相应权限。本地 `pnpm dev` 仍使用本地模拟器。

导入支持多个旧 `data/` 目录和 R2 快照，按快照 ID、官网原始时间点去重。同 ID 的不同成绩会中止导入并生成冲突报告；媒体完整的版本优先。再次导入时同时合并 D1 已有数据，避免覆盖新记录。

```bash
# 只读预览，生成数量、逐快照指纹和每日 PTT 报告
node scripts/migrate-legacy.mjs --data /path/to/old/data --data ./data --r2

# 导入并核对 D1 的快照指纹与每日 PTT
node scripts/migrate-legacy.mjs --data /path/to/old/data --data ./data --r2 --apply

# 再次核对（不写入 D1）
node scripts/migrate-legacy.mjs --data /path/to/old/data --r2 --verify

# 补齐原来只在本地保存的 R2 快照，默认 dry-run
node scripts/backfill-r2.mjs
node scripts/backfill-r2.mjs --apply

# 导出为旧服务器可读取的 JSON/CSV 格式
pnpm export:legacy --out .migration/cloud-export
```

`--sql .migration/import.sql` 可生成 SQL，再用 `wrangler d1 execute DB --local --file ...` 导入本地模拟器。原数据和 R2 对象不会被删除。迁移、备份补齐和清理脚本通过 Wrangler 的 `getPlatformProxy` 建立远程 R2 绑定，调用同样的 `list/get/put/delete` API，不需要 AWS SDK 或 S3 密钥。

R2 重复清理仍为默认 dry-run：`node scripts/cleanup-r2.mjs`。不应在导入或同步进行时执行带 `--apply` 的清理。

上线切换和回滚步骤见 [部署运行手册](docs/deployment.md)。
