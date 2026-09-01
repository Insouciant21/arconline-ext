# Arcaea Online Extension

一个面向单个 Arcaea 账号的全栈归档面板：服务端登录 Lowiro，抓取当前 B50 和官方潜力值图片，将 B50 快照正文与媒体重传到 Cloudflare R2；同时写入本地 JSON/CSV，按天生成潜力值历史。

## 功能

- 移动端 Chrome UA 访问 Lowiro API 与曲绘资源。
- Auth.js 登录页使用服务端 `ADMIN_TOKEN` 建立会话；未登录无法访问页面和业务 API。
- `POST /api/sync`：获取 B50、将快照正文备份为 `snapshots/{snapshotId}.json`，并把潜力值图片、玩家角色头像和 B50 曲绘上传 R2。
- 角色头像按 `characterId + icon` 缓存在 `data/character-images.json`，避免重复下载和上传；角色资源变更时自动生成新的 R2 对象。
- 每天 `23:59:59`（默认 `Asia/Shanghai`）由 Node cron 自动执行一次每日同步。
- 每次 B50 快照保存到 `data/b50-history.json`、`data/b50-history.csv` 和 `data/snapshots/*.json`；每日快照追加到 `data/ptt-history.json/csv`。
- 当前 v7 B50 计算方式显示在面板：最高 10 条双倍计入，除以 60。官方返回的 `rating` 作为同步数据，计算值用于校验。
- R2 未配置时仍可打开空面板；执行同步会返回明确的配置错误。

## 环境变量

复制 `.env.example` 到 `.env`，并填写：

```env
USERNAME=your-account-email
PASSWD=your-password
R2_ACCOUNT_ID=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET_NAME=arcaea-assets
R2_PUBLIC_URL=https://assets.example.com
AUTH_SECRET=...
AUTH_URL=http://localhost:3000
ADMIN_TOKEN=...
```

如果没有为 R2 配置公开域名，面板会通过 `/api/media/*` 由服务端代理读取对象。生产环境建议使用 R2 自定义域名，并把 R2 token 权限限制为目标 bucket 的 Object Read & Write。

`AUTH_SECRET` 用于 Auth.js 会话签名，必须设置为长随机值；`ADMIN_TOKEN` 是登录页访问口令，只在服务端校验。除 `/api/auth/*` 认证协议接口外，页面和 API 都需要有效登录会话。
`AUTH_URL` 应设置为用户实际访问应用的公开 origin；本地 Docker 默认使用 `http://localhost:3000`，部署到域名或反向代理后请替换为对应的 `https://...` 地址。

## 本地运行

```bash
pnpm install
pnpm dev
```

打开 <http://localhost:3000>，点击“获取 B50 & 潜力图”开始第一次同步。

## Docker

```bash
docker compose up -d --build
```

应用默认通过 <http://localhost:61616> 访问，容器内部仍使用 `3000` 端口。

`/app/data` 使用 Docker volume 保存。单容器部署时内置 scheduler 会启动；多副本部署时应只保留一个 scheduler。

## API 概览

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| GET/POST | `/api/auth/*` | Auth.js 登录、登出和会话接口 |
| GET | `/api/dashboard` | 当前快照、PTT 历史和 scheduler 信息（需登录） |
| POST | `/api/sync` | 手动抓取并归档（需登录） |
| GET/POST | `/api/cron/daily` | 手动触发每日同步（需登录） |
| GET | `/api/media/{key}` | 无 R2 公开域名时的对象代理（需登录） |
| GET | `/api/health` | 服务与 R2 配置状态（需登录） |
