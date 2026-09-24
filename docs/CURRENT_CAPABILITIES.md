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

幂等：Redis `SETNX`，键存活 7 天（`IDEMPOTENCY_TTL_SECONDS`），再加数据库唯一约束。识别优先用报文 `idempotencyKey`，否则按棚、摄像头、识别时间哈希。环境优先用显式键，否则按棚、传感器、观测时间哈希。同一键再发返回已有记录，不双计。心跳在 `reportedAt` 不新于已存心跳时记为重复。

拒收观测：校验失败写入拒收记录。`GET /api/v1/ingest/observability` 汇总近窗接收、拒收、延迟和最近错误，覆盖识别（HTTP/MQTT）、环境与心跳。页面加载失败不渲染空表。棚区负责人看不到他棚，也看不到没有棚号的拒收。

自动建档：识别入库调用 `touchCamera`，未知棚调用 `ensureShed`，未知摄像头按编号建档（`meta.autoRegistered`）。环境与心跳走 `devices.heartbeat`，同样会建棚，并把未知设备登记为传感器或报文里的设备类型。新棚没有平面坐标。

抓拍：识别报文里的图尽量写入 MinIO，PostgreSQL 只存对象键和 URL。MinIO 不可用时识别记录仍入库，抓拍跳过。读取：`GET /api/v1/ingest/recognitions/:id/snapshot`。

已知限制：本仓不拉流、不识别画面。接入观测是汇总接口，不是客户现场链路监控。

## 总览与大屏

总览页面路由是 `/`（`DashboardView`）。接口是 `GET /api/v1/dashboard/overview`，同页还读 `GET /api/v1/sheds`、`GET /api/v1/devices`、`GET /api/v1/harvest/daily`、`GET /api/v1/ingest/environment-readings`、`GET /api/v1/alert-rules`。有序列时画近端成熟、总数、病害；温度图的阈值线只来自已启用规则。棚区平面只用已配置的 `mapX` / `mapY`。

大屏路由 `/big-screen`，根节点 `data-skin=tb-night`（夜色只在这一页）。默认一屏为指标、棚区平面、抓拍墙、告警与环境；可切抓拍墙或带时间轴的多区。时间轴进入 `/growth-trends`，或按上海日打开 `/recognitions`。数据来自总览、棚区、告警、设备、识别列表，以及 `GET /api/v1/growth-trends`（7 日）或 `GET /api/v1/growth-trends/hours`（24 小时）。侧栏「基地大屏」链到此页。`/phase2/big-screen` 重定向到 `/big-screen`。

棚区页 `/sheds`：`GET /api/v1/sheds` 按棚隔离列出。`PATCH /api/v1/sheds/:id` 只改平面坐标（0–100），仅超管与生产管理员可写。

## 设备、识别、环境、病害

设备 `/devices`。`GET/POST /api/v1/devices`，`PATCH /api/v1/devices/:id`，`POST /api/v1/devices/import`（CSV 文件、CSV 文本或 JSON 行）。编码冲突跳过且不改原档案。超管、生产管理员、棚区负责人可导入；查看人员 403。心跳超时（默认 5 分钟，`DEVICE_OFFLINE_AFTER_MS`）产生「设备离线」告警，恢复心跳自动关闭。在线状态以 `lastHeartbeatAt` 为准。

识别 `/recognitions`。`GET /api/v1/ingest/recognitions`，可按摄像头、上海日筛选。有图时打开已存抓拍。

环境 `/environment`。`GET /api/v1/ingest/environment-readings` 列出最近读数（温度、湿度、CO₂、基质含水率）。数据来自环境报文，不用识别报文里的温湿度充数。

病害 `/diseases`。`GET /api/v1/diseases` 只列 `diseaseCount>0` 的识别。同屏环境：`GET /api/v1/diseases/:id/environment`，按该识别的棚，取识别时间前后各 30 分钟（`DISEASE_ENV_WINDOW_MINUTES`）的环境读数；无读数返回「该时间窗内无环境读数」。高发：`GET /api/v1/diseases/peaks`，默认小时粒度读 `metric_buckets_hour`，`grain=day` 读日桶；页面在有桶时展示峰值。病害档案仍是识别明细，不是桶。

## 告警与阈值规则

告警 `/alerts`。`GET /api/v1/alerts`。

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

已知限制：阶段由人记录，不从识别结果自动推进。回放不读摄像头级桶。

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

接口还接受 `online`（设备）和 `status`（告警）。页面筛选表单没有这两项，不会把它们传给预览或导出。

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
| `super_admin` | 超管 | 全场 | 用户、阈值规则、棚坐标、采摘修正、采摘任务、批次、设备导入、告警处置、审计 |
| `production_admin` | 生产管理员 | 全场 | 与超管相同，但不能建用户 |
| `shed_manager` | 棚区负责人 | 仅账号上的棚号 | 采摘修正、采摘任务、批次、设备导入、告警处置。不能改规则、不能改棚坐标、不能看审计 |
| `viewer` | 查看 | 仅账号上的棚号 | 只读。采摘、告警处置、规则、批次新建均 403 |

棚隔离在认证之后（`ShedScope`）。超管与生产管理员不限制棚；棚区负责人与查看只保留账号上的棚号；棚号列表为空则看不到任何棚。越权返回 403。

用户接口 `GET/POST /api/v1/users` 仅超管。管理端没有用户页。审计页 `/audit`，`GET /api/v1/audit-logs`，仅超管与生产管理员。

## 存储

| 组件 | 现状 |
|------|------|
| PostgreSQL | `make up` 使用 `postgres:16-alpine`，库 `mushroom`。业务表含识别、环境、告警、设备、棚、桶、批次、采摘任务 |
| Timescale | 可选。`docker compose -f docker-compose.yml -f docker-compose.timescale.yml` 只换 Postgres 镜像。`009_timescale_optional.sql` 在 `make migrate` 时执行：没有扩展只写 NOTICE，有扩展也不在这条迁移里建 hypertable。`infra/timescale/enable.sql` 不进 `make migrate` |
| Redis | Compose `redis:7-alpine`，端口 6379。接入幂等 `SETNX`。Redis 不可用时仍靠唯一约束去重 |
| MinIO | Compose 端口 9000 / 控制台 9001，桶默认 `mushroom-snapshots`。抓拍字节在这里，PostgreSQL 存对象键。Mosquitto 端口 1883，匿名 |

对象生命周期脚本 `node scripts/object-lifecycle.mjs`，计划在 `infra/object-lifecycle.json`：前缀 `snapshots/`，热 90 天（可用 `OBJECT_HOT_DAYS` 覆盖）后转到 `GLACIER`。

默认**未下发**：未设置 `MINIO_APPLY_LIFECYCLE=1` 时只打印计划，退出码 0，不调用 MinIO。

算已下发必须同时满足：`MINIO_APPLY_LIFECYCLE=1`，以及 `MINIO_ENDPOINT`、`MINIO_ACCESS_KEY`、`MINIO_SECRET_KEY`，脚本 `setBucketLifecycle` 之后 `getBucketLifecycle` 读回同一前缀的启用规则。缺密钥、端点不可达、存储类被拒绝或读回不匹配时退出码非 0，不把失败当成已生效。

本地 compose 的 MinIO 没有远端存储类。在这份 MinIO 上按上面的条件去下发会失败，进程非零退出（fail-closed）。

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
| 对象生命周期 | 默认未下发。本地 MinIO 无远端存储类时，配置下发会失败 |
| 日聚合旧表 | `daily_aggregates` 已删除。趋势、总览、大屏、批次回放、报表预览读桶 |
| 两套估计的空窗 | 不满 30 个上海自然日时，线性估计不给未来数字。日桶不足两天时，增速估计不给未来数字 |
| 产量单位 | 两套估计和采摘清单上的数字是成熟个数，不是公斤 |
| 快捷环境表 | `env.xlsx` 取识别记录上的环境字段。环境监控预览才读环境日桶 |
| 用户页 | 只有超管 API，侧栏没有用户管理 |
| 批次阶段 | 人工记录，不随识别自动切换 |

## 证据指针

- 接入跑样：`evidence/ingest-sample/summary.json`；`make smoke` 当次目录 `evidence/ingest-last-run/`
- 过夜决策：`evidence/overnight-metric-buckets-67-69/decisions.tsv`、`evidence/overnight-orig-gaps/decisions.tsv`
- 大屏样张：`docs/evidence/monitor-batch`
- 谓词：`docs/OVERNIGHT_PRED_GAPS.md`；时序与生命周期说明：`docs/timescale-and-object-lifecycle.md`
- 相关 PR：#70 识别入桶，#71 读桶与环境入桶，#74 去掉无用占位，#75 删除 `daily_aggregates`，#81 批次、采摘任务、报表预览与对象生命周期真下发（`04f7665`）。Issue #66–#69、#73、#77–#80 已关
