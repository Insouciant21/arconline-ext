# ArcOnline Extension

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/Insouciant21/arconline-ext)

单账号 Arcaea B50、单曲成绩查询与潜力值归档面板，使用 Astro、React 和 Cloudflare Workers。

## 架构

- Astro 提供服务端页面与 API，React 提供成绩卡片、PTT 图表和历史对比。
- D1 保存快照、官网原始 PTT、图片缓存、谱面别名、日志、会话和后台任务。
- R2 原生绑定保存 `snapshots/`、`charts/`、`characters/`、`potential/` 与 `exports/`。
- Queues 分阶段处理同步、历史导入及媒体重试。关闭浏览器不会终止任务，页面每两秒更新进度。
- Cron 在 UTC `15:59`（北京时间 `23:59`）提交每日任务，每五分钟恢复过期任务和补投遗漏消息。
- 管理口令登录，随机 Cookie 会话有效期七天；会话摘要保存在 D1，退出立即撤销。
- 登录接口同时使用 Workers Rate Limiting binding 与 D1 尝试计数限制暴力破解。

B50 未变化时不新增快照、不上传媒体；官网历史仍会更新。PTT 图表合并官网历史和快照，按北京时间取每日最高值。历史页列表只查询 D1 摘要列，详情与对比通过 `/api/snapshots/{id}` 按需加载完整快照，不在每次请求中传输全量 JSON 或扫描 R2；归档导出在数据无变化时跳过重写。日志保留最近 500 条。

单曲查询页 `/scores` 按曲名关键词或歌曲 ID、难度查询当前账号的官网最佳成绩，支持排序和每页十条的分页。需要有效的 Arcaea Online 订阅；展示分数、PURE（+大 PURE）、FAR、LOST、成绩时间、最佳通关状态及年内游玩次数。查询结果不写入 B50 历史，曲绘复用私有 R2 缓存；官网账号和会话只用于服务端请求。

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

`migrations/` 用于 D1 建表和数据库结构版本管理；`pnpm db:migrate` 初始化或更新本地数据库。它们是当前 Cloudflare 部署的一部分。

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm preview
```

自动测试覆盖当前 Worker 的鉴权、媒体缓存、D1 归档、队列重试和部署配置。测试使用本地模拟资源，不访问正式数据；故障恢复测试会捕获并校验预期错误日志。

浏览器冒烟测试需要本地有至少两份历史快照：

```bash
pnpm exec playwright install chromium
pnpm test:browser
```

`pnpm test:browser:scores` 单独检查单曲查询交互，使用模拟官网响应，不需要本地快照或官网账号。

默认访问 `http://127.0.0.1:4321`、口令 `local-test-token`。可通过 `SMOKE_ORIGIN`、`SMOKE_TOKEN` 或 `SMOKE_ENV_FILE` 指定目标与凭据。截图写入已忽略的 `test-results/browser/`。`node scripts/smoke-api.mjs` 使用相同的目标与凭据配置检查 API。

## 配置与部署

公开的 `wrangler.jsonc` 是通用模板：不包含作者的 Cloudflare 账户 ID、自定义域名或真实数据库 ID。资源名称只是默认名称，资源归属于部署者登录的 Cloudflare 账户。每日同步默认关闭，完成账号和手动同步验证后再启用。

### 一键部署

点击顶部 **Deploy to Cloudflare**，在自己的 Cloudflare 账户中创建项目和所需的 D1、R2、Queues 资源。根据界面提示填写三个 Secrets：

| Secret | 用途 |
| --- | --- |
| `ADMIN_TOKEN` | 面板登录口令，使用足够长的随机字符串 |
| `USERNAME` | Arcaea / Lowiro 账号邮箱 |
| `PASSWD` | Arcaea / Lowiro 账号密码 |

部署流程会构建 Astro、更新 D1 数据库结构，然后发布 Worker。首次使用 `workers.dev` 地址登录并手动同步，确认正常后将 `DAILY_SYNC_ENABLED` 改为 `"true"` 再部署。默认图片由登录后的 Worker 直接提供，无需配置 R2 公共域名。

Cloudflare 按其[部署按钮规则](https://developers.cloudflare.com/workers/platform/deploy-buttons/)创建资源并更新配置。请检查创建后的 `DB`、`ARCHIVE`、`JOBS`、`FAILED_JOBS` 绑定；队列消费者的 `queue` 应与 `JOBS` 对应，`dead_letter_queue` 应与 `FAILED_JOBS` 对应。如果在界面中改了队列名，也要同步这两个引用。

### 手动部署

```bash
pnpm install --frozen-lockfile
pnpm exec wrangler login
pnpm exec wrangler d1 create arconline-ext
pnpm exec wrangler r2 bucket create arconline-ext
pnpm exec wrangler queues create arconline-ext-jobs
pnpm exec wrangler queues create arconline-ext-jobs-failed
```

将新数据库的 ID 填入 `wrangler.jsonc` 的 `DB.database_id`。如修改资源名，同时更新相应绑定及队列消费者引用；同一账户部署多个实例时，各实例需使用不同的 Worker、数据库、桶和队列名称。

```bash
pnpm exec wrangler secret put ADMIN_TOKEN --config wrangler.jsonc
pnpm exec wrangler secret put USERNAME --config wrangler.jsonc
pnpm exec wrangler secret put PASSWD --config wrangler.jsonc
pnpm run deploy
```

`pnpm run deploy` 会重新构建、更新远程数据库结构并部署，数据库更新失败时不会发布。未填写真实 D1 ID 时会提前停止。使用 `pnpm run deploy --dry-run` 只构建并验证打包，不更新数据库或发布。必须使用 `pnpm run deploy`，因为 `pnpm deploy` 是 pnpm 自身的工作区命令。

自定义域名可在自己的配置中添加 `routes`，由 Cloudflare 管理 DNS 与证书：

```json
"routes": [{ "pattern": "app.example.com", "custom_domain": true }]
```

### 私有生产配置

维护公开模板时，可将自己的完整配置保存在根目录 `wrangler.production.jsonc`，该文件已加入 `.gitignore`。两个配置都应保持标准 JSON 格式，不添加注释或尾逗号。私有配置包含实际的资源 ID、域名与开关；账号密码仍留在 Worker Secrets。

```bash
# 首次准备个人配置，然后填写自己的资源信息
cp wrangler.jsonc wrangler.production.jsonc

# 显式使用私有配置构建并部署
pnpm run deploy:production
pnpm run deploy:production --dry-run

# 更新私有配置对应 Worker 的 Secret
pnpm exec wrangler secret put ADMIN_TOKEN --config wrangler.production.jsonc
```

已有私有配置时不要用模板覆盖它。普通 `pnpm build` 和 `pnpm run deploy` 始终默认使用公开配置，不会因本地存在私有文件而自动切换。Astro 构建和维护脚本可通过 `ARCAEA_CONFIG=wrangler.production.jsonc` 显式选择；直接调用 Wrangler 时使用 `--config`，Wrangler 本身不识别 `ARCAEA_CONFIG`。

`env.ARCHIVE`、`env.DB`、`env.JOBS` 是 Cloudflare 注入的资源绑定对象，不是 `.env` 字符串配置。线上代码直接使用 `ARCHIVE.get()/put()`、`DB.prepare()`、`JOBS.send()`，运行时不需要 Cloudflare API Token。

`DAILY_SYNC_ENABLED` 控制每日同步；`MUTATIONS_ENABLED=false` 用于维护期间拒绝新任务并暂停处理。`R2_PUBLIC_URL` 是可选的公开图片地址前缀，不参与 R2 鉴权；不配置时，图片通过同域 `/api/media/*` 读取。若额外开启 R2 公共入口，该入口不受 Worker 登录控制。

`LOGIN_RATE_LIMITER` 在每个 Cloudflare 数据中心按客户端 IP 允许 10 秒内 20 次登录请求，超过后返回 `429`。应用层仍按 IP 在 D1 记录失败次数，一分钟内超过 5 次同样返回 `429`。两层限制分别应对突发流量和持续暴力猜测。

媒体请求先校验登录，再读取 Worker Cache API，未命中时通过 `ARCHIVE` binding 流式读取 R2。媒体键均为一次写入（`charts/` 与 `characters/` 按 Lowiro 内容哈希寻址，`potential/` 按唯一快照 ID 寻址，重试只重传相同字节），因此边缘缓存和浏览器私有缓存均为一年，支持 ETag / `If-None-Match` 返回 `304`、HEAD 请求；浏览器响应带 `Vary: Cookie`。`X-Media-Cache: HIT/MISS` 可用于诊断。缓存异常时回退 R2，错误响应不缓存。边缘缓存仅在正式自定义域名上验证，`workers.dev` 不提供相同缓存行为；缓存可能在 TTL 前被淘汰。页面和业务响应不进入公共缓存。

## GitHub 自动构建与部署

GitHub Actions 在推送 `main` 或提交目标为 `main` 的 PR 时自动运行 `pnpm run ci:build`，依次执行类型检查、测试和 Astro 构建；不需要生产凭据。工作流位于 `.github/workflows/ci.yml`，仅请求仓库读取权限，不负责上线。

Cloudflare 自动上线使用 Workers Builds：在 Worker → Settings → Builds 中连接自己的 GitHub 仓库，生产分支选择 `main`，根目录为 `/`，构建命令为 `pnpm run ci:build`，部署命令为 `pnpm run ci:deploy`。部署阶段会按所选配置重新构建，避免误用其他目标的旧产物，然后更新 D1 数据库结构并发布。数据库结构更新必须兼容部署前仍在运行的版本。

如果仓库保留通用模板，而实际生产配置未入库，需要在 Workers Builds 的**构建环境加密变量**中设置 `ARCAEA_CONFIG_JSON`，值为完整私有配置的 JSON 内容。工具会将其写入已忽略的 `wrangler.production.jsonc` 并选择该文件，供构建与部署共同使用。不要把此变量设置为 Worker 运行时 Secret，也不要同时设置 `ARCAEA_CONFIG`。普通 GitHub Actions 检查继续使用通用模板。

如果部署的是按钮生成、已写入自己资源绑定的仓库，则直接使用其 `wrangler.jsonc` 即可，无需上述私有配置变量。构建器使用 `.node-version` 指定的 Node.js 24，pnpm 版本固定为 `package.json` 中的 `10.33.2`。生产口令保留在 Worker Secrets。

## API

| 方法 | 路径 | 行为 |
| --- | --- | --- |
| POST | `/api/auth/login` | 校验管理口令并建立会话 |
| POST | `/api/auth/logout` | 撤销会话 |
| GET | `/api/auth/session` | 查询登录状态 |
| GET | `/api/dashboard` | 当前 B50、每日 PTT、活动任务 |
| GET | `/api/snapshots/{id}` | 单个快照的完整数据，供历史页按需加载 |
| GET | `/api/scores?term=Aegleseeker&difficulty=2&page=1&sort=title` | 查询官网个人最佳成绩，返回 `{ scores, count }`；难度 0–4，排序支持 `title`、`date`、`score`、`score_below_max` |
| POST | `/api/sync` | 提交同步，返回 `202 { jobId, status }` |
| POST | `/api/history/import` | 提交官网 PTT 历史导入 |
| POST | `/api/media/retry` | 重试最新失败快照的媒体 |
| GET | `/api/jobs/{id}` | 查询阶段、进度、结果或错误 |
| POST | `/api/jobs/{id}/retry` | 从检查点重试失败任务 |
| POST | `/api/cron/daily` | 登录后的手动同步入口；GET 返回 405 |
| GET / HEAD | `/api/media/{key}` | 登录后读取曲绘、角色和潜力图；内部边缘缓存、浏览器私有缓存、ETag 条件请求 |
| GET | `/api/health` | 检查 D1 可访问及 R2 绑定配置 |

除登录入口外，业务接口均需会话；修改状态的请求必须来自同一 origin。
