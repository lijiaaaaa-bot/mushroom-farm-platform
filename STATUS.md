# STATUS｜mushroom-farm-platform

更新：2026-10-14（Asia/Shanghai）
仓：https://github.com/lijiaaaaa-bot/mushroom-farm-platform

进度只认：已合并 PR + 已关闭 Issue + 本文件一行。聊天文字不算交付。

## 已完成
- harness 已抽出为 project-harness-day0（https://github.com/lijiaaaaa-bot/project-harness-day0）
- Day-1 硬墙 + HTTP 接入 + 告警确认（smoke）
- 公开 GitHub main；`bid-sample/`、`docs/` 在仓内
- #7 squash 合入 main、#6 已关闭：接入墙与 CI 门禁在 main
- #5 squash 合入 main（4dd50a1）、#1 已关闭：MQTT recognition 与 HTTP 同管道
- CI job `ingest-smoke` 跑 `make smoke`：`scripts/edge-simulator.mjs` 向 Mosquitto / HTTP 发送契约黄金报文，证据目录 `evidence/ingest-last-run/` 上传为 artifact `ingest-smoke-evidence`；可打开的一次真实跑样在 `evidence/ingest-sample/summary.json`
- #2 `/big-screen` 五区页（顶 / 左 / 中 / 右 / 底）接现有总览、棚区、告警、设备、识别列表 API；路由与页面实体测试见 https://github.com/lijiaaaaa-bot/mushroom-farm-platform/pull/10
- #3 admin devices/alerts/harvest/reports wired to existing API + vitest + Family B Light; PR #19; Issue closed.
- #4 console PR #1 merged（https://github.com/lijiaaaaa-bot/mushroom-project-console/pull/1 ，squash f75deeb）；`public/status.json` matches Issues/PR/STATUS；Issue #4 closed.
- #23 `/alert-rules` writable for admins; PR #24 merged; Issue closed.
- #26 `/diseases` 列出 diseaseCount>0 的识别，识别页与病害页可打开已存抓拍；PR #29 squash 合入 main（ca8ef58）；Issue closed.
- #30 `/devices` 摄像头批量导入；PR #31 squash 合入 main（746e224）；Issue closed.
- #32 站内告警未读入口；PR #33 squash 合入 main（5d104b2）；Issue closed.
- #27 棚区平面坐标（F-R2-03 / F-R8-03）：`sheds.map_x` / `map_y`、管理端可编辑、大屏点位读取配置坐标；PR #28 squash 合入 main（dfbdbd0）；Issue closed. https://github.com/lijiaaaaa-bot/mushroom-farm-platform/pull/28
- #34 环境报文接入与管理端观测：`POST /api/v1/ingest/environment` 与 MQTT `mushroom/+/+/environment` 写入 `environment_readings`；`/environment` 展示最近读数。PR #35 squash 合入 main（0c4f329）；Issue closed. https://github.com/lijiaaaaa-bot/mushroom-farm-platform/pull/35
- #36 `/harvest` 当日清单可修正成熟数与蘑菇数，写入审计（谁、何时、旧值→新值、棚/摄像头）；汇总随修正更新；棚隔离；查看员只读。PR #37 squash 合入 main（418dee1）；Issue closed. https://github.com/lijiaaaaa-bot/mushroom-farm-platform/pull/37
- #38 F-R8-02 设备心跳与离线告警：HTTP `POST /api/v1/ingest/heartbeat` 与 MQTT `mushroom/+/+/heartbeat` 写入 lastHeartbeatAt，超时产生设备离线告警，恢复心跳自动关闭。PR #40 squash 合入 main（d23fc66）；Issue closed. https://github.com/lijiaaaaa-bot/mushroom-farm-platform/pull/40
- #41 F-R1-07 接入可观测：`GET /api/v1/ingest/observability` 汇总近窗接收、拒收、延迟与最近错误；覆盖识别 HTTP/MQTT、环境与心跳。`/ingest-observability` 展示数字与最近错误，加载失败不渲染空表。PR #42 squash 合入 main（4d04654）；Issue closed. https://github.com/lijiaaaaa-bot/mushroom-farm-platform/pull/42
- #43 F-R3-04 告警认领与误报关闭：`POST /api/v1/alerts/:id/claim` 写入认领人；`POST /api/v1/alerts/:id/false-positive` 以 closeReason `false_positive` 关闭，与普通关闭的 `resolved` 区分；认领、误报、关闭写入审计。`/alerts` 有认领与误报入口，查看员只读。PR #44 squash 合入 main（6690bcb）；Issue closed. https://github.com/lijiaaaaa-bot/mushroom-farm-platform/pull/44
- #48 管理端总览在 `/dashboard/overview` 有序列时用 ECharts 画成熟、总数、病害，并列出未关闭告警与最近识别；识别页与病害页为抓拍图卡。侧栏 `#1B7A4E`，页面底 `#F5F7FA`，白卡片 8px 圆角、1px `#E5E6EB`。PR #51 squash 合入 main（e2876e1）；Issue #48 已关闭。https://github.com/lijiaaaaa-bot/mushroom-farm-platform/pull/51
- #57 侧栏「基地大屏」紧跟总览并链到 `/big-screen`，去掉「二期槽位」；企微不进侧栏。PR #57 squash 合入 main（199bc05）。
- #54 F-R3-06 严重告警推送企微/钉钉：`WECOM_WEBHOOK_URL` 与/或 `DINGTALK_WEBHOOK_URL`（可选 `DINGTALK_WEBHOOK_SECRET`）。未配置则不发送、不报错。推送失败只记日志。告警页进入 `/phase2/wecom`。PR #58 squash 合入 main（e948335）；Issue #54 已关闭。https://github.com/lijiaaaaa-bot/mushroom-farm-platform/pull/58
- #60 管理端总览改为 ThingsBoard 浅色运营台：指标条、已配置坐标的棚区平面、棚区表、温度图（阈值来自已启用规则）、近 7 日成熟/总数/病害、右侧告警表。侧栏沿用 #57。PR #60 squash 合入 main（af813be）。
- `GET /api/v1/alerts/unread`：`alert_reads.alert_id` 与 `alerts.id` 同为 uuid。已有库由 `007_alert_reads_alert_id_uuid.sql` 丢掉空值和非 uuid 行后 `ALTER ... USING btrim(alert_id)::uuid`。未读计数不再因 `character varying = uuid` 返回 500。PR #61。https://github.com/lijiaaaaa-bot/mushroom-farm-platform/pull/61
- #62 管理端总览浅色顶栏与白导航，棚区平面床位底图与状态芯片，大屏夜色抓拍卡收紧。PR #62 squash 合入 main（54dbcf4）。
- #47 F-R4-01 / F-R4-02 生长趋势日聚合：`daily_aggregates` 按棚与摄像头保存当日最新蘑菇数和菌盖直径均值；识别入库后刷新，每小时回写昨日与当日；`GET /api/v1/growth-trends?days=7|30` 按棚隔离；`/growth-trends` 只画已有日点。PR #52 squash 合入 main（5499b26）；Issue #47 已关闭。https://github.com/lijiaaaaa-bot/mushroom-farm-platform/pull/52
- #49 F-R6-03 近 2–3 日产量估计 + #50 F-R5-02 病害与同期环境同屏：`GET /api/v1/harvest/yield-estimate` 用近 30 个上海自然日、各摄像头当日最新成熟数之和做线性外推，响应与 `/harvest` 标注「估计」；不满 30 天只返回说明、`days` 为空。`GET /api/v1/diseases/:id/environment` 按识别棚对齐识别时间前后各 30 分钟的温度、湿度、CO₂、基质含水率；无读数返回「该时间窗内无环境读数」，不用识别报文里的环境字段充数。棚隔离。PR #53 squash 合入 main（770b89f）；Issue #49、#50 已关闭。https://github.com/lijiaaaaa-bot/mushroom-farm-platform/pull/53
- #55 F-R2-04 基地大屏：管理端侧栏与顶栏进入 `/big-screen`。默认一屏为指标、棚区平面、抓拍墙、告警与环境；可切抓拍墙或带时间轴的多区。时间轴跳到 `/growth-trends` 或识别记录的上海日筛选。夜色投屏皮肤 `data-skin=tb-night` 只在这一页。PR #59 squash 合入 main（663fbf5）；Issue #55 已关闭。https://github.com/lijiaaaaa-bot/mushroom-farm-platform/pull/59
- #63 总览与大屏去掉大色块、收字阶：白导航、短标题、平面改为状态色钉、抓拍墙无图为细框「无图」，有图出 JPEG。阈值线与在线/离线/一般/严重可扫。PR #64 squash 合入 main（0b21e2b）；Issue #63 已关闭。https://github.com/lijiaaaaa-bot/mushroom-farm-platform/pull/64
- #66 指标预聚合切片 B：`metric_buckets_hour` / `metric_buckets_day`，识别 ingest 按 `recognizedAt`（Asia/Shanghai）增量 upsert 小时桶与日桶，同一幂等键不双计。PR #70 squash 合入 main（da73760）；Issue #66 已关闭。https://github.com/lijiaaaaa-bot/mushroom-farm-platform/pull/70
- #67 指标预聚合读路径（趋势、总览与大屏）已完成；PR [#71](https://github.com/lijiaaaaa-bot/mushroom-farm-platform/pull/71) 已 squash 合入 main（d5f0838f）；Issue #67 已关闭。
- #68 环境入桶与病害高发读桶已完成；PR [#71](https://github.com/lijiaaaaa-bot/mushroom-farm-platform/pull/71) 已 squash 合入 main（d5f0838f）；Issue #68 已关闭。
- #69 Timescale 可选路径：`docker-compose.timescale.yml` 只换 Postgres 镜像；`009_timescale_optional.sql` 只 NOTICE，不建 hypertable，`enable.sql` 不进 `make migrate`。PR [#71](https://github.com/lijiaaaaa-bot/mushroom-farm-platform/pull/71) squash 合入 main（d5f0838f）；Issue #69 已关闭。对象生命周期的真下发不在 #71，见 #80。
- #75 停写并删除 `daily_aggregates`。识别 ingest 不再双写日聚合表；`refreshDay` 只回写小时桶与日桶。迁移 `010_drop_daily_aggregates.sql`。PR #75 squash 合入 main（59a9083）。Issue #73 已关闭。
- #77 出菇批次：`/batches` 新建、阶段（出菇 / 快速生长 / 成熟）、关闭；`GET /api/v1/batches/:id/replay` 读该棚棚级日桶。PR [#81](https://github.com/lijiaaaaa-bot/mushroom-farm-platform/pull/81) squash 合入 main（04f7665）；Issue #77 已关闭。
- #78 采摘任务与日桶增速：`POST /api/v1/harvest/tasks/generate`、`PATCH /api/v1/harvest/tasks/:id`；`GET /api/v1/harvest/bucket-forecast` 用近 7 日棚级成熟日桶首尾增速外推未来 3 日成熟数（不是公斤）。PR #81（04f7665）；Issue #78 已关闭。
- #79 报表筛选预览与 xlsx：六类 `growth` / `yield` / `disease` / `environment` / `devices` / `alerts`；`/reports` 预览、`export.xlsx`、浏览器 `window.print()`。PR #81（04f7665）；Issue #79 已关闭。报表页没有登录后的浏览器端到端测试。
- #80 对象生命周期：`scripts/object-lifecycle.mjs` 默认打印未下发并退出码 0。仅当 `MINIO_APPLY_LIFECYCLE=1` 且端点与密钥齐全、读回同一前缀的启用规则，才算已下发；失败退出码非 0。本地 compose MinIO 无远端存储类时下发失败（fail-closed）。PR #81（04f7665）；Issue #80 已关闭。能力对照见 [`docs/CURRENT_CAPABILITIES.md`](docs/CURRENT_CAPABILITIES.md)。

- 登录日志、Postgres 备份与可选热冷 MinIO：`login_logs` 记录成功/失败（用户、时间、IP、User-Agent），`GET /api/v1/login-logs` 仅超管与生产管理员，`/audit` 上方可看。`make backup` 用 `pg_dump` 写 `backups/mushroom-<时间>.sql`（Redis 与 MinIO 不在文件内）。热盘卷 `minio-hot`；冷盘为 `docker-compose.minio-cold.yml`。`make object-tier` 未设置 `MINIO_APPLY_TIER=1` 时只打印计划；设置后复制超龄 `snapshots/` 到冷端，读回一致才删热端。云归档仍走 `object-lifecycle.mjs`，本地无远端存储类则 fail-closed。批次阶段仍人工，自动切换待业主确认规则。说明见 `docs/OPS_STORAGE_BACKUP.md`。PR #85。https://github.com/lijiaaaaa-bot/mushroom-farm-platform/pull/85
- 报表预览与导出：设备可按在线（`online=online|offline`）、告警可按状态（`open` / `acked` / `closed`）筛选，与已有 preview / export.xlsx 参数一致。`make test` 与 `make gates` 退出码 0。PR #87。https://github.com/lijiaaaaa-bot/mushroom-farm-platform/pull/87
- 审计页登录日志区可填用户名与起止日期，请求已有的 `GET /api/v1/login-logs` 参数 `username`、`from`、`to`；空值不传。登录日志接口未改。`make test` 与 `make gates` 退出码 0。PR #88。https://github.com/lijiaaaaa-bot/mushroom-farm-platform/pull/88
- 告警页可按状态（全部 / 待确认 / 已确认 / 已关闭）和级别（全部 / 提示 / 一般 / 严重）筛选，请求已有的 `GET /api/v1/alerts` 参数 `status`、`level`；选全部不传。告警接口未改。`make test` 与 `make gates` 退出码 0。PR #90。https://github.com/lijiaaaaa-bot/mushroom-farm-platform/pull/90
- 热盘与冷盘对象存储镜像改为 `pgsty/silo:RELEASE.2026-09-16T00-00-00Z`。`quay.io/minio/minio:RELEASE.2024-12-18T13-15-44Z` 匿名拉取返回 401，`make smoke` 在 `docker compose up` 退出，接入报文未发出。
- 值班看板 `/duty-screen`：棚卡为正常、告警、离线或未知，在线摄像头、当日日桶识别条数、一条未闭合告警。侧栏与顶栏在基地大屏之后。右侧为接入近窗与告警、拒收。底部为总览与分棚日桶。`/big-screen` 不变。PR #91。https://github.com/lijiaaaaa-bot/mushroom-farm-platform/pull/91
- 值班看板棚卡进入 `/duty-screen/:shedCode`：该棚摄像头（名称、编码、在线或离线、最近心跳）和未闭合告警（标题、级别、状态、时间）。返回 `/duty-screen`。沿用 `GET /api/v1/devices?type=camera&shedCode=`、`GET /api/v1/alerts` 的 `status` 与 `shedCode`、`GET /api/v1/sheds`。`/big-screen` 不变。PR #92。https://github.com/lijiaaaaa-bot/mushroom-farm-platform/pull/92
- 值班棚详情的未闭合告警可点进 `/alerts`，查询带棚号、状态和告警 id；告警页按棚和状态筛选并高亮该条。不改告警接口，不改 `/big-screen`。
- 值班看板 `/duty-screen` 上方三格：在线设备、离线设备、待确认。在线和离线与 `GET /api/v1/devices?online=online|offline` 的条数一致，点进去打开 `/devices?online=`。待确认是 `status=open`，点进去打开 `/alerts?status=open`。`make demo-duty-board` 留下一台在线、一台离线和一条待确认告警。步骤见 `docs/DEMO_DUTY_BOARD.md`。不改告警状态筛选，不改 `/big-screen`。PR #120。https://github.com/lijiaaaaa-bot/mushroom-farm-platform/pull/120
- 一条识别样例：`make demo-one-ingest` 读取 `packages/contracts/fixtures/recognition.demo-one.json`，把识别时间改成当前时刻，POST 一次 `POST /api/v1/ingest/recognition`，终端打印 id。登录 `admin` / `Admin@123456` 后打开 `/recognitions?cameraCode=CAM-DEMO-01`。步骤见 `docs/DEMO_ONE_INGEST.md`。PR #94。https://github.com/lijiaaaaa-bot/mushroom-farm-platform/pull/94
- 样例抓拍写入对象存储：`make up` 构建 `mushroom-object-store:20260916`（`infra/object-store`，GitHub Release `RELEASE.2026-09-16T00-00-00Z` 的 linux 包，校验 sha256），不拉取 `pgsty/silo` 或 `quay.io/minio/minio`。`make demo-one-ingest` 成功时打印抓拍对象键，并且 `GET /api/v1/ingest/recognitions/<id>/snapshot` 读回样例 JPEG。识别列表截图 `docs/evidence/demo-one-ingest/recognitions-cam-demo-01.png`。
- 设备页可登记一台摄像头（编号、棚区、名称、备注）。保存备注后刷新仍在。`POST/PATCH /api/v1/devices` 的 `note` 可空。在线状态仍由心跳决定。步骤见 `docs/CURRENT_CAPABILITIES.md` 的「登记一台摄像头」。PR #96。https://github.com/lijiaaaaa-bot/mushroom-farm-platform/pull/96
- 登记 `CAM-REG-02` 再发一条识别：`make demo-register-and-ingest` 先 `POST /api/v1/devices`（已存在则不改档案），再把样例识别的摄像头编号改成 `CAM-REG-02` 并 POST 一次。样例文件里的 `CAM-DEMO-01` 不改。登录后打开 `/recognitions?cameraCode=CAM-REG-02`。步骤见 `docs/DEMO_REGISTER_AND_INGEST.md`。PR #97。https://github.com/lijiaaaaa-bot/mushroom-farm-platform/pull/97
- 登记 `CAM-REG-02` 再发一条心跳：`make demo-register-and-heartbeat` 先 `POST /api/v1/devices`（已存在则不改档案），再 POST 一次 `POST /api/v1/ingest/heartbeat`（设备类型 `camera`，`online` 为 true，心跳时间为当前时刻）。设备列表这一行 `onlineStatus` 为 `online` 且 `lastHeartbeatAt` 有值。登录后 `/devices` 与 `/duty-screen/S01` 显示在线。不改 `heartbeat.http.json`，不发识别。步骤见 `docs/DEMO_REGISTER_AND_HEARTBEAT.md`。PR #98。https://github.com/lijiaaaaa-bot/mushroom-farm-platform/pull/98
- 一条温度过高告警：`make demo-one-alert` 把样例识别的摄像头改成 `CAM-ALERT-01`、温度改成 30，POST 一次。种子规则「温度过高」（阈值 28）留下未闭合告警。`GET /api/v1/alerts/:id` 与 `/alerts/:id` 显示标题、说明、级别、状态、棚区、摄像头、时间和阈值。列表标题点进详情。样例文件里的 `CAM-DEMO-01` 不改。步骤见 `docs/DEMO_ONE_ALERT.md`。PR #99。https://github.com/lijiaaaaa-bot/mushroom-farm-platform/pull/99
- 待确认告警可确认或关闭：告警列表与详情对值班人员提供「确认」「关闭」。点下去后重新读取，刷新页面状态仍是已确认或已关闭。`make demo-ack-one-alert` 确认 `make demo-one-alert` 留下的待确认温度过高告警并再读一次；`make demo-close-one-alert` 关闭这条未闭合告警并再读一次。不改 `make demo-one-alert` 与样例文件。步骤见 `docs/DEMO_ACK_CLOSE_ALERT.md`。PR #100。https://github.com/lijiaaaaa-bot/mushroom-farm-platform/pull/100
- 改阈值后超限识别进入告警列表：`make demo-threshold-alert` 把规则「演示二氧化碳过高」的阈值从 1500 改成 1000，再 POST 一条摄像头 `CAM-THRESH-01`、CO₂ 1200 的识别。待确认列表出现「CO₂过高告警」，说明里是 1200 和阈值 1000。种子规则「二氧化碳过高」仍是 2000。不改样例文件，不改 `make demo-one-alert` 与确认/关闭命令。步骤见 `docs/DEMO_THRESHOLD_ALERT.md`。PR #101。https://github.com/lijiaaaaa-bot/mushroom-farm-platform/pull/101
- 告警列表可按摄像头编号筛选：`GET /api/v1/alerts` 接受 `cameraCode`，精确匹配；空白不传。`/alerts` 填编号后点「筛选」，只显示该摄像头；标题仍进 `/alerts/:id`；点「清除」回到多摄像头列表。`make demo-alert-camera-filter` 留下 `CAM-FILTER-01` 与 `CAM-FILTER-02` 两条告警，并核对筛选、详情和清除。不发识别，不改已有演示命令。步骤见 `docs/DEMO_ALERT_CAMERA_FILTER.md`。
- 告警列表可按状态筛选：状态下拉选「待确认」只请求 `status=open`，选「已确认」只请求 `status=acked`，选「已关闭」只请求 `status=closed`，改回「全部」不传 `status`。没有匹配时写「暂无告警。」，不保留上一次的全部列表。标题仍进详情，返回后筛选还在。`make demo-alert-status-filter` 留下 `CAM-STATUS-01` 待确认、`CAM-STATUS-03` 已确认和 `CAM-STATUS-02` 已关闭，并核对三种筛选、详情和全部。确认备注与 `make demo-ack-one-alert` 相同，关闭备注与 `make demo-close-one-alert` 相同，不改其他告警。步骤见 `docs/DEMO_ALERT_STATUS_FILTER.md`。
- 告警列表可按标题关键词搜索：`GET /api/v1/alerts` 接受 `q`，按标题子串匹配，不区分大小写；空白不传。`/alerts` 填关键词后点「搜索」，只显示标题匹配的行；标题仍进 `/alerts/:id`；点「清除搜索」回到全部。`make demo-alert-title-search` 留下「东侧标题搜索告警」和「西侧过道对照告警」，并核对搜索、详情和清除。不发识别，不改已有演示命令。步骤见 `docs/DEMO_ALERT_TITLE_SEARCH.md`。
- 确认或关闭告警时可填写非空处理说明：详情页「处理说明」随 `POST /api/v1/alerts/:id/ack` 写入 `ackNote`，随 `POST /api/v1/alerts/:id/close` 写入 `closeNote`。空白不提交。详情重新读取后显示这句，刷新仍在。`make demo-alert-handle-note` 从待确认的「处理说明告警」（`CAM-NOTE-01`）确认，备注「现场已开窗通风」，并再读一次详情。不发识别，不改已有演示命令。步骤见 `docs/DEMO_ALERT_HANDLE_NOTE.md`。PR #105。
- 告警抓拍写入对象存储，详情页显示这张图：识别触发告警时记下 `snapshotObjectKey`。`GET /api/v1/alerts/:id/snapshot` 从 MinIO 读回。`/alerts/:id` 显示图片、对象键和「打开抓拍」。列表有对象键时标题旁有「抓拍」。`make demo-alert-snapshot-minio` 用摄像头 `CAM-SNAP-01`、温度 30 和样例 JPEG 留下一条告警，并核对对象键与读回字节。未闭合告警还没有对象键时，下一次同规则识别把键补上，不改状态。步骤见 `docs/DEMO_ALERT_SNAPSHOT_MINIO.md`。
- `make up` 拉取的 Postgres、Redis、Mosquitto 与对象存储基础镜像都带 sha256。对象存储镜像 `mushroom-object-store:20260916` 使用 `pull_policy: build`，不向 Docker Hub 拉取这个名字。`make images-probe` 核对摘要和 silo 包仍可取。登录按钮与告警链接的绿色改为 `#1B7A4E`，警告色文字改为 `#9A6700`，白底和页面底上达到 4.5:1。新建告警的棚区、摄像头、级别、标题、说明有可访问名称。步骤见 `docs/DEMO_MAKE_UP.md`。
- 环境遥测最新值：`make demo-telemetry-latest` 先 POST 较早一条（温度 19.2℃），再 POST 当前时刻的一条（传感器 `SENSOR-LATEST-01`，温度 24.6℃，湿度 85%，CO₂ 760，基质含水率 72%）。`GET /api/v1/ingest/environment-readings/latest?sensorCode=SENSOR-LATEST-01` 只返回后一条。`GET /api/v1/ingest/environment-readings/:id` 是同一条。`/environment` 的「最新值」点传感器进入 `/environment/:id`。MQTT 主题 `mushroom/S01/SENSOR-LATEST-01/environment`。`environment.golden.json` 不改。步骤见 `docs/DEMO_TELEMETRY_LATEST.md`。
- 环境遥测历史列表：`/environment` 按传感器编号和 `from` / `to` 查询 `environment_readings`。`make demo-telemetry-history` 写入 `SENSOR-HIST-01` 的 16.5℃、18.4℃、23.1℃ 和 `SENSOR-HIST-02` 的 21℃。近 30 分钟窗口里有 18.4℃ 和 23.1℃，没有窗外的 16.5℃ 和另一台传感器。小时桶仍在入库时写入。不改 `make demo-telemetry-latest`。步骤见 `docs/DEMO_TELEMETRY_HISTORY.md`。
- 识别记录按镜头和时间可查：`GET /api/v1/ingest/recognitions` 接受 `cameraCode` 与 `from` / `to`。`/recognitions` 可填摄像头和起止时间，地址栏同样生效。上海日的 `from`、`to` 和棚区仍在。`make demo-recognition-history` 写入 `CAM-HIST-01` 的总数 7、9、12 和 `CAM-HIST-02` 的总数 11。近 30 分钟窗口里有总数 9 和 12。不改已有演示命令。步骤见 `docs/DEMO_RECOGNITION_HISTORY.md`。
- 环境遥测超阈自动告警：`make demo-telemetry-threshold-alert` POST 一条传感器 `SENSOR-TELEM-01`、温度 32℃ 的环境读数。种子规则「温度过高」（阈值 28，严重）留下未闭合告警。告警列表标题下有传感器和说明，详情有标题、当前值 32℃、阈值 28℃、状态待确认。湿度 88%、CO₂ 900、基质含水率 70% 不超过其余种子规则。不改 `make demo-one-alert`、`make demo-threshold-alert`、`make demo-telemetry-latest`。步骤见 `docs/DEMO_TELEMETRY_THRESHOLD_ALERT.md`。PR #109。https://github.com/lijiaaaaa-bot/mushroom-farm-platform/pull/109
- 环境温度阈值可改，并决定遥测是否告警：`make demo-alert-rule-config` 维护规则「演示环境温度过高」（一般，棚区 S03）。温度 26℃ 在阈值 30 时不告警，改成 24 后告警，改回 30 后不再告警，最后写回 24 并留下待确认告警。当前值 26，阈值 24，传感器 `SENSOR-RULE-01`。种子规则「温度过高」仍是 28。不改 `make demo-telemetry-threshold-alert` 与其他已有演示。步骤见 `docs/DEMO_ALERT_RULE_CONFIG.md`。
- 设备列表显示镜头码：`make demo-camera-list` 保证 `CAM-ALERT-01` 在 `GET /api/v1/devices?pageSize=100` 里。编码已存在则不改档案。`/devices` 摄像头行有镜头码、编号、名称、类型、棚区、状态、备注、最近心跳，并链到 `/alerts?cameraCode=CAM-ALERT-01` 与 `/recognitions?cameraCode=CAM-ALERT-01`。新建时名称「温度告警镜头」、棚区 S01、离线、备注「镜头码对照告警」。不发识别，不发心跳，不改已有演示命令。步骤见 `docs/DEMO_CAMERA_LIST.md`。
- 新增一台镜头：`make demo-camera-create` 登记 `CAM-NEW-01`（棚区 S01，名称新增镜头，备注新增可演示）。编码已存在则不改档案。`GET /api/v1/devices?pageSize=100` 与 `GET /api/v1/devices/:id` 字段一致。`/devices` 登记后列表有这一行，并可打开详情。不发识别，不发心跳，不新建告警，不改已有演示命令。步骤见 `docs/DEMO_CAMERA_CREATE.md`。
- 镜头详情：`/devices` 点镜头码进入 `/devices/:id`。`GET /api/v1/devices/:id` 返回编号、名称、类型、棚区、状态、备注、最近心跳。相关告警来自 `GET /api/v1/alerts?cameraCode=`。`make demo-camera-detail` 保证 `CAM-ALERT-01` 并留下或沿用「镜头详情告警」。不发识别，不发心跳，不改已有演示命令。步骤见 `docs/DEMO_CAMERA_DETAIL.md`。PR #112。https://github.com/lijiaaaaa-bot/mushroom-farm-platform/pull/112
- 镜头可改备注和状态：`make demo-camera-edit` 登记 `CAM-EDIT-01`（棚区 S01，名称可编辑镜头，备注编辑前）。已存在则不改名称和心跳。再 `PATCH` 备注为「备注已改」、状态为在线。`GET /api/v1/devices?pageSize=100` 与 `GET /api/v1/devices/:id` 两处一致。`/devices` 与 `/devices/:id` 可保存这两项。不发识别，不发心跳，不改已有演示命令。步骤见 `docs/DEMO_CAMERA_EDIT.md`。
- 镜头可停用：`make demo-camera-stop` 登记 `CAM-STOP-01`（棚区 S01，名称可停用镜头，备注停用前）。已存在则不改名称和心跳。再 `PATCH` `enabled` 为 false。`GET /api/v1/devices?pageSize=100` 与 `GET /api/v1/devices/:id` 两处启用都是停用，备注和在线状态不变，详情仍可打开。`/devices` 与 `/devices/:id` 可停用，也可再启用。不发识别，不发心跳，不删除档案，不改已有演示命令。步骤见 `docs/DEMO_CAMERA_STOP.md`。
- 镜头可删除：`make demo-camera-delete` 登记 `CAM-DEL-01`（棚区 S01，名称可删除镜头，备注删除前）。已存在则不改名称和心跳。列表能看到后，`PATCH` 备注为「删除前已改」，再 `DELETE`。列表不再有这一台，`GET /api/v1/devices/:id` 是 404「设备不存在」。没有软删除列。告警和识别仍按镜头码留着。`/devices` 与 `/devices/:id` 可删除。不发识别，不发心跳，不改已有演示命令。步骤见 `docs/DEMO_CAMERA_DELETE.md`。
- 心跳超时后设备离线并留下告警：`make demo-heartbeat-offline-alert` 登记 `CAM-HB-OFF-01`（棚区 S01，名称心跳超时镜头，备注心跳超时演示）。已存在则不改档案。再 POST 一次在线心跳。API 以 `DEVICE_OFFLINE_AFTER_MS=2000` 启动时，扫描间隔约 1 秒，这一行变为离线，并留下未闭合的「设备离线」告警。`/devices` 与 `/alerts/:id`。默认仍是 5 分钟，命令不空等。不发识别，不改 `heartbeat.http.json`，不改已有演示命令。步骤见 `docs/DEMO_HEARTBEAT_OFFLINE_ALERT.md`。PR #119。https://github.com/lijiaaaaa-bot/mushroom-farm-platform/pull/119

- 超管与查看登录后菜单不同：`make demo-rbac` 保证 `admin` / `Admin@123456` 与 `viewer` / `Viewer@123456`（棚号 S01）。侧栏「审计」只给超管和生产管理员，「用户」只给超管；查看打开 `/audit` 或 `/users` 回到总览。`GET /api/v1/users`、`/audit-logs`、`/login-logs` 对查看是 403。查看的棚列表含 S01、不含 S02。已有 `viewer` 且请求带 `resetPassword: true` 时重设密码和棚号，不另建一行。不发识别，不发心跳，不改告警。步骤见 `docs/DEMO_RBAC.md`。PR #121。https://github.com/lijiaaaaa-bot/mushroom-farm-platform/pull/121
- 审计页能看到登录和操作记录：`make demo-audit-log` 用 `admin` / `Admin@123456` 登录（User-Agent `audit-log-demo/1`），再对不存在的用户 `audit-demo` 做一次失败登录。`/audit` 上方有 `audit-demo` 失败和 `admin` 成功；下方有「登录失败」（明细 `audit-demo`）和 `admin` 的「登录成功」。`GET /api/v1/login-logs` 与 `GET /api/v1/audit-logs` 对超管是 200，查看 `viewer` / `Viewer@123456` 仍是 403，打开 `/audit` 回到总览。不发识别，不发心跳，不改告警。步骤见 `docs/DEMO_AUDIT_LOG.md`。PR #123。https://github.com/lijiaaaaa-bot/mushroom-farm-platform/pull/123
- 超管打开 `/users` 至少看到两条账号及角色：`make demo-user-mgmt` 用 `admin` / `Admin@123456` 把 `viewer` / `Viewer@123456` 写成查看（与 `make demo-rbac` 同一写入）。列表有 `admin`（超管）和 `viewer`（查看），不含密码。查看该接口 403，侧栏没有「用户」，打开 `/users` 回到总览。页面没有新建或重设密码表单。不发识别，不发心跳，不改告警。步骤见 `docs/DEMO_USER_MGMT.md`。PR #124。https://github.com/lijiaaaaa-bot/mushroom-farm-platform/pull/124

## 进行中
- 无

## 待开
- 无

## 规范
- 当前能力（路由、接口、限制）：[`docs/CURRENT_CAPABILITIES.md`](docs/CURRENT_CAPABILITIES.md)
- 指标预聚合与时序存储：[`docs/metrics-preaggregation-requirements.md`](docs/metrics-preaggregation-requirements.md)（切片 B–E：#66 #67 #68 #69）
- Overnight 工单：协议在 harness `docs/OVERNIGHT.md`；本仓指针 `docs/OVERNIGHT_TICKET.md` 与 Issue 表单。PR：#18
- 识别与环境补传窗口为 90 天（`LIMITS.recognizedAtPastDays`），与时序明细在线保留一致。
- 本地演示可以只有少量棚与摄像头，对照需求规格约 30 棚、110 路摄像头；大屏抓拍墙样张在 `docs/evidence/monitor-batch`。

## 阻塞
- 无
