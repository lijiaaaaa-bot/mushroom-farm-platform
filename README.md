# mushroom-farm-platform

食用菌种植管理平台。管理端接收客户已有 IoT / 边缘 AI 识别结果，不做图像识别。

路由、接口和限制以 [`docs/CURRENT_CAPABILITIES.md`](docs/CURRENT_CAPABILITIES.md) 为准。

## 运行

只用这些 Make 目标。约束见 [`ARCHITECTURE_WALLS.md`](ARCHITECTURE_WALLS.md)。

```bash
make up       # Postgres / Redis / MinIO / Mosquitto
make migrate  # infra/migrations
make api      # API :41821
make web      # 管理端 :43123
make test
make smoke
make gates    # 文档门禁
```

开发账号 `admin` / `Admin@123456`。接入请求头 `X-Ingest-Token: dev-ingest-token`。

报文试发：`make smoke` 或 `scripts/edge-simulator.mjs`。

## 接入

| 通道 | MQTT | HTTP |
|------|------|------|
| 识别 | `mushroom/+/+/recognition` | `POST /api/v1/ingest/recognition` |
| 环境 | `mushroom/+/+/environment` | `POST /api/v1/ingest/environment` |
| 心跳 | `mushroom/+/+/heartbeat` | `POST /api/v1/ingest/heartbeat` |

## 其他

基地大屏在 `/big-screen`，说明见 [`docs/CURRENT_CAPABILITIES.md`](docs/CURRENT_CAPABILITIES.md)。

严重告警可推企业微信 / 钉钉，变量见 `.env.example`。上游 Day-0：[project-harness-day0](https://github.com/lijiaaaaa-bot/project-harness-day0) v0.1.0（[`docs/HARNESS.md`](docs/HARNESS.md)）。
