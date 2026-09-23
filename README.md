# mushroom-farm-platform

食用菌种植管理平台

管理端接收已有物联网 / 边缘 AI 的识别结果。这里不做图像识别。

## 唯一入口

只使用仓库根目录的 Make 目标：

```bash
make up      # docker compose 启动 Postgres / Redis / MinIO / Mosquitto
make migrate # 执行 infra/migrations
make api     # 编译契约并启动 API（:41821）
make web     # 启动管理端（:43123）
make test    # 契约、模块边界（含负例）、接入路径、API 单测、前端类型检查与 /big-screen 实体测试
make smoke   # up + migrate + 边缘模拟实体发送 HTTP/MQTT 黄金报文；证据写入 evidence/ingest-last-run/
make smoke-evidence # 与 make smoke 相同
make gates   # 交付物门禁（与 test 分开；CI 的 deliverable-gates 跑同一命令）
```

不要直接跑 `npm run start`、`vite` 或 `docker compose`。约束说明见 `ARCHITECTURE_WALLS.md`。文稿完成口径见 [`docs/PROJECT_DELIVERABLE_NORMS.md`](docs/PROJECT_DELIVERABLE_NORMS.md)。

## 上游 Day-0

本仓消费 [project-harness-day0](https://github.com/lijiaaaaa-bot/project-harness-day0) v0.1.0。门禁、协议、agent 规范、检出结构先改 harness，再同步到本仓；本仓是消费方，禁止只在这里改文稿。其他项目的 Day-0 按 harness 的 `INSTALL.md` 拷贝。现行门禁仍是本仓 `make gates`。详见 [`docs/HARNESS.md`](docs/HARNESS.md)。

开发种子账号：`admin` / `Admin@123456`。接入令牌请求头：`X-Ingest-Token: dev-ingest-token`。

登录后打开 `/big-screen`：指挥五区、抓拍墙、多区布局，底部对比时间轴可进生长趋势或按上海日筛选识别记录。默认浅色；暗色只作用在这一页。数据来自现有总览、棚区、告警、设备、识别列表和生长趋势接口。

## 假设

- MQTT 主题：`mushroom/+/+/recognition`，心跳 `mushroom/+/+/heartbeat`
- HTTP：`POST /api/v1/ingest/recognition`
- 抓拍保留 30 天，时序保留 90 天；识别与环境补传窗口 90 天
- 约 110 路摄像头、30 个棚区；角色为超管 / 生产管理员 / 棚区负责人 / 查看
- 未知棚区或摄像头首次上报时自动建档

## 严重告警推送

只推送级别为「严重」的告警到企业微信和/或钉钉群机器人。提示和一般不发送。两个地址可以同时配置。未设置时该通道关闭，API 启动和告警处理都不报错。

在 API 进程的环境变量里填写（见 `.env.example`）：

| 变量 | 作用 |
|------|------|
| `WECOM_WEBHOOK_URL` | 企业微信群机器人 webhook |
| `DINGTALK_WEBHOOK_URL` | 钉钉自定义机器人 webhook |
| `DINGTALK_WEBHOOK_SECRET` | 钉钉加签密钥。留空则不签名 |

报文是文本，以「严重告警」开头，含棚区、摄像头、标题和说明。钉钉机器人若要求关键词，可填「严重告警」。

推送失败只写入 API 日志，不改变告警是否已保存。认领、确认、关闭和误报关闭照常完成。登录后在告警页打开「企微/钉钉推送」（`/phase2/wecom`）可看到通道是否启用，以及上述变量名。状态接口是 `GET /api/v1/alerts/push-channels`，只返回是否启用，不返回地址。

## 发布 MQTT 测试报文

`make up` 启动 Mosquitto，本机端口 `1883`，允许匿名连接。识别主题与契约一致：`mushroom/{棚区编号}/{摄像头编号}/recognition`（订阅过滤器 `mushroom/+/+/recognition`）。报文就是 HTTP 接入用的同一份 JSON，多出来的字段会被 `.strict()` 拒绝，错误码为 `UNKNOWN_FIELD`。

先在一个终端运行 `make api`，等日志出现「MQTT 已订阅」。发送方是 `scripts/edge-simulator.mjs`：它只读契约夹具的 `body`，用 `withRuntimeClock` 把 `recognizedAt` 换成当前时间，再用本机 `mqtt` 客户端发到 Mosquitto。stdout 是一条 JSON，里面有主题和发出的原始 UTF-8。这不是客户现场抓包。

```bash
node scripts/edge-simulator.mjs --channel mqtt --fixture recognition.mqtt.json
node scripts/edge-simulator.mjs --channel http --fixture recognition.golden.json
node scripts/edge-simulator.mjs --channel mqtt --heartbeat
```

宿主机没有 MQTT 客户端时，可以用 compose 里的 `mosquitto_pub`（把时间换成当前 UTC）：

```bash
docker compose exec mosquitto mosquitto_pub -h 127.0.0.1 -p 1883 \
  -t mushroom/S01/CAM-S01-MQTT/recognition \
  -m '{"idempotencyKey":"manual-mqtt-001","shedCode":"S01","cameraCode":"CAM-S01-MQTT","recognizedAt":"2026-09-23T02:00:00.000Z","mushroomCount":80,"matureCount":52,"capDiameters":[4.2,5.1,6],"diseaseCount":2,"diseaseLevel":1}'
```

登录管理端后打开识别记录，或请求 `GET /api/v1/ingest/recognitions?cameraCode=CAM-S01-MQTT`。同一 `idempotencyKey` 再发一次不会多出一条记录，和 HTTP 共用幂等。`make smoke` 由边缘模拟实体发布 `recognition.mqtt.json` 和 `heartbeat.mqtt.json`，核对列表里 `source` 为 `mqtt`、未知字段写入 `ingest_rejects`，并把每一步的主题、原始字节和结果写到 `evidence/ingest-last-run/summary.json`。CI job `ingest-smoke` 上传该目录，artifact 名为 `ingest-smoke-evidence`。`evidence/ingest-sample/` 是一次真实跑完后留下的样本，标签仍是契约黄金报文。
