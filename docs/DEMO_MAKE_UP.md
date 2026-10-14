# 把演示依赖栈拉起来

在仓库根目录：

```bash
make images-probe
make up
```

`make images-probe` 核对 `docker-compose.yml` 和 `infra/object-store/Dockerfile` 里的镜像摘要还能从登记处取到，并打印每一条。退出码 0 时，四行 `pull` / `build` 如下，且每条摘要与 silo 包都打印 `reachable`：

- `postgres`：`postgres:16-alpine@sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea`
- `redis`：`redis:7-alpine@sha256:858f009f9709ce576febc734aa78b8f6d624b82571f9ddb6bda4377c833b3499`
- `mosquitto`：`eclipse-mosquitto:2@sha256:38c0da4f2ef84284d47b3b3eeea1cb3bdeabe81ee10caf0cd5c5ff61ee3ea408`
- `minio`：本地镜像 `mushroom-object-store:20260916`，基础镜像 `debian:bookworm-slim@sha256:7c7b2c966bc9ee8cedfeef67e0e279108992c77681fa595db4a9d65c06ccc587`

对象存储不向 Docker Hub 拉取 `mushroom-object-store`。`pull_policy: build` 只在本机用 `infra/object-store` 构建。构建时从 GitHub Release `RELEASE.2026-09-16T00-00-00Z` 下载 linux 包，sha256 对上才装入。不拉取 `pgsty/silo`，也不拉取 `quay.io/minio/minio`。

`make up` 先跑 `make images`（只看本仓文件，不访问网络），再 `docker compose up -d --build --wait`。

绿色是这四件事同时成立：

1. `make images-probe` 退出码 0。
2. `docker compose ps` 里 `postgres`、`redis`、`minio`、`mosquitto` 都是 `healthy`。
3. 启动日志里没有 `pull access denied for mushroom-object-store`。
4. `curl -fsS http://127.0.0.1:9000/minio/health/ready` 退出码 0。

`make up` 不起冷盘，也不换 Timescale。冷盘仍是同一本地镜像，见 `docker-compose.minio-cold.yml`。

然后按各演示文档继续：`make migrate`，另开终端 `make api`、`make web`。

## 演示页对比度

登录按钮、未读计数、告警标题链接用的绿色是 `#1B7A4E`，白字贴在这块绿底上。警告色文字是 `#9A6700`。二者在白底 `#FFFFFF` 和页面底 `#F5F7FA` 上都达到正文对比度 4.5:1。悬停绿是 `#0E4F32`。基地大屏夜色底 `#12304a` 上，严重文字是 `#ff6b6b`，指标数字是 `#6fce8a`，次要文字是 `#9fb3c8`，同样达到 4.5:1。

浏览器打开 http://127.0.0.1:43123/login 。Lighthouse 的 Accessibility 与 Best Practices 分数均为 100。

告警列表的新建表单（棚区、摄像头、级别、标题、说明）带有可访问名称。操作列标题是「操作」。

核对：

```bash
make demo-contrast
```

退出码 0 即上述颜色和名称还在。不改 `make demo-one-ingest`、`make demo-alert-camera-filter`、`make demo-alert-status-filter`、`make demo-alert-title-search`、`make demo-alert-handle-note`、`make demo-alert-snapshot-minio` 以及更早的摄像头、值班、告警演示命令。
