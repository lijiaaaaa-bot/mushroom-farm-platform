# 食用菌种植管理平台

管理端接收已有物联网 / 边缘 AI 的识别结果。这里不做图像识别。

## 唯一入口

只使用仓库根目录的 Make 目标：

```bash
make up      # docker compose 启动 Postgres / Redis / MinIO / Mosquitto
make migrate # 执行 infra/migrations
make api     # 编译契约并启动 API（:41821）
make web     # 启动管理端（:43123）
make test    # 契约测试、模块边界、API 单测、前端类型检查
make smoke   # up + migrate + 黄金报文接入 + 列表 + 告警确认
```

不要直接跑 `npm run start`、`vite` 或 `docker compose`。约束说明见 `ARCHITECTURE_WALLS.md`。

开发种子账号：`admin` / `Admin@123456`。接入令牌请求头：`X-Ingest-Token: dev-ingest-token`。

## 假设

- MQTT 主题：`mushroom/+/+/recognition`，心跳 `mushroom/+/+/heartbeat`
- HTTP：`POST /api/v1/ingest/recognition`
- 抓拍保留 30 天，时序保留 90 天
- 约 110 路摄像头、30 个棚区；角色为超管 / 生产管理员 / 棚区负责人 / 查看
- 未知棚区或摄像头首次上报时自动建档
