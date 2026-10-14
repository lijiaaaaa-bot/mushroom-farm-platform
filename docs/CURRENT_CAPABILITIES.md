# 当前能力

对照已合并 `main`（含 PR #81，`04f7665`）里的路由、控制器和脚本。这里写代码现在做什么。规模数字来自 `facts.json` 与种子数据，不把 `docs/需求规格说明书.md` 当成另一份需求原文。

## 产品定位

业务层接收客户已经在跑的物联网和边缘 AI 结果：识别报文、环境读数、设备心跳。本仓做接入、告警闭环、管理端、大屏和台账。

本仓不做图像识别，也不训练视觉模型。不重建通用物联网平台（设备协议栈、组网、端侧推理都不在这里）。

## 可运行入口

仓库根目录只用 Make：

| 目标 | 作用 |
|------|------|
| `make up` | Compose 启动 Postgres、Redis、MinIO、Mosquitto |
| `make migrate` | 执行 `infra/migrations` |
| `make api` | 编译契约并启动 API，端口 **41821**，前缀 `/api/v1` |
| `make web` | 管理端，端口 **43123** |
| `make test` | 契约、边界、接入、API 单测、前端类型检查与页面测试 |
| `make smoke` | 边缘模拟向 HTTP / MQTT 发黄金报文，证据写入 `evidence/ingest-last-run/` |
| `make gates` | 文档门禁。退出码 0 才算文稿过关 |
| `make backup` | `pg_dump` 写出 `backups/mushroom-<时间>.sql`。Redis 与 MinIO 不在该文件中 |
| `make object-tier` | 热冷复制。未设置 `MINIO_APPLY_TIER=1` 时只打印计划 |

开发种子账号：`admin` / `Admin@123456`（角色 `super_admin`）。接入请求头：`X-Ingest-Token`，默认值 `dev-ingest-token`（环境变量 `INGEST_TOKEN`）。未带令牌的接入请求会被拒绝。

另外三枚种子账号在 API 启动时写入（已存在则不覆盖）：`producer` / `Producer@123456`（生产管理员，全场）、`shedlead` / `Shed@123456`（棚区负责人，仅 S01）、`viewer` / `Viewer@123456`（查看，仅 S01）。

## 接入

管理端路由：`/ingest-observability`（接入观测）、`/recognitions`（识别记录）、`/environment`（环境读数）、`/devices`（心跳落在设备上）。

| 通道 | 入口 | 落库 |
|------|------|------|
| 识别 | `POST /api/v1/ingest/recognition`；MQTT `mushroom/+/+/recognition` | `recognition_records`，并增量写入小时桶、日桶 |
| 环境 | `POST /api/v1/ingest/environment`；MQTT `mushroom/+/+/environment` | `environment_readings`，并按 `observedAt` 写入环境桶 |
| 心跳 | `POST /api/v1/ingest/heartbeat`；MQTT `mushroom/+/+/heartbeat` | 更新设备 `lastHeartbeatAt` / 在线状态 |

三条 HTTP 都要 `X-Ingest-Token`。MQTT 与 HTTP 走同一套解析。多出来的字段按契约 `.strict()` 拒绝，错误码 `UNKNOWN_FIELD`。识别与环境补传窗口 90 天（`LIMITS.recognizedAtPastDays`），超出拒收。

发一条样例识别：`make demo-one-ingest`。样例是 `packages/contracts/fixtures/recognition.demo-one.json`（棚区编号、摄像头编号、识别时间、蘑菇数量、成熟数量、各菌盖直径、病害数量、病害等级、AI抓拍图、环境温湿度、CO₂、基质含水率）。脚本把识别时间改成当前时刻，幂等键改成 `demo-one-<毫秒>`，只 POST 一次 `POST /api/v1/ingest/recognition`，终端打印记录 id 和抓拍对象键。成功还要求 `GET /api/v1/ingest/recognitions/<id>/snapshot` 读回的字节与样例 JPEG 一致；读不到则命令失败。登录 `admin` / `Admin@123456` 后打开 `/recognitions?cameraCode=CAM-DEMO-01`。同一条按识别时间出现在 `/big-screen` 抓拍墙。步骤见 [`DEMO_ONE_INGEST.md`](DEMO_ONE_INGEST.md)。MQTT 备选是 `node scripts/demo-one-http-recognition.mjs --channel mqtt`，主题 `mushroom/S01/CAM-DEMO-01/recognition`。

幂等：Redis `SETNX`，键存活 7 天（`IDEMPOTENCY_TTL_SECONDS`），再加数据库唯一约束。识别优先用报文 `idempotencyKey`，否则按棚、摄像头、识别时间哈希。环境优先用显式键，否则按棚、传感器、观测时间哈希。同一键再发返回已有记录，不双计。心跳在 `reportedAt` 不新于已存心跳时记为重复。

拒收观测：校验失败写入拒收记录。`GET /api/v1/ingest/observability` 汇总近窗接收、拒收、延迟和最近错误，覆盖识别（HTTP/MQTT）、环境与心跳。页面加载失败不渲染空表。棚区负责人看不到他棚，也看不到没有棚号的拒收。

自动建档：识别入库调用 `touchCamera`，未知棚调用 `ensureShed`，未知摄像头按编号建档（`meta.autoRegistered`）。环境与心跳走 `devices.heartbeat`，同样会建棚，并把未知设备登记为传感器或报文里的设备类型。新棚没有平面坐标。

抓拍：识别报文里的图尽量写入 MinIO，PostgreSQL 只存对象键和 URL。MinIO 不可用时识别记录仍入库，抓拍跳过。读取：`GET /api/v1/ingest/recognitions/:id/snapshot`。

已知限制：本仓不拉流、不识别画面。接入观测是汇总接口，不是客户现场链路监控。

## 总览与大屏

总览页面路由是 `/`（`DashboardView`）。接口是 `GET /api/v1/dashboard/overview`，同页还读 `GET /api/v1/sheds`、`GET /api/v1/devices`、`GET /api/v1/harvest/daily`、`GET /api/v1/ingest/environment-readings`、`GET /api/v1/alert-rules`。有序列时画近端成熟、总数、病害；温度图的阈值线只来自已启用规则。棚区平面只用已配置的 `mapX` / `mapY`。

大屏路由 `/big-screen`，根节点 `data-skin=tb-night`（夜色只在这一页）。默认一屏为指标、棚区平面、抓拍墙、告警与环境；可切抓拍墙或带时间轴的多区。时间轴进入 `/growth-trends`，或按上海日打开 `/recognitions`。数据来自总览、棚区、告警、设备、识别列表，以及 `GET /api/v1/growth-trends`（7 日）或 `GET /api/v1/growth-trends/hours`（24 小时）。侧栏「基地大屏」链到此页。`/phase2/big-screen` 重定向到 `/big-screen`。

值班看板路由 `/duty-screen`，同样不在管理端壳内。侧栏与顶栏在「基地大屏」后面链到此页。中部每棚一张卡，没有摄像头名牌，点进 `/duty-screen/:shedCode`。状态按可见数据取：摄像头全部离线（或没有摄像头）为离线；否则有未闭合告警为告警；两者都清楚且没有未闭合告警为正常；缺一截则是未知，不把失败写成正常。在线数只数 `type=camera`，来自 `GET /api/v1/devices?type=camera`。今日识别是 `GET /api/v1/growth-trends?days=7` 当天棚级日桶的 `sampleCount`（识别条数，不是蘑菇数）；日桶请求失败时显示「—」，不用 0 充数。未闭合告警分两次拉 `GET /api/v1/alerts` 的 `status=open` 与 `status=acked`，每棚只留一条：严重优先，同级取较新。有告警时这一行用告警说明（去掉「摄像头 …」字样）；整棚离线且没有告警时写最近心跳。列表每页 100 条，最多再翻 19 页；取不全时页面写明。右侧用 `GET /api/v1/ingest/observability` 的默认近窗（接收、拒收、分通道、最近错误）和未闭合告警标题。底部用 `GET /api/v1/dashboard/overview` 的棚数、设备在线、今日蘑菇、今日成熟、未闭合告警、严重告警和环境均值，以及分棚当日识别条数和棚级蘑菇数。不画准确率、帕累托或机器资源。`/big-screen` 不改。

棚详情路由 `/duty-screen/:shedCode`（`DutyShedDetailView`），同样不在管理端壳内，夜色与值班看板同一套。返回链回 `/duty-screen`。页上是棚名和编码、与棚卡相同的状态（正常、告警、离线、未知），以及在线摄像头数和未闭合条数。摄像头来自 `GET /api/v1/devices?type=camera&shedCode=`，列出名称、编码、在线或离线、`lastHeartbeatAt`（Asia/Shanghai，精确到分钟）；没有心跳写「—」。未闭合告警分两次拉 `GET /api/v1/alerts` 的 `status=open` 与 `status=acked`，并带已有的 `shedCode`，按时间从新到旧，每条显示标题、级别、状态、时间。点一条进入 `/alerts?shedCode=&status=&alertId=`。告警页把棚号和合法状态传给已有的 `GET /api/v1/alerts`，并把该 `alertId` 高亮、滚到视口内。棚列表仍是 `GET /api/v1/sheds`；编码不在可见棚里时写「没有这个棚」，状态为未知。列表失败不把空表写成没有摄像头或没有告警。每页 100 条，最多再翻 19 页。不改接口，不改 `/big-screen`。

棚区页 `/sheds`：`GET /api/v1/sheds` 按棚隔离列出。`PATCH /api/v1/sheds/:id` 只改平面坐标（0–100），仅超管与生产管理员可写。

## 设备、识别、环境、病害

设备 `/devices`。`GET/POST /api/v1/devices`，`PATCH /api/v1/devices/:id`，`POST /api/v1/devices/import`（CSV 文件、CSV 文本或 JSON 行）。导入时编码冲突跳过且不改原档案。单条 `POST` 遇到已有编码返回 409，文案「设备编码已存在」。登记字段：编号 `code`、名称 `name`、类型 `type`（页面固定为 `camera`）、棚区 `shedCode`、备注 `note`（可空，最长 500 字，空白记为 null）。`PATCH` 可改备注。超管与生产管理员可登记和改备注；棚区负责人可导入，不能单条登记或改备注；查看人员 403。心跳超时（默认 5 分钟，`DEVICE_OFFLINE_AFTER_MS`）产生「设备离线」告警，恢复心跳自动关闭。在线状态以 `lastHeartbeatAt` 为准。登记和改备注不改在线状态，之后的心跳也不清备注。

### 登记一台摄像头

数据库和前后端已经在跑就跳过这三步：

```bash
make up && make migrate
make api
make web
```

API 是 http://127.0.0.1:41821 。页面是 http://127.0.0.1:43123 。

浏览器打开 http://127.0.0.1:43123/login ，账号 `admin`，密码 `Admin@123456`。然后打开 http://127.0.0.1:43123/devices 。

1. 「登记摄像头」填编号 `CAM-REG-01`、棚区 `S01`、名称 `东侧过道`、备注 `靠门`，点「登记」。
2. 下方「摄像头 / AI 盒 / 传感器」列表出现这一行：编号 CAM-REG-01，名称东侧过道，类型摄像头，棚区 S01，状态离线，备注靠门。
3. 把该行备注改成 `靠门，已核对`，点「保存」。
4. 刷新 http://127.0.0.1:43123/devices 。备注仍是「靠门，已核对」。状态仍是离线，直到有心跳。

同一条用接口时，先登录，从响应里复制 `accessToken`：

```bash
curl -s -X POST http://127.0.0.1:41821/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"Admin@123456"}'
```

把令牌放进 `TOKEN` 后：

```bash
curl -s -X POST http://127.0.0.1:41821/api/v1/devices \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"code":"CAM-REG-01","name":"东侧过道","type":"camera","shedCode":"S01","note":"靠门"}'
```

响应里的 `id` 用于改备注，再按摄像头类型拉列表：

```bash
curl -s -X PATCH "http://127.0.0.1:41821/api/v1/devices/<id>" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"note":"靠门，已核对"}'

curl -s "http://127.0.0.1:41821/api/v1/devices?type=camera" \
  -H "Authorization: Bearer $TOKEN"
```

列表里这条的 `code` 是 `CAM-REG-01`，`note` 是「靠门，已核对」。棚区用种子里已有的 `S01`。

### 登记后发一条识别

`make demo-register-and-ingest` 用同一条 `POST /api/v1/devices` 登记 `CAM-REG-02`（棚区 `S01`，名称西侧过道，备注演示登记）。编码已存在则不改原档案。然后读取 `recognition.demo-one.json`，把本次请求的摄像头编号改成 `CAM-REG-02`，识别时间改成当前时刻，幂等键改成 `demo-reg-02-<毫秒>`，只 POST 一次 `POST /api/v1/ingest/recognition`。样例文件里的 `CAM-DEMO-01` 不改。成功时终端打印 id 和抓拍对象键，并且 `GET /api/v1/ingest/recognitions/<id>/snapshot` 读回样例 JPEG。登录后打开 `/devices` 能看到这台摄像头，打开 `/recognitions?cameraCode=CAM-REG-02` 能看到这一条（成熟 5，总数 12，病害 1）。步骤见 [`DEMO_REGISTER_AND_INGEST.md`](DEMO_REGISTER_AND_INGEST.md)。`make demo-one-ingest` 仍发 `CAM-DEMO-01`。

### 登记后发一条心跳

`make demo-register-and-heartbeat` 用同一条 `POST /api/v1/devices` 登记 `CAM-REG-02`（棚区 `S01`，名称西侧过道，备注演示登记）。编码已存在则不改原档案。然后只 POST 一次 `POST /api/v1/ingest/heartbeat`，请求头 `X-Ingest-Token`。报文体是棚区 `S01`、设备编号 `CAM-REG-02`、设备类型 `camera`、`online` 为 true、心跳时间为当前时刻。形状参考 `heartbeat.http.json`，该文件仍是 `EDGE-SIM-BOX` / `ai_box`，命令不改文件。成功时再读 `GET /api/v1/devices?type=camera&shedCode=S01`，这一行的 `onlineStatus` 必须是 `online`，并且 `lastHeartbeatAt` 有值。登录后打开 `/devices`，这一行状态是在线。打开 `/duty-screen/S01`，编码 `CAM-REG-02` 的状态是在线，最近心跳有时间。`/duty-screen` 的 S01 卡把这台计入在线摄像头。不发识别。步骤见 [`DEMO_REGISTER_AND_HEARTBEAT.md`](DEMO_REGISTER_AND_HEARTBEAT.md)。

识别 `/recognitions`。`GET /api/v1/ingest/recognitions`，可按摄像头、上海日筛选。有图时打开已存抓拍。

环境 `/environment`。`GET /api/v1/ingest/environment-readings` 列出最近读数（温度、湿度、CO₂、基质含水率）。数据来自环境报文，不用识别报文里的温湿度充数。

病害 `/diseases`。`GET /api/v1/diseases` 只列 `diseaseCount>0` 的识别。同屏环境：`GET /api/v1/diseases/:id/environment`，按该识别的棚，取识别时间前后各 30 分钟（`DISEASE_ENV_WINDOW_MINUTES`）的环境读数；无读数返回「该时间窗内无环境读数」。高发：`GET /api/v1/diseases/peaks`，默认小时粒度读 `metric_buckets_hour`，`grain=day` 读日桶；页面在有桶时展示峰值。病害档案仍是识别明细，不是桶。

## 告警与阈值规则

告警 `/alerts`。`GET /api/v1/alerts`。页面可按状态、级别筛选，选全部不传。摄像头编号填在「摄像头」里，点「筛选」后请求带 `cameraCode`，按编号精确匹配；空白或点「清除」则不传。地址栏 `?cameraCode=` 同样生效。值班棚详情带入的 `shedCode` 传给同一列表接口；`alertId` 只高亮该行，不是新的查询参数。侧栏再打开 `/alerts` 时不带这几项。列表里的标题链到 `/alerts/:id`。当前有摄像头筛选时，这条链接和详情页的「返回告警列表」带上同一个 `cameraCode`。

`GET /api/v1/alerts/:id` 返回这一条（棚区、摄像头、级别、状态、标题、说明、指标、当前值、阈值、发生时间、认领人、关闭原因）。查看人员可读自己棚内的告警；棚外 403；没有这条 404。详情页用中文标签显示这些字段。手工新建的告警没有指标时，指标、当前值、阈值显示为「—」。

`make demo-one-alert` 读取 `recognition.demo-one.json`，把本次请求的摄像头改成 `CAM-ALERT-01`、温度改成 30，只 POST 一次识别。样例文件里的 `CAM-DEMO-01` 与温度 22.5 不改。种子规则「温度过高」（阈值 28，严重）因此留下一条未闭合告警。同一摄像头已有未闭合的温度过高告警时不再新建，命令仍打印该条 id。登录后打开 `/alerts`，点标题进入 `/alerts/:id`。步骤见 [`DEMO_ONE_ALERT.md`](DEMO_ONE_ALERT.md)。

待确认的行可以点「确认」，未关闭的行可以点「关闭」。列表点下去后重新请求 `GET /api/v1/alerts`。详情页同样两个按钮：确认备注为「已确认」，关闭备注为「已关闭」，然后重新请求 `GET /api/v1/alerts/:id`。刷新页面后状态仍是这次写入的结果。查看人员没有这两个按钮。列表上的「处置备注」默认是「已确认」，确认和关闭都带上这个备注。

`make demo-ack-one-alert` 确认这条待确认的温度过高告警，再读详情和 `status=acked` 的列表。已经是已确认、没有待确认时命令失败，不改这条告警。`make demo-close-one-alert` 关闭这条未闭合告警（待确认或已确认），再读详情和 `status=closed` 的列表。没有未闭合告警时，先按 `make demo-one-alert` 的方式补一条识别再关闭。两个命令都不改样例文件，也不改 `make demo-one-alert`。步骤见 [`DEMO_ACK_CLOSE_ALERT.md`](DEMO_ACK_CLOSE_ALERT.md)。

`make demo-threshold-alert` 用 `PATCH /api/v1/alert-rules/:id` 把规则「演示二氧化碳过高」的阈值从 1500 改成 1000（没有这条规则时先 `POST` 一条，级别一般，棚区 S01）。再把样例识别的摄像头改成 `CAM-THRESH-01`、CO₂ 改成 1200，POST 一次。`GET /api/v1/alerts` 的待确认列表里有标题「CO₂过高告警」，说明里写着 1200 和阈值 1000。种子规则「二氧化碳过高」仍是 2000。样例文件里的 CO₂ 900 不改，已有演示报文不超过 1000。这台摄像头上同规则的未闭合告警会先关闭，其他摄像头的告警不动。步骤见 [`DEMO_THRESHOLD_ALERT.md`](DEMO_THRESHOLD_ALERT.md)。

`make demo-alert-camera-filter` 用 `POST /api/v1/alerts` 留下两条未闭合告警：棚区 S01 的 `CAM-FILTER-01`（标题「东侧过道告警」）和 `CAM-FILTER-02`（标题「西侧过道告警」）。同摄像头、同标题已有未闭合告警则沿用，不新建。然后 `GET /api/v1/alerts?cameraCode=CAM-FILTER-02` 只含这台摄像头，`GET /api/v1/alerts/:id` 仍能打开它；不带 `cameraCode` 的列表里两条都在。不发识别，不改阈值规则，不确认或关闭其他告警。登录后在 `/alerts` 填写摄像头编号并点「筛选」，点标题进详情，点「清除」回到多摄像头列表。步骤见 [`DEMO_ALERT_CAMERA_FILTER.md`](DEMO_ALERT_CAMERA_FILTER.md)。

| 动作 | 接口 | 结果 |
|------|------|------|
| 确认 | `POST /api/v1/alerts/:id/ack` | 状态 `acked` |
| 认领 | `POST /api/v1/alerts/:id/claim` | 写入认领人 |
| 关闭 | `POST /api/v1/alerts/:id/close` | `closed`，关闭原因 `resolved` |
| 误报 | `POST /api/v1/alerts/:id/false-positive` | `closed`，关闭原因 `false_positive` |
| 未读 | `GET /api/v1/alerts/unread`，`POST /api/v1/alerts/:id/read`，`POST /api/v1/alerts/read-all` | 已读记在 `alert_reads`，不改告警状态 |

认领、误报、关闭、确认写入审计。查看人员只读。顶栏未读约 15 秒轮询；浏览器通知只在用户授权后发出。

阈值规则 `/alert-rules`。`GET/POST /api/v1/alert-rules`，`PATCH /api/v1/alert-rules/:id`。写权限仅超管与生产管理员。指标含成熟占比、成熟数量、病害数量、病害等级、生长停滞、温度过高/过低、湿度过高/过低、CO₂ 过高、基质含水率过低。级别为提示、一般、严重。

## 生长趋势

页面 `/growth-trends`。日趋势 `GET /api/v1/growth-trends?days=7|30`（只接受 7 或 30），读 `metric_buckets_day`。小时趋势 `GET /api/v1/growth-trends/hours` 读 `metric_buckets_hour`。环境曲线 `GET /api/v1/growth-trends/environment` 读环境小时桶。页面只画已有点。棚隔离。

写路径：识别入库按 `recognizedAt`（Asia/Shanghai）增量 upsert 小时桶与日桶，同一幂等键不双计。环境入库按 `observedAt` 同样增量写入。`daily_aggregates` 已停写并删除（迁移 `010_drop_daily_aggregates.sql`）。

已知限制：每小时 cron 与采摘修正蘑菇数后，`refreshDay` 会重扫该上海日的识别明细，回写识别指标桶；环境桶留在原行。打开趋势页本身不扫识别明细。

## 采摘

页面 `/harvest`。查看人员只读；超管、生产管理员、棚区负责人可改。

当日清单：`GET /api/v1/harvest/daily`（`/daily/list` 同一份数据）。`PATCH /api/v1/harvest/daily/:id` 修正成熟数与蘑菇数，写回识别记录，并记审计（谁、何时、旧值到新值、棚、摄像头）。成熟数不能大于蘑菇数。汇总随修正更新。他棚 403。

任务清单与排班：`GET /api/v1/harvest/tasks?date=`，`POST /api/v1/harvest/tasks/generate`，`PATCH /api/v1/harvest/tasks/:id`。生成规则：当日成熟数大于 0 的摄像头进入清单；已有任务只更新数量，保留人员和班次；不再成熟、且仍是未排的待采任务才从清单去掉。排班字段：人员、班次 `morning` / `afternoon`、状态 `open` / `scheduled` / `done`。页面给出上午、下午、未排条数。

两套成熟估计，响应都带标签「估计」。数字是未来日的**成熟数**，不是公斤。

| 接口 | 算法 | 给不出数字时 |
|------|------|----------------|
| `GET /api/v1/harvest/yield-estimate` | 近 30 个上海自然日，各摄像头当日最新成熟数之和，按日序线性外推未来 3 日 | 不满连续 30 天：只返回说明，`days` 为空 |
| `GET /api/v1/harvest/bucket-forecast` | 近 7 个上海自然日、棚级成熟日桶，用首尾差除以间隔天数得到增速，外推未来 3 日 | 少于 2 个相隔不少于 1 天的成熟日桶：只返回说明，`days` 为空 |

## 出菇批次

页面 `/batches`。表 `flush_batches`、`flush_phase_events`。

| 动作 | 接口 |
|------|------|
| 列表 | `GET /api/v1/batches` |
| 新建 | `POST /api/v1/batches`（棚号、批次号、开始时间、备注）。新建阶段为出菇 `flush` |
| 记阶段 | `POST /api/v1/batches/:id/phases`。阶段只支持 `flush`（出菇）、`fast_growth`（快速生长）、`mature`（成熟） |
| 结束 | `POST /api/v1/batches/:id/close` |
| 回放 | `GET /api/v1/batches/:id/replay` |

回放读该棚棚级日桶（`metric_buckets_day` 且 `cameraCode` 为空）：蘑菇数、成熟数、菌盖直径均值。计数取当天桶值，不把多日相加。窗口从批次开始日到结束日（未结束则到当天）。写操作仅超管、生产管理员、棚区负责人；查看人员不能新建。他棚 403。

已知限制：阶段由人调用 `POST /api/v1/batches/:id/phases` 记录，不从识别结果自动推进。原始需求要自动记阶段，但没有切换条件；未确认前不发明阈值。可选口径写在 [`docs/OPS_STORAGE_BACKUP.md`](OPS_STORAGE_BACKUP.md)。回放不读摄像头级桶。

## 报表

页面 `/reports`。登录后可用，按棚隔离。没有登录后的浏览器端到端测试；页面行为由 vitest 覆盖。

预览与按筛选导出读日桶（生长、产量、病害、环境）或当前设备/告警表。接口：

- `GET /api/v1/reports/preview`
- `GET /api/v1/reports/export.xlsx`

查询参数：`kind`、`grain`（仅生长）、`from`、`to`、`shedCode`。未传日期时，结束日为上海今天，开始日为往前 6 天。生长粒度 `day` / `week` / `month`，周和月取该周期最后一天有数的蘑菇数与成熟数。

| `kind` | 页面名称 | 预览数据 |
|--------|----------|----------|
| `growth` | 园区生长 | 日桶：蘑菇数、成熟数、成熟率、平均菌盖直径 |
| `yield` | 分棚产量 | 日桶：分棚蘑菇数、成熟数、菌盖 |
| `disease` | 病害统计 | 日桶病害数 |
| `environment` | 环境监控 | 日桶温度、湿度、CO₂、基质含水率 |
| `devices` | 设备在线 | 设备表（编号、名称、类型、棚、在线、最近心跳） |
| `alerts` | 告警闭环 | 告警表（等级、状态、关闭原因、棚、摄像头、标题、认领人、关闭人、时间） |

设备报表可筛在线（全部 / 在线 / 离线），告警报表可筛状态（全部 / 待确认 / 已确认 / 已关闭，文案与告警页一致）。选中后预览与 `export.xlsx` 传 `online=online` 或 `offline`、`status=open` / `acked` / `closed`；选全部不传。接口按该值过滤：`online` 只认 `online` 与 `offline`，告警状态按 `open`、`acked`、`closed` 精确匹配。

浏览器打印：预览区出现后，按钮调用 `window.print()`，打印当前页。没有单独的打印样式表。

页面上另有五个快捷下载，和上面的预览不是同一条读路径：

| 文件 | 接口 | 数据 |
|------|------|------|
| `growth.xlsx` | `GET /api/v1/reports/growth.xlsx` | 识别明细，默认近 7 日，最多 5000 行 |
| `disease.xlsx` | `GET /api/v1/reports/disease.xlsx` | 同上，病害字段与抓拍对象键 |
| `env.xlsx` | `GET /api/v1/reports/env.xlsx` | 识别记录上的温度、湿度、CO₂、基质含水率，不是 `environment_readings` |
| `devices.xlsx` | `GET /api/v1/reports/devices.xlsx` | 当前可见设备 |
| `alerts.xlsx` | `GET /api/v1/reports/alerts.xlsx` | 当前可见告警，最多 5000 行 |

空文件时页面写「该报表没有可导出的数据」。

## 权限

四个角色，界面文案来自契约 `ROLE_LABEL`：

| 代码 | 界面 | 棚范围 | 写操作 |
|------|------|--------|--------|
| `super_admin` | 超管 | 全场 | 用户、阈值规则、棚坐标、采摘修正、采摘任务、批次、设备导入、摄像头登记与备注、告警处置、审计 |
| `production_admin` | 生产管理员 | 全场 | 与超管相同，但不能建用户 |
| `shed_manager` | 棚区负责人 | 仅账号上的棚号 | 采摘修正、采摘任务、批次、设备导入、告警处置。不能改规则、不能改棚坐标、不能单条登记摄像头或改备注、不能看审计 |
| `viewer` | 查看 | 仅账号上的棚号 | 只读。采摘、告警处置、规则、批次新建、设备登记均 403 |

棚隔离在认证之后（`ShedScope`）。超管与生产管理员不限制棚；棚区负责人与查看只保留账号上的棚号；棚号列表为空则看不到任何棚。越权返回 403。

用户接口 `GET/POST /api/v1/users` 仅超管。管理端没有用户页。审计页 `/audit`：上方是登录日志，下方是操作审计。`GET /api/v1/audit-logs` 与 `GET /api/v1/login-logs` 都仅超管与生产管理员。登录日志可按 `username`、`from`、`to` 筛选。审计页登录日志区可填用户名与起止日期，空值不传这些参数。

## 存储

| 组件 | 现状 |
|------|------|
| PostgreSQL | `make up` 使用 `postgres:16-alpine`，库 `mushroom`。业务表含识别、环境、告警、设备、棚、桶、批次、采摘任务 |
| Timescale | 可选。`docker compose -f docker-compose.yml -f docker-compose.timescale.yml` 只换 Postgres 镜像。`009_timescale_optional.sql` 在 `make migrate` 时执行：没有扩展只写 NOTICE，有扩展也不在这条迁移里建 hypertable。`infra/timescale/enable.sql` 不进 `make migrate` |
| Redis | Compose `redis:7-alpine`，端口 6379。接入幂等 `SETNX`。Redis 不可用时仍靠唯一约束去重 |
| MinIO | `make up` 构建本地镜像 `mushroom-object-store:20260916`（`infra/object-store/Dockerfile`）。二进制是 GitHub Release `RELEASE.2026-09-16T00-00-00Z` 的 linux 包，sha256 校验后装入。不拉取 `pgsty/silo`，也不拉取 `quay.io/minio/minio`。端口 9000 / 控制台 9001，桶默认 `mushroom-snapshots`。数据在命名卷 `minio-hot`（`MINIO_HOT_DATA` 可改为 SSD 路径）。抓拍字节在这里，PostgreSQL 存对象键。Mosquitto 端口 1883，匿名 |
| 冷 MinIO | 可选。与热盘同一本地镜像。`docker-compose.minio-cold.yml`，端口 9002 / 控制台 9003，卷 `minio-cold`（`MINIO_COLD_DATA` 可改为 HDD 路径）。`make up` 不起冷端 |
| 登录日志 | 表 `login_logs`（迁移 `012_login_logs.sql`）。成功与失败都写：用户、结果、时间、IP、User-Agent。`GET /api/v1/login-logs` |
| Postgres 备份 | `make backup` → `backups/mushroom-<时间>.sql`。Redis 不备份。MinIO 字节不在该文件中 |

热冷复制脚本 `node scripts/object-tier.mjs`（`make object-tier`）。未设置 `MINIO_APPLY_TIER=1` 时只打印计划，退出码 0，不连接存储。设置之后必须同时有热端和冷端端点与密钥：把超过热天数的 `snapshots/` 复制到冷桶，读回字节一致才从热端删除。读回不一致或不可达时退出码非 0，当前对象留在热端。此脚本不调用 `setBucketLifecycle`。

云归档脚本仍是 `node scripts/object-lifecycle.mjs`，计划在 `infra/object-lifecycle.json`：前缀 `snapshots/`，热 90 天（可用 `OBJECT_HOT_DAYS` 覆盖）后转到 `GLACIER`。

默认**未下发**：未设置 `MINIO_APPLY_LIFECYCLE=1` 时只打印计划，退出码 0，不调用 MinIO。

算已下发必须同时满足：`MINIO_APPLY_LIFECYCLE=1`，以及 `MINIO_ENDPOINT`、`MINIO_ACCESS_KEY`、`MINIO_SECRET_KEY`，脚本 `setBucketLifecycle` 之后 `getBucketLifecycle` 读回同一前缀的启用规则。缺密钥、端点不可达、存储类被拒绝或读回不匹配时退出码非 0，不把失败当成已生效。

本地 compose 的 MinIO 没有远端存储类。在这份热 MinIO 上按上面的条件去下发会失败，进程非零退出（fail-closed）。没有冷端时，热冷复制同样拒绝执行，不会把单机 MinIO 说成已经转冷。

打开抓拍的 API 只读热端。对象离开热端后，页面打不开该图，本仓不自动回源。步骤与 cron、恢复命令见 [`docs/OPS_STORAGE_BACKUP.md`](OPS_STORAGE_BACKUP.md)。

## 严重告警推送

只推送级别为「严重」的告警到企业微信和/或钉钉。提示和一般不发送。

| 变量 | 作用 |
|------|------|
| `WECOM_WEBHOOK_URL` | 企微群机器人 |
| `DINGTALK_WEBHOOK_URL` | 钉钉机器人 |
| `DINGTALK_WEBHOOK_SECRET` | 钉钉加签。留空则不签名 |

未配置则不发送、不报错，API 照常启动。推送失败只记日志，不改变告警是否已保存。认领、确认、关闭、误报照常完成。

`GET /api/v1/alerts/push-channels` 只返回两个通道是否启用，不返回地址。告警页链到 `/phase2/wecom` 查看说明。企微不进侧栏。

## 未做 / 诚实边界

| 项 | 说明 |
|----|------|
| 图像识别 | 不接收画面做识别，不训练模型。只收边缘侧已经算好的计数字段和可选抓拍 |
| 客户物联网链路 | 不替客户管传感器接入、网关和端侧推理。这里只有 HTTP / MQTT 收结果 |
| LLM 产品摘要 | 没有面向用户的模型摘要、问答或自动周报 |
| 报表浏览器走查 | `/reports` 有组件测试。没有登录后用浏览器走完筛选、导出、打印的端到端测试 |
| 演示规模 | 种子是 S01、S02、S03 三棚。`facts.json` 记载约 30 个棚区、110 路摄像头。当前库内数据和大屏样张不是该规模 |
| Timescale 生产形态 | 默认仍是普通 Postgres。可选镜像与 `009` 的 NOTICE 没有把明细表改成 hypertable |
| 对象生命周期 | 云归档默认未下发。本地热 MinIO 无远端存储类时，配置下发会失败。自建冷盘复制默认不执行 |
| 日聚合旧表 | `daily_aggregates` 已删除。趋势、总览、大屏、批次回放、报表预览读桶 |
| 两套估计的空窗 | 不满 30 个上海自然日时，线性估计不给未来数字。日桶不足两天时，增速估计不给未来数字 |
| 产量单位 | 两套估计和采摘清单上的数字是成熟个数，不是公斤 |
| 快捷环境表 | `env.xlsx` 取识别记录上的环境字段。环境监控预览才读环境日桶 |
| 用户页 | 只有超管 API，侧栏没有用户管理 |
| 批次阶段 | 人工记录。自动切阶段没有业主确认的条件，不实现 |

## 证据指针

- 接入跑样：`evidence/ingest-sample/summary.json`；`make smoke` 当次目录 `evidence/ingest-last-run/`
- 过夜决策：`evidence/overnight-metric-buckets-67-69/decisions.tsv`、`evidence/overnight-orig-gaps/decisions.tsv`
- 大屏样张：`docs/evidence/monitor-batch`
- 谓词：`docs/OVERNIGHT_PRED_GAPS.md`；时序与生命周期说明：`docs/timescale-and-object-lifecycle.md`；备份、登录日志与热冷盘：`docs/OPS_STORAGE_BACKUP.md`
- 相关 PR：#70 识别入桶，#71 读桶与环境入桶，#74 去掉无用占位，#75 删除 `daily_aggregates`，#81 批次、采摘任务、报表预览与对象生命周期真下发（`04f7665`）。Issue #66–#69、#73、#77–#80 已关
