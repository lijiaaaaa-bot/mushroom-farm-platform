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
| `make object-tier` | 热冷复制。未设置 `MINIO_APPLY_TIER=1` 时只打印计划，对象键写「未列出」 |

开发种子账号：`admin` / `Admin@123456`（角色 `super_admin`）。接入请求头：`X-Ingest-Token`，默认值 `dev-ingest-token`（环境变量 `INGEST_TOKEN`）。未带令牌的接入请求会被拒绝。

另外三枚种子账号在 API 启动时写入（已存在则不覆盖）：`producer` / `Producer@123456`（生产管理员，全场）、`shedlead` / `Shed@123456`（棚区负责人，仅 S01）、`viewer` / `Viewer@123456`（查看，仅 S01）。`make demo-rbac` 会把 `viewer` 重设成这个密码和棚号，方便用两个角色对照菜单。步骤见 [`DEMO_RBAC.md`](DEMO_RBAC.md)。`make demo-shed-scope` 会把 `shedlead` 重设成这个密码和棚号 S01，并留下 S01、S02 各一条告警，方便对照棚列表、值班看板和告警。步骤见 [`DEMO_SHED_SCOPE.md`](DEMO_SHED_SCOPE.md)。

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

抓拍：识别报文里的图尽量写入 MinIO，PostgreSQL 只存对象键和 URL。MinIO 不可用时识别记录仍入库，抓拍跳过。读取：`GET /api/v1/ingest/recognitions/:id/snapshot`。识别触发的告警记下同一对象键。告警详情带 `snapshotObjectKey`。读取：`GET /api/v1/alerts/:id/snapshot`。未闭合告警还没有对象键时，下一次同规则、同摄像头的识别若写入了抓拍，把键补到这条告警上，不改状态和标题。

已知限制：本仓不拉流、不识别画面。接入观测是汇总接口，不是客户现场链路监控。

## 总览与大屏

总览页面路由是 `/`（`DashboardView`）。接口是 `GET /api/v1/dashboard/overview`，同页还读 `GET /api/v1/sheds`、`GET /api/v1/devices`、`GET /api/v1/harvest/daily`、`GET /api/v1/ingest/environment-readings`、`GET /api/v1/alert-rules`。有序列时画近端成熟、总数、病害；温度图的阈值线只来自已启用规则。棚区平面只用已配置的 `mapX` / `mapY`。总览 `/` 与基地大屏 `/big-screen` 用该接口的 `todayRecognitionCount`、`todayCaptureCount` 显示「今日识别次数」和「今日抓拍总量」：按识别时间的上海自然日，识别次数是各棚日桶 `sample_count` 之和，抓拍总量是带抓拍对象键或 URL 的 `capture_count` 之和。同一两页用 `todayDiseaseCount` 显示「当日病害总数」：同一上海自然日，各棚日桶棚级 `disease_count` 相加，棚级行是各摄像头当天最新病害数量之和。同一两页再用 `liveMushroomTotal`、`liveMatureTotal`、`liveImmatureTotal` 显示「在养蘑菇总数」「成熟可采摘总数」「待成熟数量」：同一上海自然日，各棚先把摄像头日桶最新的 `mushroom_count`、`mature_count` 相加，待成熟是相加之后的 `max(0, 蘑菇 − 成熟)`，全场再把各棚这三个数分别相加。只读日桶，棚级行不重复计入，不扫识别明细。`make demo-live-mushroom-totals` 读取 `recognition.demo-one.json`，样例文件不改。写入 `CAM-LMT-01` 蘑菇 20 成熟 8、`CAM-LMT-02` 蘑菇 10 成熟 3（棚区 S01），对照棚 `S02` 的 `CAM-LMT-ZERO` 是 0。干净当天旁注是「在养蘑菇总数 30 · 成熟可采摘总数 11 · 待成熟数量 19」。对照 `CAM-LMT-NONE` 当天 0 条。步骤见 [`DEMO_LIVE_MUSHROOM_TOTALS.md`](DEMO_LIVE_MUSHROOM_TOTALS.md)。

大屏路由 `/big-screen`，根节点 `data-skin=tb-night`（夜色只在这一页）。默认一屏为指标、棚区平面、抓拍墙、告警与环境；可切抓拍墙或带时间轴的多区。时间轴进入 `/growth-trends`，或按上海日打开 `/recognitions`。数据来自总览、棚区、告警、设备、识别列表，以及 `GET /api/v1/growth-trends`（7 日）或 `GET /api/v1/growth-trends/hours`（24 小时）。侧栏「基地大屏」链到此页。`/phase2/big-screen` 重定向到 `/big-screen`。

值班看板路由 `/duty-screen`，同样不在管理端壳内。侧栏与顶栏在「基地大屏」后面链到此页。中部每棚一张卡，没有摄像头名牌，点进 `/duty-screen/:shedCode`。状态按可见数据取：摄像头全部离线（或没有摄像头）为离线；否则有未闭合告警为告警；两者都清楚且没有未闭合告警为正常；缺一截则是未知，不把失败写成正常。在线数只数 `type=camera`，来自 `GET /api/v1/devices?type=camera`。今日识别是 `GET /api/v1/growth-trends?days=7` 当天棚级日桶的 `sampleCount`（识别条数，不是蘑菇数）；日桶请求失败时显示「—」，不用 0 充数。未闭合告警分两次拉 `GET /api/v1/alerts` 的 `status=open` 与 `status=acked`，每棚只留一条：严重优先，同级取较新。有告警时这一行用告警说明（去掉「摄像头 …」字样）；整棚离线且没有告警时写最近心跳。列表每页 100 条，最多再翻 19 页；取不全时页面写明。右侧用 `GET /api/v1/ingest/observability` 的默认近窗（接收、拒收、分通道、最近错误）和未闭合告警标题。底部用 `GET /api/v1/dashboard/overview` 的棚数、设备在线、今日蘑菇、今日成熟、未闭合告警、严重告警和环境均值，以及分棚当日识别条数和棚级蘑菇数。不画准确率、帕累托或机器资源。`/big-screen` 不改。

同一页棚卡上方另有三格，给值班直接读数。在线设备、离线设备来自 `GET /api/v1/dashboard/overview` 的 `deviceOnline` 和 `deviceTotal - deviceOnline`，与 `GET /api/v1/devices?online=online`、`GET /api/v1/devices?online=offline` 的 `total` 相同，含摄像头、AI 盒和传感器。点在线打开 `/devices?online=online`，点离线打开 `/devices?online=offline`。设备页把地址栏里的 `online` 传给已有列表接口，并写出「在线 N 台」或「离线 N 台」。侧栏打开 `/devices` 不带 `online`。待确认是 `GET /api/v1/alerts?status=open` 的 `total`，只计状态待确认，不含已确认和已关闭。点这一格打开 `/alerts?status=open`，用告警页已有的状态下拉，不新增筛选项。总览失败时在线和离线显示「—」，不用 0。告警列表失败时待确认显示「—」。棚卡上的在线摄像头仍只数 `type=camera`。图例和底部的未闭合仍是待确认加已确认。

`make demo-duty-board` 登记 `CAM-DUTY-ON`（棚区 `S01`，名称值班在线镜头，备注值班看板在线）并只 POST 一次 `POST /api/v1/ingest/heartbeat`，`online` 为 true，心跳时间为当前时刻。形状参考 `heartbeat.http.json`，该文件仍是 `EDGE-SIM-BOX` / `ai_box`，命令不改文件。再登记 `CAM-DUTY-OFF`（名称值班离线镜头，备注值班看板离线）。编码已存在则不改名称和备注。这台若已是在线，只 `PATCH /api/v1/devices/:id` 把 `onlineStatus` 改成 `offline`，不发心跳。然后保证一条待确认告警，标题「值班看板告警」，摄像头 `CAM-DUTY-OFF`。同标题已是待确认则沿用，不新建。命令再读在线列表、离线列表、`status=open` 的告警列表和 `GET /api/v1/dashboard/overview`：在线 total 等于 `deviceOnline`，离线 total 等于 `deviceTotal - deviceOnline`，待确认 total 至少为 1，两台摄像头分别在对应列表里。`GET /api/v1/alerts/:id` 能打开这条告警。不发识别。步骤见 [`DEMO_DUTY_BOARD.md`](DEMO_DUTY_BOARD.md)。

棚详情路由 `/duty-screen/:shedCode`（`DutyShedDetailView`），同样不在管理端壳内，夜色与值班看板同一套。返回链回 `/duty-screen`。页上是棚名和编码、与棚卡相同的状态（正常、告警、离线、未知），以及在线摄像头数和未闭合条数。摄像头来自 `GET /api/v1/devices?type=camera&shedCode=`，列出名称、编码、在线或离线、`lastHeartbeatAt`（Asia/Shanghai，精确到分钟）；没有心跳写「—」。未闭合告警分两次拉 `GET /api/v1/alerts` 的 `status=open` 与 `status=acked`，并带已有的 `shedCode`，按时间从新到旧，每条显示标题、级别、状态、时间。点一条进入 `/alerts?shedCode=&status=&alertId=`。告警页把棚号和合法状态传给已有的 `GET /api/v1/alerts`，并把该 `alertId` 高亮、滚到视口内。棚列表仍是 `GET /api/v1/sheds`；编码不在可见棚里时写「没有这个棚」，状态为未知。列表失败不把空表写成没有摄像头或没有告警。每页 100 条，最多再翻 19 页。不改接口，不改 `/big-screen`。

棚区页 `/sheds`：`GET /api/v1/sheds` 按棚隔离列出。`PATCH /api/v1/sheds/:id` 只改平面坐标（0–100），仅超管与生产管理员可写。

## 设备、识别、环境、病害

设备 `/devices`。`GET/POST /api/v1/devices`，`PATCH /api/v1/devices/:id`，`POST /api/v1/devices/import`（CSV 文件、CSV 文本或 JSON 行）。表头必填设备编码、棚编码、名称。类型可空，空着记为摄像头。备注可空，最长 500 字，只写在新建行上。导入时编码冲突跳过且不改原档案，也不改原备注。单条 `POST` 遇到已有编码返回 409，文案「设备编码已存在」。登记字段：编号 `code`、名称 `name`、类型 `type`（页面固定为 `camera`）、棚区 `shedCode`、备注 `note`（可空，最长 500 字，空白记为 null）。`PATCH` 可改备注，也可把 `onlineStatus` 改成 `online` 或 `offline`，也可把 `enabled` 设为 `false`（停用）或 `true`（启用）。停用后档案仍在，列表和详情的 `enabled` 为 false。停用不改在线状态、备注和最近心跳。之后的心跳仍按上报改在线状态，不把停用改回启用。`DELETE /api/v1/devices/:id` 删掉这一行。之后列表不再返回它，`GET /api/v1/devices/:id` 是 404，文案「设备不存在」。没有软删除列。告警和识别仍按镜头码留着，删除不改它们。同一编码可以再登记。超管与生产管理员可登记、改备注、改状态、停用和删除；棚区负责人可导入，不能单条登记、改档案或删除；查看人员 403。心跳超时（默认 5 分钟，`DEVICE_OFFLINE_AFTER_MS`）产生「设备离线」告警，恢复心跳自动关闭。已有 `lastHeartbeatAt` 或 `lastSeenAt` 时，超时仍按该时间把在线改回离线。两者都空时，手改的在线留在列表和详情里，超时任务不改它。手改状态不写心跳，不新建、不关闭离线告警。之后的心跳按上报改状态，不清备注。只改备注时不改在线状态。

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

`make demo-heartbeat-offline-alert` 登记另一台摄像头 `CAM-HB-OFF-01`（棚区 `S01`，名称心跳超时镜头，备注心跳超时演示）。编码已存在则不改原档案。然后只 POST 一次 `POST /api/v1/ingest/heartbeat`，`online` 为 true，心跳时间为当前时刻。形状参考 `heartbeat.http.json`，该文件仍是 `EDGE-SIM-BOX` / `ai_box`，命令不改文件。接着等同一条超时扫描把这一行标成 `offline`，并留下未闭合的「设备离线」告警（说明里有「超时未心跳」）。`GET /api/v1/alerts/:id` 与页面 `/alerts/:id` 打开这条告警。`/devices` 这一行是离线。默认超时是 5 分钟，扫描大约每分钟一次。演示把 API 的 `DEVICE_OFFLINE_AFTER_MS` 设成 `2000`，扫描间隔跟着变成约 1 秒，命令按这个短超时去等，不会空等 5 分钟。新的心跳仍会把这台改回在线并自动关闭未闭合的离线告警。不发识别，不改 `CAM-REG-02`。步骤见 [`DEMO_HEARTBEAT_OFFLINE_ALERT.md`](DEMO_HEARTBEAT_OFFLINE_ALERT.md)。

`make demo-camera-list` 用同一条 `POST /api/v1/devices` 保证镜头码 `CAM-ALERT-01` 在设备列表里（棚区 `S01`，新建时名称温度告警镜头，备注镜头码对照告警）。编码已存在则不改原档案。然后读设备页同一份 `GET /api/v1/devices?pageSize=100`。`/devices` 摄像头行的镜头码与编号相同，并链到 `/alerts?cameraCode=` 和 `/recognitions?cameraCode=`。传感器和 AI 盒的镜头码显示为「—」。不发识别，不发心跳，不改 `CAM-REG-02`。步骤见 [`DEMO_CAMERA_LIST.md`](DEMO_CAMERA_LIST.md)。

`GET /api/v1/devices/:id` 返回这一台（编号、名称、类型、棚区、在线状态、备注、最近心跳）。没有这条是 404，棚外是 403。`/devices` 摄像头的镜头码链到 `/devices/:id`，同一行「相关」里也有「详情」。详情页列出镜头码、编号、名称、类型、棚区、状态、备注、最近心跳，并读 `GET /api/v1/alerts?cameraCode=&pageSize=100` 作为相关告警。告警加载失败时不把空表写成没有告警。标题进入 `/alerts/:id`。

`make demo-camera-detail` 用与列表演示相同的 `POST /api/v1/devices` 保证 `CAM-ALERT-01`，已存在则不改档案。再读 `GET /api/v1/devices/:id`，字段必须和列表这一行一致。相关告警沿用标题「镜头详情告警」；没有则 `POST /api/v1/alerts`（一般、待确认）。不发识别，不发心跳，不确认、不关闭已有告警。步骤见 [`DEMO_CAMERA_DETAIL.md`](DEMO_CAMERA_DETAIL.md)。

`make demo-camera-create` 用同一条 `POST /api/v1/devices` 新增镜头码 `CAM-NEW-01`（棚区 `S01`，名称新增镜头，备注新增可演示）。编码已存在则不改档案。然后读设备页同一份 `GET /api/v1/devices?pageSize=100`，再用这一行的 `id` 读 `GET /api/v1/devices/:id`。详情字段与列表这一行一致。`/devices` 登记成功后列出这一行，并给出详情链接。不发识别，不发心跳，不新建告警，不改 `CAM-ALERT-01` 与 `CAM-REG-02`。步骤见 [`DEMO_CAMERA_CREATE.md`](DEMO_CAMERA_CREATE.md)。

`make demo-device-csv-import` 自己生成两行 CSV，`POST /api/v1/devices/import` 的请求体是 `{csv}`。第一行是镜头码 `CAM-CSV-01`（棚区 `S01`，名称 CSV导入镜头，类型摄像头，备注 CSV导入可演示）。第二行编码相同，名称「覆盖名称」，备注「覆盖备注」，用来跳过。新建时成功 1、跳过 1，明细是「设备编码已存在，已跳过」。再跑时成功 0、跳过 2，名称和备注仍是第一行。然后读设备页同一份 `GET /api/v1/devices?pageSize=100`。`/devices` 的「批量导入」可以粘贴同一份 CSV，导入后列表有这一行；再导入一次，页面写出跳过，原档案不变。不发识别，不发心跳，不单条登记，不改 `CAM-NEW-01` 与 `CAM-REG-02`。步骤见 [`DEMO_DEVICE_CSV_IMPORT.md`](DEMO_DEVICE_CSV_IMPORT.md)。

`make demo-camera-edit` 先 `POST /api/v1/devices` 登记镜头码 `CAM-EDIT-01`（棚区 `S01`，名称可编辑镜头，备注编辑前）。编码已存在则不改名称和心跳。然后 `PATCH /api/v1/devices/:id`，备注改为「备注已改」，状态改为在线。再读设备页同一份 `GET /api/v1/devices?pageSize=100` 和 `GET /api/v1/devices/:id`，两处备注和状态一致。不发识别，不发心跳，不新建告警，不改 `CAM-NEW-01`、`CAM-ALERT-01` 与 `CAM-REG-02`。`/devices` 这一行和 `/devices/:id` 都能改备注和状态，保存后重新读取。步骤见 [`DEMO_CAMERA_EDIT.md`](DEMO_CAMERA_EDIT.md)。

`make demo-camera-stop` 先 `POST /api/v1/devices` 登记镜头码 `CAM-STOP-01`（棚区 `S01`，名称可停用镜头，备注停用前）。编码已存在则不改名称和心跳。然后 `PATCH /api/v1/devices/:id`，请求体只有 `{"enabled":false}`。再读设备页同一份 `GET /api/v1/devices?pageSize=100` 和 `GET /api/v1/devices/:id`，两处启用都是停用，备注、在线状态和最近心跳与停用前一致。这一行仍在列表里，详情仍可打开。不发识别，不发心跳，不新建告警，不删除档案，不改 `CAM-NEW-01`、`CAM-EDIT-01`、`CAM-ALERT-01` 与 `CAM-REG-02`。`/devices` 这一行和 `/devices/:id` 可以停用，也可以再启用。步骤见 [`DEMO_CAMERA_STOP.md`](DEMO_CAMERA_STOP.md)。

`make demo-camera-delete` 先 `POST /api/v1/devices` 登记镜头码 `CAM-DEL-01`（棚区 `S01`，名称可删除镜头，备注删除前）。编码已存在则不改名称和心跳。再读 `GET /api/v1/devices?pageSize=100`，然后 `PATCH /api/v1/devices/:id`，请求体只有 `{"note":"删除前已改"}`。名称、在线状态、启用和最近心跳不变。然后 `DELETE /api/v1/devices/:id`。同一份列表不再有 `CAM-DEL-01`，别的设备还在。`GET /api/v1/devices/:id` 是 404「设备不存在」。`/devices` 这一行和 `/devices/:id` 可以删除，删除后回到列表时这一台没有了。不发识别，不发心跳，不新建告警，不改 `CAM-NEW-01`、`CAM-EDIT-01`、`CAM-STOP-01`、`CAM-ALERT-01` 与 `CAM-REG-02`。步骤见 [`DEMO_CAMERA_DELETE.md`](DEMO_CAMERA_DELETE.md)。

### 设备列表看见在线和离线

`/devices` 不带 `online` 时，状态列把 `onlineStatus` 写成「在线」或「离线」。`make demo-device-online` 登记 `CAM-ON-01`（棚区 `S01`，名称列表在线镜头，备注设备列表在线）并只 POST 一次在线心跳。再登记 `CAM-OFF-01`（名称列表离线镜头，备注设备列表离线）。编码已存在则不改名称和备注。新建的离线行本来就是离线；若已经在线，只 `PATCH` `{"onlineStatus":"offline"}`，不发心跳。然后读设备页同一份 `GET /api/v1/devices?pageSize=100`，不带 `online`。`CAM-ON-01` 的 `onlineStatus` 是 `online` 且 `lastHeartbeatAt` 有值，`CAM-OFF-01` 的 `onlineStatus` 是 `offline`。登录后打开 `/devices`，同一张表里一行写「在线」、一行写「离线」。不发识别，不新建告警，不改超时，不改值班看板，不改 `CAM-DUTY-ON`、`CAM-DUTY-OFF`、`CAM-REG-02` 与 `CAM-HB-OFF-01`。步骤见 [`DEMO_DEVICE_ONLINE.md`](DEMO_DEVICE_ONLINE.md)。

`make demo-device-detail` 登记另一对摄像头，截图走镜头详情而不是列表。`CAM-DTL-ON`（棚区 `S01`，名称详情在线镜头，备注设备详情在线）登记后只 POST 一次在线心跳，再读 `GET /api/v1/devices/:id`。这一页的 `onlineStatus` 是 `online`，`lastHeartbeatAt` 有值。`CAM-DTL-OFF`（名称详情离线镜头，备注设备详情离线）新建时就是离线，最近心跳为空，详情「最近心跳」是「—」。编码已存在则不改名称和备注；若已经在线，只 `PATCH` `{"onlineStatus":"offline"}`，不发心跳，已有的最近心跳留着。登录后打开终端打印的两个 `/devices/<id>`。不发识别，不新建告警，不改 `CAM-ON-01`、`CAM-OFF-01`、`CAM-ALERT-01` 与 `CAM-REG-02`。步骤见 [`DEMO_DEVICE_DETAIL.md`](DEMO_DEVICE_DETAIL.md)。

`/devices` 表上方有状态下拉：全部、在线、离线。选「在线」请求 `GET /api/v1/devices?pageSize=100&online=online`，地址栏变为 `/devices?online=online`，表里每一行都是在线。选「离线」请求 `online=offline`，地址栏变为 `/devices?online=offline`。改回「全部」不传 `online`。没有匹配时写「没有符合条件的设备。」，不保留上一次的表。地址栏直接打开同样生效，值班看板点进来时下拉与地址一致。`make demo-device-online-filter` 登记 `CAM-FLST-ON`（棚区 `S01`，名称筛选在线镜头，备注列表筛选在线）并只 POST 一次在线心跳，再保证 `CAM-FLST-OFF`（名称筛选离线镜头，备注列表筛选离线）为离线。在线列表含 `CAM-FLST-ON`、不含 `CAM-FLST-OFF`；离线列表相反。Mac 上要截这两份列表，行必须不一样。不发识别，不新建告警，不改 `CAM-ON-01`、`CAM-OFF-01`、`CAM-DTL-ON` 与 `CAM-DTL-OFF`。步骤见 [`DEMO_DEVICE_ONLINE_FILTER.md`](DEMO_DEVICE_ONLINE_FILTER.md)。

识别 `/recognitions`。`GET /api/v1/ingest/recognitions` 可按摄像头编号（`cameraCode`）和 `from` / `to` 查询，识别时间从新到旧。空白不传。地址栏 `?cameraCode=&from=&to=` 同样生效，大屏按上海日带上的 `from`、`to` 和 `shedCode` 仍有效。点「清除」回到最近记录。时间填不开时写「时间筛选无效」，不把空列表当成没有记录。没有符合条件的行时写「没有符合条件的识别记录。」有图时打开已存抓拍。`make demo-recognition-history` 读取 `recognition.demo-history.json`，写入 `CAM-HIST-01` 的总数 7（三小时前）、总数 9（八分钟前）、总数 12（当前），以及 `CAM-HIST-02` 的总数 11。窗口是当前时刻前 30 分钟到后 1 分钟，列表里有总数 9 和总数 12，没有总数 7 和另一台摄像头。步骤见 [`DEMO_RECOGNITION_HISTORY.md`](DEMO_RECOGNITION_HISTORY.md)。

页面 `/capture-preview`。侧栏「抓拍对照」。同一屏左右对照「原始」与「标注」，下方是历史时间轴。时间轴读 `GET /api/v1/ingest/recognitions`（棚区、`cameraCode`、`from`、`to` 都可空）。点一条切换当前对照。原始图读已有的 `GET /api/v1/ingest/recognitions/:id/snapshot`。报文只有一张图时，标注在同一张图上叠「蘑菇数」「成熟」「病害」，并写「AI标注」。没有图时左边写「无原始抓拍」，右边写「无标注图」。没有时间轴点时写「没有可回看的抓拍。」。`make demo-capture-preview` 读取 `recognition.demo-one.json`，样例文件不改。写入 `CAM-CP-01`（棚区 S01）三条不同识别时间，都能打开抓拍：蘑菇数 8、10、12。旁注是「原始 · 标注 · 时间轴 3 点」。`cameraCode=CAM-CP-NONE` 没有点。步骤见 [`DEMO_CAPTURE_PREVIEW.md`](DEMO_CAPTURE_PREVIEW.md)。不改 `/recognitions` 列表，不改 `/big-screen` 抓拍墙。不改接入观测。

环境 `/environment`。`GET /api/v1/ingest/environment-readings` 列出读数（温度、湿度、CO₂、基质含水率），可按传感器编号和观测时间筛选。`GET /api/v1/ingest/environment-readings/latest` 按棚区和传感器各留观测时间最新的一条，可加 `sensorCode`、`shedCode`。`GET /api/v1/ingest/environment-readings/:id` 返回这一条；没有这条是 404，棚外是 403。页面「最新值」点传感器进入 `/environment/:id`。数据来自环境报文，不用识别报文里的温湿度充数。

`make demo-telemetry-latest` 读取 `environment.demo-latest.json`，先 POST 较早一条（温度 19.2℃），再 POST 当前时刻的一条（传感器 `SENSOR-LATEST-01`，棚区 S01，温度 24.6℃，湿度 85%，CO₂ 760，基质含水率 72%）。`GET /api/v1/ingest/environment-readings/latest?sensorCode=SENSOR-LATEST-01` 只返回后一条。详情是同一条。登录后 `/environment` 的「最新值」是 24.6℃，点进 `/environment/:id`。`environment.golden.json` 不改。MQTT 用 `node scripts/demo-telemetry-latest.mjs --channel mqtt`，主题 `mushroom/S01/SENSOR-LATEST-01/environment`。步骤见 [`DEMO_TELEMETRY_LATEST.md`](DEMO_TELEMETRY_LATEST.md)。

`/environment` 的「历史读数」读 `environment_readings`。可按传感器编号（`sensorCode`，也可传 `deviceCode`）和 `from` / `to` 查询，观测时间从新到旧。空白不传。地址栏 `?sensorCode=&from=&to=` 同样生效。点「清除」回到最近读数。时间填不开，或开始晚于结束时，写「时间筛选无效」，不把空表当成没有读数。`from`、`to` 都有时接口按观测时间比较，含两端；无效时间或开始晚于结束返回 400。没有符合条件的行时写「没有符合条件的环境读数。」页面有「开始时间」「结束时间」；筛着的时候写出「时间 … 至 …」和「共 N 条」。小时均值仍读入库时写入的环境小时桶，历史列表不再对明细做汇总。`make demo-telemetry-history` 读取 `environment.demo-history.json`，写入 `SENSOR-HIST-01` 的 16.5℃（三小时前）、18.4℃（八分钟前）、23.1℃（当前），以及 `SENSOR-HIST-02` 的 21℃。窗口是当前时刻前 30 分钟到后 1 分钟，列表里有 18.4℃ 和 23.1℃，没有 16.5℃ 和另一台传感器。步骤见 [`DEMO_TELEMETRY_HISTORY.md`](DEMO_TELEMETRY_HISTORY.md)。

`make demo-env-filter` 读取 `environment.demo-env-filter.json`，留下传感器 `SENSOR-ENVF-01` 的 15.2℃（三小时前）、19.7℃（八分钟前）、26.4℃（当前）。同一幂等键已在则改观测时间，不另建一行，也不动 `SENSOR-HIST-*`。宽窗口（前 4 小时到后 1 分钟）三条都在，页面写「共 3 条」；窄窗口（前 30 分钟到后 1 分钟）只有 19.7℃ 和 26.4℃，写「共 2 条」。步骤见 [`DEMO_ENV_FILTER.md`](DEMO_ENV_FILTER.md)。

页面 `/shed-env-24h`。侧栏「环境24小时」。`GET /api/v1/growth-trends/environment?hours=24&shedCode=&sensorCode=` 读这一台传感器的环境小时桶，同一屏画出温度、湿度、CO₂、基质含水率四条曲线，并写出起点到终点，例如「温度 22℃ → 26℃（升 4）」。不传 `sensorCode` 时仍是各棚小时均值，`/environment` 上的小时列表不变。少于两个点时写「近 24 小时没有小时桶，未绘制曲线。」`make demo-shed-env-24h` 读取 `environment.demo-history.json` 只作报文底稿，样例文件不改。写入 `SENSOR-ENV24-01`（棚区 S01）四个小时：18 小时前 22℃ / 78% / CO₂ 620 / 基质含水率 68%，12 小时前 24℃ / 84% / 760 / 72%，6 小时前 25℃ / 88% / 880 / 75%，当前小时 26℃ / 92% / 980 / 78%。同一幂等键已在则改观测时间，并重写这台传感器的小时桶，不另建一行。棚级小时均值不重算。温度低于种子规则「温度过高」的 28。步骤见 [`DEMO_SHED_ENV_24H.md`](DEMO_SHED_ENV_24H.md)。不改 `make demo-env-filter`、`make demo-telemetry-history`、`make demo-telemetry-latest`。不改 `/environment` 的时间筛选。不改 `/growth-trends`。不改接入观测。

环境读数入库后，按已启用的阈值规则判断温度过高、温度过低、湿度过高、湿度过低、CO₂过高、基质偏干。超过阈值就写入一条告警：`sensorCode` 是传感器编号，`cameraCode` 为空，说明写成「棚区 … 传感器 …」。同一规则、同一传感器已有未闭合告警则不再新建。识别报文仍按摄像头另走一条，不因为这次环境判断改掉。`make demo-telemetry-threshold-alert` 读取 `environment.demo-telemetry-threshold.json`，把观测时间改成当前时刻，POST 一次传感器 `SENSOR-TELEM-01`、温度 32℃、湿度 88%、CO₂ 900、基质含水率 70%。种子规则「温度过高」阈值仍是 28。待确认列表出现「温度过高告警」，`GET /api/v1/alerts/:id` 的当前值是 32、阈值是 28。这台传感器上已有未闭合告警会先关闭，备注「遥测样例重发前关闭」，其他告警不动。步骤见 [`DEMO_TELEMETRY_THRESHOLD_ALERT.md`](DEMO_TELEMETRY_THRESHOLD_ALERT.md)。

`make demo-alert-rule-config` 用 `POST` / `PATCH /api/v1/alert-rules` 维护规则「演示环境温度过高」（指标温度过高，级别一般，棚区 S03，启用）。没有这条规则时先新建，阈值 30。传感器 `SENSOR-RULE-01`、温度 26℃、湿度 88%、CO₂ 900、基质含水率 70% 在阈值 30 时不产生告警：26 不高于 30，也不高于种子规则「温度过高」的 28。再把阈值改成 24，同一温度留下待确认告警，说明是「棚区 S03 传感器 SENSOR-RULE-01 温度过高 26，阈值 24」，级别一般，摄像头为空。然后把阈值改回 30，先关闭这条告警，再发同一温度，不再新建。最后把阈值写回 24 并再发一条，列表和详情留下这条待确认告警。种子规则「温度过高」仍是 28。规则限定 S03，不改 S01 上的 `SENSOR-TELEM-01`、`SENSOR-LATEST-01` 和识别演示。步骤见 [`DEMO_ALERT_RULE_CONFIG.md`](DEMO_ALERT_RULE_CONFIG.md)。

病害 `/diseases`。`GET /api/v1/diseases` 只列 `diseaseCount>0` 的识别，可按棚区 `shedCode`、位置 `cameraCode`、识别时间 `from` / `to`、病害等级 `diseaseLevel`（0 无、1 轻度、2 中度、3 严重）检索。空白不传。时间填不开时页面写「时间筛选无效」。没有符合条件的行时写「没有符合条件的病害记录。」。列表写出时间、棚区、位置、病害等级、病害数量，并链到 `/diseases/:id`。`GET /api/v1/diseases/:id` 返回这一条；没有这条，或病害数量为 0，是 404；棚外是 403。详情用中文标签显示时间、棚区、位置（摄像头编号）、病害等级、病害数量；有抓拍时显示图片，没有时写「无病害图片」。同期环境仍是 `GET /api/v1/diseases/:id/environment`，在详情页同屏，按该识别的棚取识别时间前后各 30 分钟（`DISEASE_ENV_WINDOW_MINUTES`）的环境读数；无读数返回「该时间窗内无环境读数」。`make demo-disease-env-detail` 读取 `recognition.demo-one.json` 与 `environment.demo-disease-env-detail.json`，样例文件不改。本次识别是摄像头 `CAM-DED-01`、棚区 S01、病害数量 2、病害等级 1。传感器 `SENSOR-DED-01` 在识别前 8 分钟写入 23.8℃、湿度 84%、CO₂ 640、基质含水率 73%，识别前 2 分钟写入 24.1℃、湿度 86%、CO₂ 710、基质含水率 75%。识别前 3 小时的 16.8℃ 不在这 30 分钟窗里，详情不显示。同一幂等键已在则改观测时间。`/diseases/:id` 同一屏写出病害字段和这两行的温度、湿度、CO₂、基质含水率与观测时间。窗内没有读数时页面写「该时间窗内无环境读数」，不用识别报文里的 22.5℃ 充数。步骤见 [`DEMO_DISEASE_ENV_DETAIL.md`](DEMO_DISEASE_ENV_DETAIL.md)。不改 `make demo-disease-list` 与 `make demo-disease-grade-filter`。高发：`GET /api/v1/diseases/peaks`，`grain=hour` 读近 24 小时的 `metric_buckets_hour`，`grain=day` 读近 7 日的日桶。`/diseases?grain=hour` 与 `/diseases?grain=day` 同一屏写出「高发时段」和「高发棚区」。时段表标出「峰值」，棚区表标出「最高」，条的长短随病害数量变化。没有桶时写「该粒度下没有病害高发。」。病害档案仍是下面的识别明细，不是桶。`make demo-disease-hotspot` 读取 `recognition.demo-disease-hotspot.json`，样例文件不改。S03 的 `CAM-DH-A`、`CAM-DH-B`、`CAM-DH-C` 在当前小时各写入病害数量 4（棚合计 12），S02 的 `CAM-DH-LOW` 在 3 小时前写入 1，S03 的 `CAM-DH-DAY` 在 2 日前写入 1。病害等级都是 1。每条病害数量低于种子规则「病害数量一般」的 5，病害等级低于「病害等级一般」的 2，不新开告警。小时页上当前小时高于 3 小时前，S03 高于 S02。日页上较近的一天高于 2 日前，S03 仍高于 S02。同一小时再跑沿用幂等键。步骤见 [`DEMO_DISEASE_HOTSPOT.md`](DEMO_DISEASE_HOTSPOT.md)。不改 `make demo-disease-list`、`make demo-disease-grade-filter` 与 `make demo-disease-env-detail`。不改接入观测。不改 `GET /api/v1/diseases/peaks` 的参数。`make demo-disease-list` 读取 `recognition.demo-one.json`，本次请求改为摄像头 `CAM-DIS-01`、病害数量 2、病害等级 1，只 POST 一次。样例文件不改。列表有这一行，详情字段一致，`diseaseLevel=3` 的对照列表为空。步骤见 [`DEMO_DISEASE_LIST.md`](DEMO_DISEASE_LIST.md)。`make demo-disease-grade-filter` 读取同一份 `recognition.demo-one.json`，另写 `CAM-DG-MILD`（棚区 S01，病害数量 1，病害等级 1）和 `CAM-DG-SEV`（棚区 S01，病害数量 2，病害等级 3）。样例文件不改。`diseaseLevel=1` 有轻度这一行、没有严重这一行；`diseaseLevel=3` 相反；不传等级时两行都在。两条病害数量都低于种子规则「病害数量一般」的 5。轻度低于「病害等级一般」的 2。严重会碰到「病害等级一般」和「病害等级严重」，命令随后关闭这两台摄像头上的未闭合告警，备注「病害等级筛选演示后关闭」。不改 `make demo-disease-list`（仍是 `CAM-DIS-01`，`diseaseLevel=3` 为空对照）。步骤见 [`DEMO_DISEASE_GRADE_FILTER.md`](DEMO_DISEASE_GRADE_FILTER.md)。

## 告警与阈值规则

告警 `/alerts`。`GET /api/v1/alerts`。页面可按状态、级别筛选，选全部不传，地址栏也不再带对应参数。状态下拉改成待确认、已确认或已关闭时，请求带 `status=open|acked|closed`，地址栏同步。摄像头编号填在「摄像头」里，点「筛选」后请求带 `cameraCode`，按编号精确匹配；空白或点「清除」则不传。地址栏 `?cameraCode=` 同样生效。标题关键词填在「标题」里，点「搜索」后请求带 `q`，按标题子串匹配，不区分大小写，不看说明；空白或点「清除搜索」则不传。地址栏 `?q=` 同样生效。值班棚详情带入的 `shedCode` 传给同一列表接口；`alertId` 只高亮该行，不是新的查询参数。侧栏再打开 `/alerts` 时不带这几项。列表里的标题链到 `/alerts/:id`。开始时间和结束时间填在「开始时间」「结束时间」里，点「查询」后请求带 `from`、`to`，按列表「时间」列的 `createdAt` 比较，含两端。空白或点「清除时间」则不传。地址栏 `?from=`、`?to=` 同样生效。不是有效时间，或开始晚于结束时，页面写「时间筛选无效」，不请求列表。窗口内没有行时写「没有符合条件的告警。」。状态下拉仍单独传 `status`，不会被起止时间换掉。设备下拉列出 `GET /api/v1/devices` 的编号和名称。选中一台后请求带 `deviceId`，接口按这台设备的编号精确匹配告警的 `cameraCode` 或 `sensorCode`；选「全部」或空白不传。地址栏 `?deviceId=` 同样生效。不是设备 id 时接口返回 400。没有这台设备，或它不在当前账号的棚区里时，列表为空。`cameraCode`、`status`、`from`、`to` 仍单独生效，不会被 `deviceId` 换掉。当前有状态、级别、棚号、摄像头、设备、标题关键词或起止时间筛选时，这条链接和详情页的「返回告警列表」带上同样的 `status`、`level`、`shedCode`、`cameraCode`、`deviceId`、`q`、`from`、`to`。

`GET /api/v1/alerts/:id` 返回这一条（棚区、摄像头、传感器、级别、状态、标题、说明、指标、当前值、阈值、发生时间、认领人、认领时间、确认人、确认时间、关闭原因、关闭人、关闭时间）。查看人员可读自己棚内的告警；棚外 403；没有这条 404。详情页用中文标签显示这些字段。认领人、认领时间、确认人、确认时间、关闭人、关闭时间以及关闭原因为空时显示「—」。没有传感器时不显示「传感器」一行。手工新建的告警没有指标时，指标、当前值、阈值显示为「—」。环境遥测触发的告警在列表标题下写出传感器编号。

`make demo-one-alert` 读取 `recognition.demo-one.json`，把本次请求的摄像头改成 `CAM-ALERT-01`、温度改成 30，只 POST 一次识别。样例文件里的 `CAM-DEMO-01` 与温度 22.5 不改。种子规则「温度过高」（阈值 28，严重）因此留下一条未闭合告警。同一摄像头已有未闭合的温度过高告警时不再新建，命令仍打印该条 id。登录后打开 `/alerts`，点标题进入 `/alerts/:id`。步骤见 [`DEMO_ONE_ALERT.md`](DEMO_ONE_ALERT.md)。

`make demo-alert-detail` 用同一次识别播种。已有未闭合的这条则沿用。命令读 `GET /api/v1/alerts/:id`，并打印详情地址 `/alerts/<id>`。登录后直接打开这个地址。详情页能读到标题、说明、级别、状态、棚区、摄像头、发生时间、指标、当前值、阈值，以及认领人、认领时间、确认人、确认时间、关闭原因、关闭人、关闭时间。不确认、不关闭，不改 `make demo-one-alert` 与样例文件。步骤见 [`DEMO_ALERT_DETAIL.md`](DEMO_ALERT_DETAIL.md)。

待确认的行可以点「确认」，未关闭的行可以点「关闭」。列表点下去后重新请求 `GET /api/v1/alerts`。列表上的「处理说明」默认是「已确认」，确认和关闭都带上这段非空文字；只剩空白时这两个按钮不能点。详情页有单独的「处理说明」输入框，确认或关闭前必须填写。确认把这段文字写入 `ackNote`，关闭写入 `closeNote`，然后重新请求 `GET /api/v1/alerts/:id`。已确认时处理说明显示 `ackNote`，已关闭时显示 `closeNote`。刷新页面后状态和处理说明仍是这次写入的结果。查看人员没有输入框和这两个按钮。

`make demo-ack-one-alert` 确认这条待确认的温度过高告警，再读详情和 `status=acked` 的列表。已经是已确认、没有待确认时命令失败，不改这条告警。`make demo-close-one-alert` 关闭这条未闭合告警（待确认或已确认），再读详情和 `status=closed` 的列表。没有未闭合告警时，先按 `make demo-one-alert` 的方式补一条识别再关闭。两个命令都不改样例文件，也不改 `make demo-one-alert`。步骤见 [`DEMO_ACK_CLOSE_ALERT.md`](DEMO_ACK_CLOSE_ALERT.md)。

`make demo-alert-ack` 在棚区 S01 留下三行，供告警列表点「确认」和「关闭」，不改状态下拉。`CAM-ACK-01` 标题「待确认操作告警」保持待确认。`CAM-ACK-02` 标题「已确认操作告警」用 `POST /api/v1/alerts/:id/ack` 确认，备注「已确认」，不再关闭。`CAM-ACK-03` 标题「已关闭操作告警」先确认再 `POST /api/v1/alerts/:id/close`，关闭备注「已关闭」，关闭原因 `resolved`；详情里的确认备注仍是「已确认」，不是「关闭时自动确认」。同标题同状态且备注相符则沿用。不发识别，不改 `make demo-one-alert`、`make demo-ack-one-alert`、`make demo-close-one-alert` 与 `make demo-alert-status-filter`。登录后打开 `/alerts`（全部）。待确认那一行点「确认」变为已确认，再点「关闭」变为已关闭。步骤见 [`DEMO_ALERT_ACK.md`](DEMO_ALERT_ACK.md)。

`make demo-threshold-alert` 用 `PATCH /api/v1/alert-rules/:id` 把规则「演示二氧化碳过高」的阈值从 1500 改成 1000（没有这条规则时先 `POST` 一条，级别一般，棚区 S01）。再把样例识别的摄像头改成 `CAM-THRESH-01`、CO₂ 改成 1200，POST 一次。`GET /api/v1/alerts` 的待确认列表里有标题「CO₂过高告警」，说明里写着 1200 和阈值 1000。种子规则「二氧化碳过高」仍是 2000。样例文件里的 CO₂ 900 不改，已有演示报文不超过 1000。这台摄像头上同规则的未闭合告警会先关闭，其他摄像头的告警不动。步骤见 [`DEMO_THRESHOLD_ALERT.md`](DEMO_THRESHOLD_ALERT.md)。

`make demo-alert-camera-filter` 用 `POST /api/v1/alerts` 留下两条未闭合告警：棚区 S01 的 `CAM-FILTER-01`（标题「东侧过道告警」）和 `CAM-FILTER-02`（标题「西侧过道告警」）。同摄像头、同标题已有未闭合告警则沿用，不新建。然后 `GET /api/v1/alerts?cameraCode=CAM-FILTER-02` 只含这台摄像头，`GET /api/v1/alerts/:id` 仍能打开它；不带 `cameraCode` 的列表里两条都在。不发识别，不改阈值规则，不确认或关闭其他告警。登录后在 `/alerts` 填写摄像头编号并点「筛选」，点标题进详情，点「清除」回到多摄像头列表。步骤见 [`DEMO_ALERT_CAMERA_FILTER.md`](DEMO_ALERT_CAMERA_FILTER.md)。

`make demo-alert-status-filter` 留下三条告警，都在棚区 S01：`CAM-STATUS-01`（标题「待确认筛选告警」，状态待确认）、`CAM-STATUS-03`（标题「已确认筛选告警」，状态已确认）、`CAM-STATUS-02`（标题「已关闭筛选告警」，状态已关闭）。同标题同状态已在则沿用。已确认只有待确认时，用与 `make demo-ack-one-alert` 相同的确认接口和备注「已确认」把它确认，不确认其他告警。已关闭只有待确认或已确认时，用与 `make demo-close-one-alert` 相同的关闭接口和备注「已关闭」把它关掉，不关其他告警。然后 `GET /api/v1/alerts?status=open` 只有待确认且含第一条，`status=acked` 只有已确认且含第二条，`status=closed` 只有已关闭且含第三条，详情都能打开；不带 `status` 时三条都在。登录后在 `/alerts` 把状态下拉改成「待确认」、「已确认」或「已关闭」，地址栏同步 `?status=`，列表只剩这一状态；没有匹配时写「暂无告警。」。点标题进详情，再改回「全部」。步骤见 [`DEMO_ALERT_STATUS_FILTER.md`](DEMO_ALERT_STATUS_FILTER.md)。

`make demo-alert-time-range` 留下三条告警，都在棚区 S01，级别一般，状态待确认。`CAM-TIME-01` 标题「时间窗外告警」，`createdAt` 为当前时刻前 3 小时。`CAM-TIME-02` 标题「时间窗内较早告警」，为前 8 分钟。`CAM-TIME-03` 标题「时间窗内当前告警」，为当前时刻。同棚、同摄像头、同标题已在则沿用，并把 `createdAt` 改到这次的时刻。宽窗口（前 4 小时到后 1 分钟）加上 `q=时间窗` 时三条都在；窄窗口（前 30 分钟到后 1 分钟）只有后两条，`total` 更小。`status=open` 与 `from` / `to` 可以同时用。登录后打开终端打印的两个列表地址，状态下拉是「全部」。步骤见 [`DEMO_ALERT_TIME_RANGE.md`](DEMO_ALERT_TIME_RANGE.md)。

`make demo-alert-by-device` 登记棚区 S01 的 `CAM-DEVF-01`（名称东侧设备）和 `CAM-DEVF-02`（名称西侧设备）。已有则不改档案。再留下或沿用待确认的「东侧设备告警」和「西侧设备告警」。`GET /api/v1/alerts?q=设备告警` 两条都在。加上各自的 `deviceId` 后只剩这一台，条数更少，另一台的标题不在表里。`cameraCode=CAM-DEVF-01` 仍只含东侧。`deviceId` 与 `status=open` 可以同时用。登录后打开终端打印的三个列表地址，状态下拉是「全部」。步骤见 [`DEMO_ALERT_BY_DEVICE.md`](DEMO_ALERT_BY_DEVICE.md)。

`make demo-alert-title-search` 用 `POST /api/v1/alerts` 留下两条未闭合告警：棚区 S01 的 `CAM-TITLE-01`（标题「东侧标题搜索告警」）和 `CAM-TITLE-02`（标题「西侧过道对照告警」）。同摄像头、同标题已有未闭合告警则沿用，不新建。然后 `GET /api/v1/alerts?q=东侧标题` 只含标题里有这段文字的告警，`GET /api/v1/alerts/:id` 仍能打开匹配的那条；不带 `q`，或 `q` 只有空白时，两条都在。匹配不区分大小写，按标题子串，不看说明。不发识别，不改阈值规则，不确认或关闭其他告警。登录后在 `/alerts` 填写标题关键词并点「搜索」，点标题进详情，点「清除搜索」回到两条都在的列表。步骤见 [`DEMO_ALERT_TITLE_SEARCH.md`](DEMO_ALERT_TITLE_SEARCH.md)。

`make demo-alert-handle-note` 从棚区 S01、摄像头 `CAM-NOTE-01`、标题「处理说明告警」的待确认告警开始。没有则 `POST /api/v1/alerts` 新建一条。然后 `POST /api/v1/alerts/:id/ack`，处理说明是「现场已开窗通风」。连续两次 `GET /api/v1/alerts/:id`，状态都是已确认，`ackNote` 都是这一句。不发识别，不改阈值规则，不确认或关闭其他告警。登录后打开打印的详情地址，能看到处理说明；刷新后仍在。页面上也可以对别的待确认告警填写处理说明后点「关闭」，关闭备注同样留在详情里。步骤见 [`DEMO_ALERT_HANDLE_NOTE.md`](DEMO_ALERT_HANDLE_NOTE.md)。

`make demo-alert-snapshot-minio` 读取 `recognition.demo-one.json`，把本次请求的摄像头改成 `CAM-SNAP-01`、温度改成 30，只 POST 一次。样例 JPEG 写入 MinIO。告警记下对象键。`GET /api/v1/alerts/:id` 带 `snapshotObjectKey`。`GET /api/v1/alerts/:id/snapshot` 读回的字节与样例 JPEG 一致。详情页显示这张图、对象键和「打开抓拍」。列表标题旁在有对象键时显示「抓拍」，链到同一详情。同一条未闭合告警已有对象键则沿用。样例文件里的 `CAM-DEMO-01` 不改。步骤见 [`DEMO_ALERT_SNAPSHOT_MINIO.md`](DEMO_ALERT_SNAPSHOT_MINIO.md)。

| 动作 | 接口 | 结果 |
|------|------|------|
| 确认 | `POST /api/v1/alerts/:id/ack` | 状态 `acked` |
| 认领 | `POST /api/v1/alerts/:id/claim` | 写入认领人 |
| 关闭 | `POST /api/v1/alerts/:id/close` | `closed`，关闭原因 `resolved` |
| 误报 | `POST /api/v1/alerts/:id/false-positive` | `closed`，关闭原因 `false_positive` |
| 未读 | `GET /api/v1/alerts/unread`，`POST /api/v1/alerts/:id/read`，`POST /api/v1/alerts/read-all` | 已读记在 `alert_reads`，不改告警状态 |

认领、误报、关闭、确认写入审计。查看人员只读。顶栏未读约 15 秒轮询；浏览器通知只在用户授权后发出。

阈值规则 `/alert-rules`。`GET/POST /api/v1/alert-rules`，`GET /api/v1/alert-rules/:id`，`PATCH /api/v1/alert-rules/:id`。没有这条是 404，棚外是 403。写权限仅超管与生产管理员。列表写出名称、指标、棚区、阈值、等级、窗口分钟、启用；棚区空着写「全场」。点「打开」进入 `/alert-rules/:id`，详情用中文标签显示这些字段。地址带 `ruleId` 时描出这一行。指标含成熟占比、成熟数量、病害数量、病害等级、生长停滞、温度过高/过低、湿度过高/过低、CO₂ 过高、基质含水率过低。级别为提示、一般、严重。`make demo-alert-rules` 保证规则「演示规则列表」（湿度过高，阈值 95，提示，棚区 S01，窗口 360 分钟，启用），并打印列表和详情地址。种子规则「温度过高」仍是 28。不发识别，不发环境，不改其他规则。步骤见 [`DEMO_ALERT_RULES.md`](DEMO_ALERT_RULES.md)。

`make demo-alert-rule-edit` 新建或沿用「演示规则新建」（湿度过低，棚区全场）。改前是阈值 40、等级提示、窗口 180 分钟、启用。保存后再读列表和详情，两处都是这组数。然后改成阈值 55、等级一般、窗口 90 分钟、停用，再读列表和详情，两处都是新值。页面上超管和生产管理员用「新建规则」建这条，行内改阈值、等级、窗口后点「保存」，点「停用」或「启用」。保存后这一行被描出，并写出已保存的阈值、等级、窗口分钟和启用；点「打开详情」进入同一条。种子规则「温度过高」仍是 28。不改「演示规则列表」「演示环境温度过高」「演示二氧化碳过高」。不发识别，不发环境。步骤见 [`DEMO_ALERT_RULE_EDIT.md`](DEMO_ALERT_RULE_EDIT.md)。

## 生长趋势

页面 `/growth-trends`。日趋势 `GET /api/v1/growth-trends?days=7|30`（只接受 7 或 30），读 `metric_buckets_day`。可选 `grain=day|week|month`，不传是日。周从周一起算，月是 `YYYY-MM`。周和月取该周期最后一天的蘑菇数与成熟数，菌盖直径取这些日均值的平均，样本数是这些天相加。每个点有蘑菇数量、成熟数量、成熟率、菌盖直径均值和样本数。成熟率是成熟数 ÷ 蘑菇数，百分数保留一位，字段 `maturityRate`。蘑菇数为 0 时该字段为空，页面写「—」，曲线不计这一点。相邻两点成熟率不同时，表里写「升」或「降」和相差的百分点数。小时趋势 `GET /api/v1/growth-trends/hours` 读 `metric_buckets_hour`，点上同样有成熟数量。环境曲线 `GET /api/v1/growth-trends/environment` 读环境小时桶。页面有「日」「周」「月」，也有「7 天」「30 天」「24 小时」。有点时写出「棚区 … · 7 天」或「30 天」「24 小时」；周和月写出「棚区 … · 周」或「月」，以及「粒度 周 · 共 N 个点」或「粒度 月 · 共 N 个点」，周期带「（周）」或「（月）」。表头是日期、周、月或小时。棚隔离。

`make demo-growth-trend` 读取 `recognition.demo-growth-trend.json`，写入 `CAM-GT-01`（棚区 S01）三天：前 5 日蘑菇 8、成熟 2；前 2 日蘑菇 14、成熟 5；当日蘑菇 21、成熟 8。同一上海日的幂等键已在则不另建一行。病害数量 0，温度 22.5℃，成熟占比低于种子规则「成熟占比一般」的 0.6。7 日和 30 日都能看到这三天，蘑菇数和成熟数后一天更大。`cameraCode=CAM-GT-NONE` 没有点。步骤见 [`DEMO_GROWTH_TREND.md`](DEMO_GROWTH_TREND.md)。

`make demo-growth-grain` 读取同一份 `recognition.demo-growth-trend.json`，样例文件不改。写入 `CAM-GG-01`（棚区 S01）六个上海日：三个已经结束的周，每周周一和周三。周一蘑菇 8、成熟 2；较早两周的周三蘑菇 14、成熟 5；最近一周的周三蘑菇 21、成熟 8。同一上海日的幂等键已在则不另建一行。`days=30` 时日是 6 个点，周是 3 个点，月是 1 或 2 个点，三个点数彼此不同。周的蘑菇数是该周周三，不是周一的 8。步骤见 [`DEMO_GROWTH_GRAIN.md`](DEMO_GROWTH_GRAIN.md)。不改 `make demo-growth-trend`。不改接入观测。

`make demo-maturity-rate` 读取同一份样例，样例文件不改。写入 `CAM-MR-01`（棚区 S01）四个上海日：前 5 日蘑菇 0、成熟 0，成熟率空；前 3 日蘑菇 20、成熟 2，成熟率 10%；前 1 日蘑菇 20、成熟 6，成熟率 30%；当日蘑菇 20、成熟 10，成熟率 50%。页面 `/growth-trends?days=7&shedCode=S01&cameraCode=CAM-MR-01` 旁注写出「成熟率 10% → 30% → 50%（升）」，表里蘑菇为 0 的一行是「—」，10% 到 30%、30% 到 50% 写「升 20」。同一上海日的幂等键已在则不另建一行。步骤见 [`DEMO_MATURITY_RATE.md`](DEMO_MATURITY_RATE.md)。不改 `make demo-growth-trend`、`make demo-growth-grain`。不改接入观测。

页面 `/growth-compare`。侧栏「棚间对比」。仍读 `GET /api/v1/growth-trends?days=7|30`，不传 `shedCode`，一棚一条曲线。当日对照并排写出各棚蘑菇数、成熟数和菌盖直径，表里同一天相邻。至少两个棚有日聚合才画曲线。`make demo-shed-growth-compare` 读取 `recognition.demo-shed-growth-compare.json`，写入 `CAM-SG-S01`（棚区 S01）与 `CAM-SG-S02`（棚区 S02）各三天。当天蘑菇 21 与 8，成熟 8 与 3。同一上海日的幂等键已在则不另建一行。棚汇总是各摄像头当日最新蘑菇数相加；棚里只有这两台时，当天棚汇总就是 21 和 8。步骤见 [`DEMO_SHED_GROWTH_COMPARE.md`](DEMO_SHED_GROWTH_COMPARE.md)。

页面 `/shed-growth-delta`。侧栏「生长增量」。仍读 `GET /api/v1/growth-trends?days=7|30&shedCode=&cameraCode=` 的日桶，不新开接口。页面取这一台摄像头的点，相邻日相减，曲线和表写蘑菇增量、成熟增量，不写当日绝对数，也不写成熟率、菌盖。少于两个增量时写「没有相邻日增量，未绘制曲线。」旁注例如「蘑菇增量 6 → 8 → 10（升）」。`make demo-shed-growth-delta` 读取 `recognition.demo-growth-trend.json`，样例文件不改。写入 `CAM-GD-01`（棚区 S01）四个上海日：蘑菇 10、16、24、34，成熟 2、4、7、11。相邻蘑菇增量是 +6、+8、+10，成熟增量是 +2、+3、+4。同一上海日的幂等键已在则不另建一行。`cameraCode=CAM-GD-NONE` 没有点。步骤见 [`DEMO_SHED_GROWTH_DELTA.md`](DEMO_SHED_GROWTH_DELTA.md)。不改 `/growth-trends`、`/growth-compare`、`/shed-env-24h`。不改 `make demo-growth-trend`、`make demo-growth-grain`、`make demo-maturity-rate`、`make demo-shed-growth-compare`。不改接入观测。

页面 `/shed-live-stats`。侧栏「单棚实时」。`GET /api/v1/growth-trends/live?shedCode=&cameraCode=` 读当日日桶的 `mushroom_count`、`mature_count`、`disease_count`（当日最新）。必选棚区。选了摄像头是这一台最新；不传摄像头是各摄像头最新相加，待成熟在相加之后再算。待成熟 = 蘑菇数 − 成熟数；蘑菇为 0 或相减为负时是 0。同一屏四格：蘑菇数、成熟数、待成熟、病害数。少于可用点时写「该棚暂无实时生长数据。」，四格是「—」。`make demo-shed-live-stats` 读取 `recognition.demo-growth-trend.json`，样例文件不改。写入 `CAM-SLS-01`（棚区 S01）当日一条：蘑菇 20、成熟 8、病害 2，待成熟 12，病害等级 1。`cameraCode=CAM-SLS-NONE` 没有点。步骤见 [`DEMO_SHED_LIVE_STATS.md`](DEMO_SHED_LIVE_STATS.md)。不改 `/growth-trends` 曲线、`/shed-growth-delta`、`/shed-disease-trend`、`/shed-env-24h`、`/duty-screen`、总览 `/`。不改接入观测。

页面 `/shed-disease-trend`。侧栏「病害趋势」。`GET /api/v1/diseases/trends?days=7|30&shedCode=&cameraCode=` 读 `metric_buckets_day` 的 `disease_count`（当日最新）。选了摄像头就画这一台；不传摄像头是棚汇总。同一屏是病害数量曲线和表。旁注例如「病害 1 → 3 → 6 → 10（升）」。表里相邻日写「升」或「降」。少于两个点时写「没有病害日趋势，未绘制曲线。」日桶没有病害等级均值，页面只写数量。`make demo-shed-disease-trend` 读取 `recognition.demo-growth-trend.json`，样例文件不改。写入 `CAM-SDT-01`（棚区 S01）四个上海日：病害数量 1、3、6、10，病害等级 1。6 和 10 会碰到种子规则「病害数量一般」，命令末尾关闭这台摄像头上的未闭合告警。`cameraCode=CAM-SDT-NONE` 没有点。步骤见 [`DEMO_SHED_DISEASE_TREND.md`](DEMO_SHED_DISEASE_TREND.md)。不改 `/diseases` 列表，不改 `GET /api/v1/diseases/peaks`，不改 `/diseases/:id` 的同期环境。不改 `/growth-trends`、`/shed-growth-delta`、`/shed-env-24h`。不改接入观测。

写路径：识别入库按 `recognizedAt`（Asia/Shanghai）增量 upsert 小时桶与日桶，同一幂等键不双计。环境入库按 `observedAt` 同样增量写入。`daily_aggregates` 已停写并删除（迁移 `010_drop_daily_aggregates.sql`）。

已知限制：每小时 cron 与采摘修正蘑菇数后，`refreshDay` 会重扫该上海日的识别明细，回写识别指标桶；环境桶留在原行。打开趋势页本身不扫识别明细。

## 采摘

页面 `/harvest`。查看人员只读；超管、生产管理员、棚区负责人可改。

当日清单：`GET /api/v1/harvest/daily`（`/daily/list` 同一份数据）。可按上海日期 `date` 和摄像头 `cameraCode` 收窄；空白不传摄像头。`GET /api/v1/harvest/daily/:id` 返回这一条；没有这条是 404，棚外是 403。页面 `/harvest` 写出棚区、摄像头、成熟数、蘑菇数和识别时间，点「打开」进入 `/harvest/:id`。详情用中文标签显示时间、棚区、摄像头、成熟数、蘑菇数、菌盖直径；没有直径时写「—」。没有符合摄像头条件的行时写「没有符合条件的采摘记录。」。日期不是 `YYYY-MM-DD` 时写「日期无效」。`PATCH /api/v1/harvest/daily/:id` 修正成熟数与蘑菇数，写回识别记录，并记审计（谁、何时、旧值到新值、棚、摄像头）。成熟数不能大于蘑菇数。汇总随修正更新。他棚 403。`make demo-harvest-list` 读取 `recognition.demo-one.json`，本次请求改为摄像头 `CAM-HAR-01`，成熟数 5、蘑菇数 12 仍用样例，只 POST 一次。样例文件不改。列表有这一行，详情菌盖直径 4.7，`cameraCode=CAM-HAR-NONE` 的对照列表为空。步骤见 [`DEMO_HARVEST_LIST.md`](DEMO_HARVEST_LIST.md)。

同一份当日清单还可按棚区 `shedCode` 和时间窗 `from`、`to` 收窄。棚区空白表示全部。`from`、`to` 按识别时间比较，含两端；两个都传时改用这段窗口，不再只限 `date` 那一天；窗口里每个摄像头仍只留最新一条。只传一端、时间无效或开始晚于结束时接口返回 400，页面写「时间筛选无效」，不保留上一张表。没有命中时写「没有符合条件的采摘记录。」。页面写出「棚区 …」和「共 N 条」；有时间窗时还写出「时间 … 至 …」。`make demo-harvest-filter` 读取同一份样例，写两次：`CAM-HF-S01`（棚区 S01，前 3 小时，成熟数 5，蘑菇数 12）和 `CAM-HF-S02`（棚区 S02，当前时刻，成熟数 9，蘑菇数 17）。宽窗口（前 4 小时至后 1 分钟）两条都在；同一窗口 `shedCode=S01` 没有 S02，条数和成熟数汇总都更少；窄窗口（前 30 分钟至后 1 分钟）没有前 3 小时那条，条数和成熟数汇总也更少。样例文件不改。不生成采摘任务。步骤见 [`DEMO_HARVEST_FILTER.md`](DEMO_HARVEST_FILTER.md)。

任务清单与排班：`GET /api/v1/harvest/tasks?date=`，`POST /api/v1/harvest/tasks/generate`，`PATCH /api/v1/harvest/tasks/:id`。生成规则：当日成熟数大于 0 的摄像头进入清单；已有任务只更新数量，保留人员和班次；不再成熟、且仍是未排的待采任务才从清单去掉。排班字段：人员、班次 `morning` / `afternoon`、状态 `open` / `scheduled` / `done`。页面 `/harvest` 的「每日采摘任务清单」给出上午、下午、未排条数。查看人员只读；超管、生产管理员、棚区负责人可点「生成当日清单」和「保存排班」。`make demo-harvest-task` 读取 `recognition.demo-one.json`，写入 `CAM-HT-01`（棚区 S01，成熟数 5，蘑菇数 12）和 `CAM-HT-02`（棚区 S01，成熟数 9，蘑菇数 17）。生成后这两行都在。再把 `CAM-HT-01` 排给王早、上午，把 `CAM-HT-02` 排给李午、下午。保存后列表能读到人员和班次，上午、下午、未排条数随排班变化。样例文件不改。不改 `make demo-harvest-list` 与 `make demo-harvest-filter`。步骤见 [`DEMO_HARVEST_TASK.md`](DEMO_HARVEST_TASK.md)。

两套成熟估计，响应都带标签「估计」。数字是未来日的**成熟数**，不是公斤。

| 接口 | 算法 | 给不出数字时 |
|------|------|----------------|
| `GET /api/v1/harvest/yield-estimate` | 近 30 个上海自然日，各摄像头当日最新成熟数之和，按日序线性外推未来 3 日 | 不满连续 30 天：只返回说明，`days` 为空 |
| `GET /api/v1/harvest/bucket-forecast` | 近 7 个上海自然日、棚级成熟日桶，用首尾差除以间隔天数得到增速，外推未来 3 日 | 少于 2 个相隔不少于 1 天的成熟日桶：只返回说明，`days` 为空 |

`make demo-yield-forecast` 读取 `recognition.demo-yield-forecast.json`，写入 `CAM-YF-01`（棚区 S01）三天：前 6 日蘑菇 12、成熟 4；前 3 日蘑菇 18、成熟 8；当日蘑菇 24、成熟 12。同一上海日的幂等键已在则不另建一行。病害数量 0，温度 22.5℃，成熟占比低于种子规则「成熟占比一般」的 0.6。页面 `/harvest` 的「近 2–3 日成熟估计（日桶增速）」写出「估计」和未来 3 日成熟数。不满连续 30 天时，30 日线性那一块只写说明，`days` 为空。步骤见 [`DEMO_YIELD_FORECAST.md`](DEMO_YIELD_FORECAST.md)。

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

`/batches?batchCode=` 打开该批次的阶段和回放。`make demo-fruiting-batch` 读取 `recognition.demo-fruiting-batch.json`，写入 `CAM-FB-01`（棚区 S01）三天：蘑菇 11、18、27，成熟 2、6、11。批次 `FB-DEMO-01` 记下出菇、快速生长、成熟。列表当前阶段是成熟。回放读该棚棚级日桶，窗口里至少两天有蘑菇数、成熟数和菌盖。同一上海日再跑不另建识别，阶段已齐则不再追加。样例 `recognition.demo-one.json` 不改。不改 `make demo-harvest-task`、`make demo-harvest-list` 与 `make demo-harvest-filter`。不估计产量。步骤见 [`DEMO_FRUITING_BATCH.md`](DEMO_FRUITING_BATCH.md)。

## 报表

页面 `/reports`。登录后可用，按棚隔离。地址带 `kind` 时自己出预览，并写出「棚区 … · 共 N 条」。有行时「打印」可点；没有行时按钮不可点。组件测试覆盖筛选、预览、导出文案和打印。登录后的宽窄对照见 [`DEMO_REPORT_BROWSE.md`](DEMO_REPORT_BROWSE.md)。仓库里没有无头浏览器自动完成登录并点选的测试。

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

地址栏带 `kind` 时，`/reports` 按查询参数填好报表、粒度、日期、棚区和已有的在线或状态筛选，并自己请求预览。没有 `kind` 时仍要点「预览」。点「导出」或上方快捷下载成功后，页面写「已开始下载」和文件名。空文件仍写「该报表没有可导出的数据」。

`make demo-report-xlsx` 读取 `recognition.demo-one.json`，把本次请求改成棚区 `S02`、摄像头 `CAM-RPT-01`、蘑菇数量 17、成熟数量 9，只 POST 一次识别。样例文件里的 `CAM-DEMO-01` 不改。然后核对上海当天的园区生长预览：`shedCode=S02` 时至少一行且没有其他棚，蘑菇数量至少 17，成熟数量至少 9；不带棚区时行数不少于这一份。`GET /api/v1/reports/export.xlsx` 用同一组 S02 参数返回 xlsx，工作表是「园区生长」，里面有 S02。登录后打开终端打印的 `/reports?kind=growth&...&shedCode=S02`。不确认、不关闭告警。步骤见 [`DEMO_REPORT_XLSX.md`](DEMO_REPORT_XLSX.md)。

`make demo-report-browse` 读取同一份样例，写两次，样例文件不改。`CAM-RB-S01`（棚区 S01，蘑菇数量 11，成熟数量 4）和 `CAM-RB-S02`（棚区 S02，蘑菇数量 17，成熟数量 9）。同一上海日再跑不另建一行。上海当天园区生长：不带棚区时有 S01 和 S02，行数更多；`shedCode=S02` 只有 S02，没有 S01。页面写出「棚区 全部 · 共 N 条」或「棚区 S02 · 共 M 条」，N 大于 M。`GET /api/v1/reports/export.xlsx` 用 S02 参数返回 xlsx，工作表是「园区生长」，里面有 S02，没有 S01。登录后打开终端打印的两个 `/reports?kind=growth&...`。点「导出」后写「已开始下载 growth.xlsx」。有行时点「打印」调用 `window.print()`。不确认、不关闭告警。不改 `make demo-report-xlsx`。不改接入观测。步骤见 [`DEMO_REPORT_BROWSE.md`](DEMO_REPORT_BROWSE.md)。

告警闭环台账预览表里的等级、状态、关闭原因用告警页同一套中文（一般、待确认、已关闭、正常关闭）。`make demo-alert-ledger` 在棚区 `S01` 留下或沿用「台账待确认告警」（`CAM-ALED-OPEN`，待确认）和「台账已关闭告警」（`CAM-ALED-CLOSED`，已关闭）。已关闭这条没有时先 `POST /api/v1/alerts`，再 `POST /api/v1/alerts/:id/close`，备注「台账关闭」，关闭原因 `resolved`。预览窗口盖住两条的创建日。不带状态时两行都在；`status=open` 只有待确认那条，行数更少；`status=closed` 只有已关闭那条，行数更少。`export.xlsx` 用已关闭参数，工作表是「告警闭环」，里面有已关闭那条，没有待确认那条。`alerts.xlsx` 工作表是「告警」，里面也有已关闭那条。不发识别。不改 `make demo-report-xlsx`。步骤见 [`DEMO_ALERT_LEDGER.md`](DEMO_ALERT_LEDGER.md)。

浏览器打印：预览有行时「打印」可点，调用 `window.print()`，打印当前页。没有行时按钮不可点。没有单独的打印样式表。

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
| `super_admin` | 超管 | 全场 | 用户新建、重设与启停、阈值规则、棚坐标、采摘修正、采摘任务、批次、设备导入、摄像头登记与备注、告警处置、审计、系统参数 |
| `production_admin` | 生产管理员 | 全场 | 与超管相同，但不能建用户、不能改系统参数 |
| `shed_manager` | 棚区负责人 | 仅账号上的棚号 | 采摘修正、采摘任务、批次、设备导入、告警处置。不能改规则、不能改棚坐标、不能单条登记摄像头或改备注、不能看审计 |
| `viewer` | 查看 | 仅账号上的棚号 | 只读。采摘、告警处置、规则、批次新建、设备登记均 403 |

棚隔离在认证之后（`ShedScope`）。超管与生产管理员不限制棚；棚区负责人与查看只保留账号上的棚号；棚号列表为空则看不到任何棚。越权返回 403。

用户接口 `GET/POST /api/v1/users` 与 `PATCH /api/v1/users/:id` 仅超管。`POST` 在用户名已存在且未带 `resetPassword: true` 时返回 409「用户名已存在」。带上该字段时超管重设密码、显示名、角色和棚号，并重新启用，不另建一行。`PATCH` 请求体只有 `enabled` 布尔值，用来启停已有账号。停用后登录是 401。不能停用当前登录账号。没有这个用户是 404「用户不存在」。`enabled` 不是布尔，或带了别的字段，是 400。响应和列表都不含密码。列表行含 `enabled`。

侧栏按 `apps/web/src/admin-nav.json` 收菜单。未写 `roles` 的项，四个角色都能看见。`/audit`（审计）只给超管和生产管理员；棚区负责人和查看的侧栏没有这一项，直接打开地址会回到总览。`/users`（用户）只给超管。页面列出用户名、显示名、角色、棚区和启用。启用列写「启用」或「停用」，两字颜色不同。上方可新建（用户名、密码、显示名、角色、棚号），已有行可「重设密码」，也可对其他账号「停用」或「启用」。新建不带 `resetPassword`；重设带 `resetPassword: true`。启停走 `PATCH /api/v1/users/:id`。新建、重设或启停后列表重新读取，不显示密码。当前登录账号那一行没有停用按钮。其他角色的侧栏没有这一项，直接打开也回到总览。`GET /api/v1/audit-logs` 与 `GET /api/v1/login-logs` 仍仅超管与生产管理员，查看得到 403。棚区负责人与查看的 `GET /api/v1/sheds` 只有账号上的棚号。

审计页 `/audit`：上方是登录日志，下方是操作审计。登录日志按用户名和起止时间查询，请求 `GET /api/v1/login-logs` 参数 `username`、`from`、`to`，每页 100 条。用户名是整名匹配。时间按登录时间比较，含两端，可以只传一端。地址栏同步，空着不传。筛着时写出「用户 …」「时间 … 至 …」和「共 N 条」。没有命中时写「没有符合条件的登录日志。」。没有登录日志、也没在筛时写「暂无登录日志。」。开始晚于结束或时间填不开时写「时间筛选无效」，不请求登录日志，不保留上一张登录表。操作审计按同一口径查询，请求 `GET /api/v1/audit-logs` 的 `username`、`from`、`to`。地址栏用 `auditUsername`、`auditFrom`、`auditTo`，与登录日志的三个参数分开，空着不传。没有命中时写「没有符合条件的操作审计。」。没有操作审计、也没在筛时写「暂无操作审计。」。时间无效时写「时间筛选无效」，不请求操作审计，不保留上一张操作审计表。开始晚于结束或时间填不开时接口返回 400。

`make demo-rbac` 用 `admin` / `Admin@123456` 登录，把 `viewer` / `Viewer@123456` 写成查看、棚号 S01，再核对：超管菜单含审计和用户，查看菜单没有这两项；用户、审计、登录日志对查看是 403；查看的棚列表含 S01、不含 S02。不发识别，不发心跳，不改告警。

`make demo-shed-scope` 用同一超管登录，把 `shedlead` / `Shed@123456` 写成棚区负责人、棚号只有 S01。再留下「棚范围一号棚」（棚区 S01，摄像头 `CAM-SCOPE-S01`）和「棚范围二号棚」（棚区 S02，摄像头 `CAM-SCOPE-S02`）。同标题同摄像头已在则只改时间，不另建一行。超管的 `GET /api/v1/sheds` 含 S01 和 S02，`GET /api/v1/dashboard/overview` 的棚数至少为 2，告警列表两条都在。负责人棚列表只有 S01，棚数是 1，告警有一号棚、搜索「棚范围二号棚」为空。`/sheds` 编号列、`/duty-screen` 棚卡和底部棚数、`/alerts` 棚区列读的就是这三处。`/big-screen` 棚点同样来自棚列表。不发识别，不发心跳，不改接入观测。不改 `make demo-rbac`。

`make demo-audit-log` 用同一对账号。超管登录的 User-Agent 是 `audit-log-demo/1`，再对不存在的用户 `audit-demo` 做一次失败登录。`/audit` 上方登录日志有 `audit-demo` 失败和 `admin` 成功，User-Agent 都是 `audit-log-demo/1`。下方操作审计有「登录失败」（接口动作 `auth.login_failed`，明细 `audit-demo`）和 `admin` 的「登录成功」（`auth.login`）。`GET /api/v1/login-logs` 与 `GET /api/v1/audit-logs` 对超管是 200，第一页含这些行；查看仍是 403，打开 `/audit` 回到总览。已有 `viewer` 时重设密码，不另建一行。不发识别，不发心跳，不改告警。步骤见 [`DEMO_AUDIT_LOG.md`](DEMO_AUDIT_LOG.md)。

`make demo-audit-login-log` 留下用户 `login-log-fail` 的失败登录（当前时刻前 3 小时）和 `admin` 的成功登录（当前时刻），User-Agent 是 `audit-login-log-demo/1`。同一用户名、结果和 User-Agent 已在时只改时间。宽窗口（前 4 小时至后 1 分钟）两行都在，窄窗口（前 30 分钟）只有成功、没有 `login-log-fail`，窄窗口条数更少。只查 `login-log-fail` 是 1 条失败；再套窄窗口是 0 条，页面写「没有符合条件的登录日志。」。下方操作审计仍有「登录失败」（明细 `login-log-fail`）和 `admin` 的「登录成功」。不发识别，不发心跳，不改告警。不改 `make demo-audit-log`。步骤见 [`DEMO_AUDIT_LOGIN_LOG.md`](DEMO_AUDIT_LOGIN_LOG.md)。

`make demo-audit-action-filter` 留下用户 `audit-action-old` 的操作审计（当前时刻前 3 小时，动作 `harvest.correct`，资源 `recognition:audit-action-old`，成熟数 1→2，摄像头 `CAM-ACT-OLD`）和用户 `audit-action-new`（当前时刻，同一动作，资源 `recognition:audit-action-new`，成熟数 3→4，摄像头 `CAM-ACT-NEW`）。同一用户名和资源已在时只改时间。宽窗口两行都在，窄窗口只有 `audit-action-new`，条数更少。只查 `audit-action-old` 是 1 条；再套窄窗口是 0 条，页面写「没有符合条件的操作审计。」。开始晚于结束或时间填不开时 `GET /api/v1/audit-logs` 返回 400。不发识别，不发心跳，不改告警。不改 `GET /api/v1/login-logs`。不改 `make demo-audit-log`、`make demo-audit-login-log`。步骤见 [`DEMO_AUDIT_ACTION_FILTER.md`](DEMO_AUDIT_ACTION_FILTER.md)。

`make demo-user-mgmt` 用同一对账号，写入查看账号的方式与 `make demo-rbac` 相同。超管的 `GET /api/v1/users` 至少有 `admin`（角色超管）和 `viewer`（角色查看），列表不含密码。`/users` 的角色列用 `ROLE_LABEL` 写出这两字。查看该接口是 403，侧栏没有「用户」，打开 `/users` 回到总览。本命令只核对列表。不发识别，不发心跳，不改告警。步骤见 [`DEMO_USER_MGMT.md`](DEMO_USER_MGMT.md)。

`make demo-user-create-reset` 用 `admin` / `Admin@123456` 登录，新建 `user-create-demo` / `Create@123456`（显示名「新建演示」，角色查看，棚号 S01）。用户名已存在则不改这一行。`GET /api/v1/users` 含这一行，没有密码。再对 `user-reset-demo` 带 `resetPassword: true`，密码从 `ResetOld@123456` 写成 `ResetNew@123456`（显示名「重设演示」，棚号 S02）。重设后同一行仍在。新密码能登录，旧密码是 401。不改 `viewer` 的密码。不发识别，不发心跳，不改告警。步骤见 [`DEMO_USER_CREATE_RESET.md`](DEMO_USER_CREATE_RESET.md)。

`make demo-user-enable-disable` 用 `admin` / `Admin@123456` 登录，保证 `user-enable-demo` / `Enable@123456`（显示名「启停演示」，角色查看，棚号 S01）。还没有这个用户名时新建。已有则不改密码、显示名、角色和棚号。启用列先是启用，该密码能登录。再 `PATCH` `enabled` 为 false。同一行仍在，启用列是停用，同一密码是 401。不改 `admin`、`viewer`、`user-create-demo`、`user-reset-demo`。不发识别，不发心跳，不改告警。步骤见 [`DEMO_USER_ENABLE_DISABLE.md`](DEMO_USER_ENABLE_DISABLE.md)。

`POST /api/v1/auth/change-password` 给四个已登录角色改自己的密码。请求体只有 `currentPassword` 和 `newPassword`。改的是当前令牌上的账号，不能指定别人。当前密码不对是 400「当前密码不正确」。新密码少于 6 位、与当前密码相同，或带了别的字段，是 400。成功是 200，响应是用户名和 `changed: true`，没有密码。审计记 `auth.password_change`，明细只有用户名。之后旧密码登录是 401，新密码登录成功（`POST /auth/login` 仍是 201）。已经发出的令牌在过期前仍可用。侧栏「修改密码」不写 `roles`，四个角色都看见，地址 `/account/password`。页上写「旧密码不能登录，新密码可以登录」。超管在 `/users` 重设别人仍只走原来的 `resetPassword`。`make demo-password-self` 保证 `pwd-self-demo`（显示名「改密演示」，角色查看，棚号 S01）：还没有就用旧密码 `PwdOld@123456` 新建；已经有则写回旧密码，不另建一行。再由该账号改成 `PwdNew@123456`。旧密码登录 401，新密码登录成功。不改 `admin`、`viewer`、`producer`、`shedlead`、`user-create-demo`、`user-reset-demo`、`user-enable-demo`。不发识别，不发心跳，不改告警，不改接入观测。步骤见 [`DEMO_PASSWORD_SELF.md`](DEMO_PASSWORD_SELF.md)。

`/backup`（数据备份）只给超管。`GET /api/v1/backups/status` 与 `POST /api/v1/backups/run` 对生产管理员、棚区负责人和查看是 403。页面写出最近成功时间；没有成功记录时写「尚未成功备份」。最近一次是成功、失败或尚未运行。点「立即备份」后重新读取，成功时写「本次备份成功。最近成功时间是 …。」失败时保留上一次成功时间，并写「本次备份失败。」响应不含数据库连接串。`make demo-backup-run` 用 `admin` / `Admin@123456` 触发一次，最近成功时间从空或更早变为这次。查看 `viewer` / `Viewer@123456` 仍是 403。不发识别，不发心跳，不改告警。步骤见 [`DEMO_BACKUP_RUN.md`](DEMO_BACKUP_RUN.md)。

`/system-params`（系统参数）只给超管，侧栏在「数据备份」后面。`GET /api/v1/system-params` 与 `PATCH /api/v1/system-params` 对生产管理员、棚区负责人和查看是 403。三项：图片保留天数（默认 30）、时序保留天数（默认 90）、告警未读轮询秒数（默认 15）。没改过时与 `IMAGE_RETENTION_DAYS`、`TIMESERIES_RETENTION_DAYS`、`ALERT_UNREAD_POLL_SECONDS` 相同。保存后页面写出「告警未读轮询：15 秒 → 45 秒」这一类前后文案，当前值换成新数。每天 03:00 的清理读取前两项。超管顶栏按第三项轮询未读；其他角色读不到这一接口，顶栏仍是 15 秒。补传窗口仍是契约里的 90 天。心跳超时仍由 `DEVICE_OFFLINE_AFTER_MS` 决定。`make demo-sys-params` 用 `admin` / `Admin@123456` 只改告警未读轮询：15 秒变成 45 秒，已经是 45 秒则改回 15 秒。图片保留和时序保留不动。查看 `viewer` / `Viewer@123456` 仍是 403。不发识别，不发心跳，不改告警。不改接入观测。步骤见 [`DEMO_SYS_PARAMS.md`](DEMO_SYS_PARAMS.md)。

## 存储

| 组件 | 现状 |
|------|------|
| PostgreSQL | `make up` 使用钉死摘要的 `postgres:16-alpine`（摘要在 `docker-compose.yml`，`make images` 打印），库 `mushroom`。业务表含识别、环境、告警、设备、棚、桶、批次、采摘任务 |
| Timescale | 可选。`docker compose -f docker-compose.yml -f docker-compose.timescale.yml` 只换 Postgres 镜像。`009_timescale_optional.sql` 在 `make migrate` 时执行：没有扩展只写 NOTICE，有扩展也不在这条迁移里建 hypertable。`infra/timescale/enable.sql` 不进 `make migrate` |
| Redis | Compose 钉死摘要的 `redis:7-alpine`，端口 6379。接入幂等 `SETNX`。Redis 不可用时仍靠唯一约束去重 |
| MinIO | `make up` 构建本地镜像 `mushroom-object-store:20260916`（`infra/object-store/Dockerfile`，`pull_policy: build`，不向 Docker Hub 拉取这个名字）。基础镜像是钉死摘要的 `debian:bookworm-slim`。二进制是 GitHub Release `RELEASE.2026-09-16T00-00-00Z` 的 linux 包，sha256 校验后装入。不拉取 `pgsty/silo`，也不拉取 `quay.io/minio/minio`。端口 9000 / 控制台 9001，桶默认 `mushroom-snapshots`。数据在命名卷 `minio-hot`（`MINIO_HOT_DATA` 可改为 SSD 路径）。抓拍字节在这里，PostgreSQL 存对象键。Mosquitto 是钉死摘要的 `eclipse-mosquitto:2`，端口 1883，匿名。步骤见 `docs/DEMO_MAKE_UP.md` |
| 冷 MinIO | 可选。与热盘同一本地镜像。`docker-compose.minio-cold.yml`，端口 9002 / 控制台 9003，卷 `minio-cold`（`MINIO_COLD_DATA` 可改为 HDD 路径）。`make up` 不起冷端 |
| 登录日志 | 表 `login_logs`（迁移 `012_login_logs.sql`）。成功与失败都写：用户、结果、时间、IP、User-Agent。`GET /api/v1/login-logs` |
| Postgres 备份 | `make backup` → `backups/mushroom-<时间>.sql`，并写入 `postgres_backup_runs`。超管在 `/backup` 看最近成功时间。Redis 不备份。MinIO 字节不在该文件中 |

热冷复制脚本 `node scripts/object-tier.mjs`（`make object-tier`）。未设置 `MINIO_APPLY_TIER=1` 时只打印计划，退出码 0，不连接存储，并写 `热端对象键: 未列出` 与 `冷端对象键: 未列出`。设置之后必须同时有热端和冷端端点与密钥：把超过热天数的 `snapshots/` 复制到冷桶，读回字节一致才从热端删除。每个转走的键打印三行：`热端（前）`、`冷端（后）`、`热端（后）: 无 <键>`。读回不一致时没有最后一行，当前对象留在热端，退出码非 0。不可达时同样退出码非 0。此脚本不调用 `setBucketLifecycle`。

`make demo-object-tier` 不连接 MinIO。先打印上述计划（热天数 90，对象键未列出），再用夹具复制：`snapshots/tier-old.jpg` 转到冷端后热端没有，`snapshots/tier-new.jpg` 与 `other/tier-leave.jpg` 仍留热端。步骤见 [`DEMO_OBJECT_TIER.md`](DEMO_OBJECT_TIER.md)。

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
| 报表浏览器走查 | 登录后打开 `make demo-report-browse` 打印的两个预览地址，可以看全部棚与棚区 S02 的行数、点「导出」、点「打印」。仓库里没有无头浏览器自动完成登录并点选的测试 |
| 演示规模 | 种子是 S01、S02、S03 三棚。`facts.json` 记载约 30 个棚区、110 路摄像头。当前库内数据和大屏样张不是该规模 |
| Timescale 生产形态 | 默认仍是普通 Postgres。可选镜像与 `009` 的 NOTICE 没有把明细表改成 hypertable |
| 对象生命周期 | 云归档默认未下发。本地热 MinIO 无远端存储类时，配置下发会失败。自建冷盘复制默认不执行 |
| 日聚合旧表 | `daily_aggregates` 已删除。趋势、总览、大屏、批次回放、报表预览读桶 |
| 两套估计的空窗 | 不满 30 个上海自然日时，线性估计不给未来数字。日桶不足两天时，增速估计不给未来数字 |
| 产量单位 | 两套估计和采摘清单上的数字是成熟个数，不是公斤 |
| 快捷环境表 | `env.xlsx` 取识别记录上的环境字段。环境监控预览才读环境日桶 |
| 非超管建用户 | `/users` 的新建、重设和启停只给超管。生产管理员、棚区负责人、查看调用 `POST /api/v1/users` 或 `PATCH /api/v1/users/:id` 是 403 |
| 批次阶段 | 人工记录。自动切阶段没有业主确认的条件，不实现 |

## 证据指针

- 接入跑样：`evidence/ingest-sample/summary.json`；`make smoke` 当次目录 `evidence/ingest-last-run/`
- 过夜决策：`evidence/overnight-metric-buckets-67-69/decisions.tsv`、`evidence/overnight-orig-gaps/decisions.tsv`
- 大屏样张：`docs/evidence/monitor-batch`
- 谓词：`docs/OVERNIGHT_PRED_GAPS.md`；时序与生命周期说明：`docs/timescale-and-object-lifecycle.md`；备份、登录日志与热冷盘：`docs/OPS_STORAGE_BACKUP.md`
- 相关 PR：#70 识别入桶，#71 读桶与环境入桶，#74 去掉无用占位，#75 删除 `daily_aggregates`，#81 批次、采摘任务、报表预览与对象生命周期真下发（`04f7665`）。Issue #66–#69、#73、#77–#80 已关
