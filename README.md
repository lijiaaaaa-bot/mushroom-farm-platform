# mushroom-farm-platform

食用菌种植管理平台。对接客户已有物联网与边缘 AI：本仓消费识别与环境、心跳等上报，提供管理端与基地大屏等业务能力。识别在边缘侧完成。

已落地能力（路由、接口、限制）见 [`docs/CURRENT_CAPABILITIES.md`](docs/CURRENT_CAPABILITIES.md)。

## 本地运行

```bash
make up       # Postgres / Redis / MinIO / Mosquitto。步骤见 docs/DEMO_MAKE_UP.md
make migrate
make api      # http://127.0.0.1:41821
make web      # http://127.0.0.1:43123
```

开发登录：`admin` / `Admin@123456`  
接入令牌请求头：`X-Ingest-Token: dev-ingest-token`

联调可用 `make smoke` 或 `scripts/edge-simulator.mjs` 发送样例报文。  
发一条样例识别并在识别记录里看到：[`docs/DEMO_ONE_INGEST.md`](docs/DEMO_ONE_INGEST.md)（`make demo-one-ingest`）。  
登记 `CAM-REG-02` 再给这台摄像头发一条识别：[`docs/DEMO_REGISTER_AND_INGEST.md`](docs/DEMO_REGISTER_AND_INGEST.md)（`make demo-register-and-ingest`）。  
登记 `CAM-REG-02` 再发一条心跳，设备页和值班看板看到在线：[`docs/DEMO_REGISTER_AND_HEARTBEAT.md`](docs/DEMO_REGISTER_AND_HEARTBEAT.md)（`make demo-register-and-heartbeat`）。  
发一条温度过高告警，在告警列表点进详情：[`docs/DEMO_ONE_ALERT.md`](docs/DEMO_ONE_ALERT.md)（`make demo-one-alert`）。  
确认或关闭这条待确认告警，刷新后状态仍在：[`docs/DEMO_ACK_CLOSE_ALERT.md`](docs/DEMO_ACK_CLOSE_ALERT.md)（`make demo-ack-one-alert`、`make demo-close-one-alert`）。  
改二氧化碳阈值后再发一条超限识别，告警列表出现对应告警：[`docs/DEMO_THRESHOLD_ALERT.md`](docs/DEMO_THRESHOLD_ALERT.md)（`make demo-threshold-alert`）。  
按摄像头编号筛选告警列表，清除后两台摄像头都回来：[`docs/DEMO_ALERT_CAMERA_FILTER.md`](docs/DEMO_ALERT_CAMERA_FILTER.md)（`make demo-alert-camera-filter`）。  
按状态筛选告警列表，改回全部后两条都回来：[`docs/DEMO_ALERT_STATUS_FILTER.md`](docs/DEMO_ALERT_STATUS_FILTER.md)（`make demo-alert-status-filter`）。  
按标题关键词搜索告警列表，清除搜索后两条都回来：[`docs/DEMO_ALERT_TITLE_SEARCH.md`](docs/DEMO_ALERT_TITLE_SEARCH.md)（`make demo-alert-title-search`）。  
确认或关闭告警时填写处理说明，详情刷新后仍在：[`docs/DEMO_ALERT_HANDLE_NOTE.md`](docs/DEMO_ALERT_HANDLE_NOTE.md)（`make demo-alert-handle-note`）。  
告警抓拍写入对象存储，详情页打开这张图：[`docs/DEMO_ALERT_SNAPSHOT_MINIO.md`](docs/DEMO_ALERT_SNAPSHOT_MINIO.md)（`make demo-alert-snapshot-minio`）。  
发两条环境遥测，最新值出现在环境读数页：[`docs/DEMO_TELEMETRY_LATEST.md`](docs/DEMO_TELEMETRY_LATEST.md)（`make demo-telemetry-latest`）。  
发一条超阈值环境遥测，告警列表和详情出现这条告警：[`docs/DEMO_TELEMETRY_THRESHOLD_ALERT.md`](docs/DEMO_TELEMETRY_THRESHOLD_ALERT.md)（`make demo-telemetry-threshold-alert`）。

## 接入

| 类型 | MQTT | HTTP |
|------|------|------|
| 识别 | `mushroom/+/+/recognition` | `POST /api/v1/ingest/recognition` |
| 环境 | `mushroom/+/+/environment` | `POST /api/v1/ingest/environment` |
| 心跳 | `mushroom/+/+/heartbeat` | `POST /api/v1/ingest/heartbeat` |

基地大屏路由：`/big-screen`。值班看板路由：`/duty-screen`。严重告警可选推送到企业微信 / 钉钉，见 `.env.example`。

## 部署与运维

- 登录日志、Postgres 备份、抓拍热盘 / 冷盘与云归档：[`docs/OPS_STORAGE_BACKUP.md`](docs/OPS_STORAGE_BACKUP.md)
