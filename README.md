# mushroom-farm-platform

食用菌种植管理平台。接收现场已有物联网和边缘 AI 的识别结果，以及环境、心跳等上报，提供管理端和大屏。识别在边缘侧完成，本仓消费这些结果。

路由、接口和限制见 [`docs/CURRENT_CAPABILITIES.md`](docs/CURRENT_CAPABILITIES.md)。

## 启动

在仓库根目录：

```bash
make up       # Postgres、Redis、MinIO、Mosquitto
make migrate  # 数据库迁移
make api      # API，端口 41821
make web      # 管理端，端口 43123
```

`make test` 跑契约与应用测试。`make smoke` 向 HTTP 和 MQTT 发送示例报文。

开发账号 `admin` / `Admin@123456`。接入请求头 `X-Ingest-Token: dev-ingest-token`。

## 接入

| 通道 | MQTT | HTTP |
|------|------|------|
| 识别 | `mushroom/+/+/recognition` | `POST /api/v1/ingest/recognition` |
| 环境 | `mushroom/+/+/environment` | `POST /api/v1/ingest/environment` |
| 心跳 | `mushroom/+/+/heartbeat` | `POST /api/v1/ingest/heartbeat` |

严重告警可推送到企业微信或钉钉，地址写在 `.env.example`。
