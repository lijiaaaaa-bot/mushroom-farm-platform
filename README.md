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
两个角色登录后菜单不同：[`docs/DEMO_RBAC.md`](docs/DEMO_RBAC.md)（`make demo-rbac`）。  
审计页 `/audit` 能看到登录失败 `audit-demo` 和超管登录成功：[`docs/DEMO_AUDIT_LOG.md`](docs/DEMO_AUDIT_LOG.md)（`make demo-audit-log`）。  
用户页 `/users`：超管能看到至少两条账号及角色（超管、查看），查看进不去：[`docs/DEMO_USER_MGMT.md`](docs/DEMO_USER_MGMT.md)（`make demo-user-mgmt`）。  
接入令牌请求头：`X-Ingest-Token: dev-ingest-token`

联调可用 `make smoke` 或 `scripts/edge-simulator.mjs` 发送样例报文。  
发一条样例识别并在识别记录里看到：[`docs/DEMO_ONE_INGEST.md`](docs/DEMO_ONE_INGEST.md)（`make demo-one-ingest`）。  
登记 `CAM-REG-02` 再给这台摄像头发一条识别：[`docs/DEMO_REGISTER_AND_INGEST.md`](docs/DEMO_REGISTER_AND_INGEST.md)（`make demo-register-and-ingest`）。  
登记 `CAM-REG-02` 再发一条心跳，设备页和值班看板看到在线：[`docs/DEMO_REGISTER_AND_HEARTBEAT.md`](docs/DEMO_REGISTER_AND_HEARTBEAT.md)（`make demo-register-and-heartbeat`）。  
心跳停够之后设备变离线，并打开「设备离线」告警：[`docs/DEMO_HEARTBEAT_OFFLINE_ALERT.md`](docs/DEMO_HEARTBEAT_OFFLINE_ALERT.md)（`make demo-heartbeat-offline-alert`）。  
值班看板一眼看到在线、离线和待确认，点进去对列表：[`docs/DEMO_DUTY_BOARD.md`](docs/DEMO_DUTY_BOARD.md)（`make demo-duty-board`）。  
设备列表 `/devices` 同一页能看到 `CAM-ON-01` 在线和 `CAM-OFF-01` 离线：[`docs/DEMO_DEVICE_ONLINE.md`](docs/DEMO_DEVICE_ONLINE.md)（`make demo-device-online`）。  
设备详情 `/devices/<id>` 能看到 `CAM-DTL-ON` 在线且最近心跳有时间，以及 `CAM-DTL-OFF` 离线：[`docs/DEMO_DEVICE_DETAIL.md`](docs/DEMO_DEVICE_DETAIL.md)（`make demo-device-detail`）。  
设备列表可按在线或离线筛选，`/devices?online=online` 只留 `CAM-FLST-ON`，`/devices?online=offline` 只留 `CAM-FLST-OFF`：[`docs/DEMO_DEVICE_ONLINE_FILTER.md`](docs/DEMO_DEVICE_ONLINE_FILTER.md)（`make demo-device-online-filter`）。  
发一条温度过高告警，在告警列表点进详情：[`docs/DEMO_ONE_ALERT.md`](docs/DEMO_ONE_ALERT.md)（`make demo-one-alert`）。  
直接打开这一条的详情，读完整字段：[`docs/DEMO_ALERT_DETAIL.md`](docs/DEMO_ALERT_DETAIL.md)（`make demo-alert-detail`）。  
确认或关闭这条待确认告警，刷新后状态仍在：[`docs/DEMO_ACK_CLOSE_ALERT.md`](docs/DEMO_ACK_CLOSE_ALERT.md)（`make demo-ack-one-alert`、`make demo-close-one-alert`）。  
告警列表上把待确认确认成已确认，再关闭成已关闭：[`docs/DEMO_ALERT_ACK.md`](docs/DEMO_ALERT_ACK.md)（`make demo-alert-ack`）。  
改二氧化碳阈值后再发一条超限识别，告警列表出现对应告警：[`docs/DEMO_THRESHOLD_ALERT.md`](docs/DEMO_THRESHOLD_ALERT.md)（`make demo-threshold-alert`）。  
按摄像头编号筛选告警列表，清除后两台摄像头都回来：[`docs/DEMO_ALERT_CAMERA_FILTER.md`](docs/DEMO_ALERT_CAMERA_FILTER.md)（`make demo-alert-camera-filter`）。  
按状态筛选告警列表，待确认、已确认、已关闭各留一条，改回全部后三条都回来：[`docs/DEMO_ALERT_STATUS_FILTER.md`](docs/DEMO_ALERT_STATUS_FILTER.md)（`make demo-alert-status-filter`）。  
按起止时间筛选告警列表，宽窗口三条都在，窄窗口少一条窗外告警：[`docs/DEMO_ALERT_TIME_RANGE.md`](docs/DEMO_ALERT_TIME_RANGE.md)（`make demo-alert-time-range`）。  
按设备筛选告警列表，`CAM-DEVF-01` 与 `CAM-DEVF-02` 各一条，选中一台后另一台不在表里：[`docs/DEMO_ALERT_BY_DEVICE.md`](docs/DEMO_ALERT_BY_DEVICE.md)（`make demo-alert-by-device`）。  
按标题关键词搜索告警列表，清除搜索后两条都回来：[`docs/DEMO_ALERT_TITLE_SEARCH.md`](docs/DEMO_ALERT_TITLE_SEARCH.md)（`make demo-alert-title-search`）。  
确认或关闭告警时填写处理说明，详情刷新后仍在：[`docs/DEMO_ALERT_HANDLE_NOTE.md`](docs/DEMO_ALERT_HANDLE_NOTE.md)（`make demo-alert-handle-note`）。  
告警抓拍写入对象存储，详情页打开这张图：[`docs/DEMO_ALERT_SNAPSHOT_MINIO.md`](docs/DEMO_ALERT_SNAPSHOT_MINIO.md)（`make demo-alert-snapshot-minio`）。  
发两条环境遥测，最新值出现在环境读数页：[`docs/DEMO_TELEMETRY_LATEST.md`](docs/DEMO_TELEMETRY_LATEST.md)（`make demo-telemetry-latest`）。  
按传感器和时间窗看环境遥测历史：[`docs/DEMO_TELEMETRY_HISTORY.md`](docs/DEMO_TELEMETRY_HISTORY.md)（`make demo-telemetry-history`）。  
按起止时间筛选环境读数，宽窗口三条都在，窄窗口少一条窗外读数：[`docs/DEMO_ENV_FILTER.md`](docs/DEMO_ENV_FILTER.md)（`make demo-env-filter`）。  
按摄像头和时间窗看识别记录：[`docs/DEMO_RECOGNITION_HISTORY.md`](docs/DEMO_RECOGNITION_HISTORY.md)（`make demo-recognition-history`）。  
报表页 `/reports` 预览园区生长并下载 xlsx：[`docs/DEMO_REPORT_XLSX.md`](docs/DEMO_REPORT_XLSX.md)（`make demo-report-xlsx`）。  
病害记录可查可见：[`docs/DEMO_DISEASE_LIST.md`](docs/DEMO_DISEASE_LIST.md)（`make demo-disease-list`）。  
采摘记录可查可见：[`docs/DEMO_HARVEST_LIST.md`](docs/DEMO_HARVEST_LIST.md)（`make demo-harvest-list`）。  
按棚区和时间窗筛选采摘记录：[`docs/DEMO_HARVEST_FILTER.md`](docs/DEMO_HARVEST_FILTER.md)（`make demo-harvest-filter`）。  
采摘任务可查可排：[`docs/DEMO_HARVEST_TASK.md`](docs/DEMO_HARVEST_TASK.md)（`make demo-harvest-task`）。  
出菇批次可查可见：[`docs/DEMO_FRUITING_BATCH.md`](docs/DEMO_FRUITING_BATCH.md)（`make demo-fruiting-batch`）。  
生长趋势页能看到 `CAM-GT-01` 的 7 日蘑菇数和成熟数：[`docs/DEMO_GROWTH_TREND.md`](docs/DEMO_GROWTH_TREND.md)（`make demo-growth-trend`）。  
阈值规则列表可打开一条规则的详情：[`docs/DEMO_ALERT_RULES.md`](docs/DEMO_ALERT_RULES.md)（`make demo-alert-rules`）。  
发一条超阈值环境遥测，告警列表和详情出现这条告警：[`docs/DEMO_TELEMETRY_THRESHOLD_ALERT.md`](docs/DEMO_TELEMETRY_THRESHOLD_ALERT.md)（`make demo-telemetry-threshold-alert`）。  
新增一台镜头，设备列表和镜头详情都能看到：[`docs/DEMO_CAMERA_CREATE.md`](docs/DEMO_CAMERA_CREATE.md)（`make demo-camera-create`）。  
改一台镜头的备注和状态，列表和详情都能看到：[`docs/DEMO_CAMERA_EDIT.md`](docs/DEMO_CAMERA_EDIT.md)（`make demo-camera-edit`）。  
停用一台镜头，列表和详情仍显示停用：[`docs/DEMO_CAMERA_STOP.md`](docs/DEMO_CAMERA_STOP.md)（`make demo-camera-stop`）。  
删除一台镜头，列表和详情都不再有这一台：[`docs/DEMO_CAMERA_DELETE.md`](docs/DEMO_CAMERA_DELETE.md)（`make demo-camera-delete`）。

## 接入

| 类型 | MQTT | HTTP |
|------|------|------|
| 识别 | `mushroom/+/+/recognition` | `POST /api/v1/ingest/recognition` |
| 环境 | `mushroom/+/+/environment` | `POST /api/v1/ingest/environment` |
| 心跳 | `mushroom/+/+/heartbeat` | `POST /api/v1/ingest/heartbeat` |

基地大屏路由：`/big-screen`。值班看板路由：`/duty-screen`。严重告警可选推送到企业微信 / 钉钉，见 `.env.example`。

## 部署与运维

- 登录日志、Postgres 备份、抓拍热盘 / 冷盘与云归档：[`docs/OPS_STORAGE_BACKUP.md`](docs/OPS_STORAGE_BACKUP.md)
