# mushroom-farm-platform

食用菌种植管理平台。对接客户已有物联网与边缘 AI：本仓消费识别与环境、心跳等上报，提供管理端与基地大屏等业务能力。识别在边缘侧完成。

已落地能力（路由、接口、限制）见 [`docs/CURRENT_CAPABILITIES.md`](docs/CURRENT_CAPABILITIES.md)。

## 本地运行

```bash
make up       # Postgres / Redis / MinIO / Mosquitto
make migrate
make api      # http://127.0.0.1:41821
make web      # http://127.0.0.1:43123
```

开发登录：`admin` / `Admin@123456`  
接入令牌请求头：`X-Ingest-Token: dev-ingest-token`

联调可用 `make smoke` 或 `scripts/edge-simulator.mjs` 发送样例报文。

## 接入

| 类型 | MQTT | HTTP |
|------|------|------|
| 识别 | `mushroom/+/+/recognition` | `POST /api/v1/ingest/recognition` |
| 环境 | `mushroom/+/+/environment` | `POST /api/v1/ingest/environment` |
| 心跳 | `mushroom/+/+/heartbeat` | `POST /api/v1/ingest/heartbeat` |

基地大屏路由：`/big-screen`。严重告警可选推送到企业微信 / 钉钉，见 `.env.example`。

## 部署与运维

- 登录日志、Postgres 备份、抓拍热盘 / 冷盘与云归档：[`docs/OPS_STORAGE_BACKUP.md`](docs/OPS_STORAGE_BACKUP.md)
