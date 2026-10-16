.PHONY: up images images-probe api web test smoke smoke-evidence migrate contracts lint gates gates-selftest backup object-tier demo-object-tier demo-one-ingest demo-register-and-ingest demo-register-and-heartbeat demo-heartbeat-offline-alert demo-duty-board demo-device-online demo-device-online-filter demo-device-detail demo-camera-list demo-camera-detail demo-camera-create demo-camera-edit demo-camera-stop demo-camera-delete demo-device-csv-import demo-one-alert demo-alert-detail demo-ack-one-alert demo-close-one-alert demo-alert-ack demo-threshold-alert demo-alert-camera-filter demo-alert-status-filter demo-alert-time-range demo-alert-by-device demo-alert-title-search demo-alert-handle-note demo-telemetry-latest demo-telemetry-history demo-env-filter demo-recognition-history demo-telemetry-threshold-alert demo-alert-rule-config demo-alert-snapshot-minio demo-contrast demo-rbac demo-shed-scope demo-audit-log demo-audit-login-log demo-audit-action-filter demo-user-mgmt demo-user-create-reset demo-user-enable-disable demo-password-self demo-report-xlsx demo-report-browse demo-alert-ledger demo-disease-list demo-disease-grade-filter demo-disease-env-detail demo-disease-hotspot demo-harvest-list demo-harvest-filter demo-harvest-task demo-alert-rules demo-alert-rule-edit demo-growth-trend demo-growth-grain demo-maturity-rate demo-shed-env-24h demo-shed-growth-compare demo-shed-growth-delta demo-shed-disease-trend demo-shed-live-stats demo-capture-preview demo-today-recog-capture demo-today-disease-count demo-live-mushroom-totals demo-fruiting-batch demo-yield-forecast demo-backup-run demo-sys-params

contracts:
	npm --prefix packages/contracts install
	npm --prefix packages/contracts run build

# 打印 make up 要拉取的摘要，以及本地构建的对象存储。浮动标签或被禁仓库则退出码非 0。
images:
	node scripts/compose-images.mjs

# 在 images 的文件检查之外，向 Docker Hub 与 GitHub Release 核对摘要和 silo 包仍可取。
images-probe: images
	node scripts/compose-images.mjs --probe

up: images
	docker compose up -d --build --wait

migrate:
	node scripts/migrate.mjs

api: contracts
	npm --prefix apps/api install
	npm --prefix apps/api run start:dev

web: contracts
	npm --prefix apps/web install
	npm --prefix apps/web run dev -- --host 0.0.0.0 --port 43123

lint:
	npm --prefix apps/api install
	npm --prefix apps/web install
	npm --prefix apps/api run lint
	npm --prefix apps/web run lint
	node scripts/check-boundaries.mjs

test: contracts lint
	npm --prefix packages/contracts test
	node --test scripts/boundaries.spec.mjs scripts/evidence.spec.mjs scripts/edge-simulator.spec.mjs scripts/demo-one-http-recognition.spec.mjs scripts/demo-register-and-ingest.spec.mjs scripts/demo-register-and-heartbeat.spec.mjs scripts/demo-heartbeat-offline-alert.spec.mjs scripts/demo-duty-board.spec.mjs scripts/demo-device-online.spec.mjs scripts/demo-device-online-filter.spec.mjs scripts/demo-device-detail.spec.mjs scripts/demo-camera-list.spec.mjs scripts/demo-camera-detail.spec.mjs scripts/demo-camera-create.spec.mjs scripts/demo-camera-edit.spec.mjs scripts/demo-camera-stop.spec.mjs scripts/demo-camera-delete.spec.mjs scripts/demo-device-csv-import.spec.mjs scripts/demo-one-alert.spec.mjs scripts/demo-alert-detail.spec.mjs scripts/demo-ack-close-alert.spec.mjs scripts/demo-alert-ack.spec.mjs scripts/demo-threshold-alert.spec.mjs scripts/demo-alert-camera-filter.spec.mjs scripts/demo-alert-status-filter.spec.mjs scripts/demo-alert-time-range.spec.mjs scripts/demo-alert-by-device.spec.mjs scripts/demo-report-xlsx.spec.mjs scripts/demo-report-browse.spec.mjs scripts/demo-alert-ledger.spec.mjs scripts/demo-disease-list.spec.mjs scripts/demo-disease-grade-filter.spec.mjs scripts/demo-disease-env-detail.spec.mjs scripts/demo-disease-hotspot.spec.mjs scripts/demo-harvest-list.spec.mjs scripts/demo-harvest-filter.spec.mjs scripts/demo-harvest-task.spec.mjs scripts/demo-growth-trend.spec.mjs scripts/demo-growth-grain.spec.mjs scripts/demo-maturity-rate.spec.mjs scripts/demo-shed-env-24h.spec.mjs scripts/demo-shed-growth-compare.spec.mjs scripts/demo-shed-growth-delta.spec.mjs scripts/demo-shed-disease-trend.spec.mjs scripts/demo-shed-live-stats.spec.mjs scripts/demo-capture-preview.spec.mjs scripts/demo-today-recog-capture.spec.mjs scripts/demo-today-disease-count.spec.mjs scripts/demo-live-mushroom-totals.spec.mjs scripts/demo-fruiting-batch.spec.mjs scripts/demo-yield-forecast.spec.mjs scripts/demo-alert-title-search.spec.mjs scripts/demo-alert-handle-note.spec.mjs scripts/demo-telemetry-latest.spec.mjs scripts/demo-telemetry-history.spec.mjs scripts/demo-env-filter.spec.mjs scripts/demo-recognition-history.spec.mjs scripts/demo-rbac.spec.mjs scripts/demo-shed-scope.spec.mjs scripts/demo-audit-log.spec.mjs scripts/demo-audit-login-log.spec.mjs scripts/demo-audit-action-filter.spec.mjs scripts/demo-user-mgmt.spec.mjs scripts/demo-user-create-reset.spec.mjs scripts/demo-user-enable-disable.spec.mjs scripts/demo-password-self.spec.mjs scripts/demo-telemetry-threshold-alert.spec.mjs scripts/demo-alert-rule-config.spec.mjs scripts/demo-alert-rules.spec.mjs scripts/demo-alert-rule-edit.spec.mjs scripts/demo-alert-snapshot-minio.spec.mjs scripts/object-lifecycle.spec.mjs scripts/object-tier.spec.mjs scripts/demo-object-tier.spec.mjs scripts/backup-postgres.spec.mjs scripts/demo-backup-run.spec.mjs scripts/demo-sys-params.spec.mjs scripts/compose-minio-image.spec.mjs
	npm --prefix apps/api test
	npm --prefix apps/web run typecheck
	npm --prefix apps/web test

# 交付物门禁，与 test 分开。CI：.github/workflows/deliverable-gates.yml
gates:
	node scripts/gates/run-all.mjs

gates-selftest:
	node scripts/gates/selftest.mjs

# HTTP 黄金报文，以及 Mosquitto 上的 recognition.mqtt.json / heartbeat.mqtt.json。
# 发送方是 scripts/edge-simulator.mjs。证据写入 evidence/ingest-last-run/summary.json。
smoke: contracts
	npm --prefix apps/api install
	$(MAKE) up
	$(MAKE) migrate
	node scripts/smoke.mjs

smoke-evidence: smoke

# 发一条识别样例（HTTP）。识别时间改为当前时刻。步骤见 docs/DEMO_ONE_INGEST.md。
demo-one-ingest: contracts
	node scripts/demo-one-http-recognition.mjs

# 登记 CAM-REG-02，再给这台摄像头发一条识别。步骤见 docs/DEMO_REGISTER_AND_INGEST.md。
demo-register-and-ingest: contracts
	node scripts/demo-register-and-ingest.mjs

# 登记 CAM-REG-02，再发一条心跳。设备页与值班棚详情显示在线。步骤见 docs/DEMO_REGISTER_AND_HEARTBEAT.md。
demo-register-and-heartbeat: contracts
	node scripts/demo-register-and-heartbeat.mjs

# 登记 CAM-HB-OFF-01，发一条在线心跳，短超时后设备离线并留下告警。步骤见 docs/DEMO_HEARTBEAT_OFFLINE_ALERT.md。
demo-heartbeat-offline-alert: contracts
	node scripts/demo-heartbeat-offline-alert.mjs

# 值班看板三个数字：在线、离线、待确认。步骤见 docs/DEMO_DUTY_BOARD.md。
demo-duty-board: contracts
	node scripts/demo-duty-board.mjs

# 设备列表同一页看见一台在线、一台离线。步骤见 docs/DEMO_DEVICE_ONLINE.md。
demo-device-online: contracts
	node scripts/demo-device-online.mjs

# 设备列表按在线或离线筛选，两份列表的行不一样。步骤见 docs/DEMO_DEVICE_ONLINE_FILTER.md。
demo-device-online-filter: contracts
	node scripts/demo-device-online-filter.mjs

# 设备详情页看见在线和最近心跳，以及一台离线。步骤见 docs/DEMO_DEVICE_DETAIL.md。
demo-device-detail: contracts
	node scripts/demo-device-detail.mjs

# 保证设备列表里有 CAM-ALERT-01，页面能看到镜头码。步骤见 docs/DEMO_CAMERA_LIST.md。
demo-camera-list: contracts
	node scripts/demo-camera-list.mjs

# 从设备列表点进 CAM-ALERT-01 的镜头详情，并看到相关告警。步骤见 docs/DEMO_CAMERA_DETAIL.md。
demo-camera-detail: contracts
	node scripts/demo-camera-detail.mjs

# 新增 CAM-NEW-01，设备列表和镜头详情都能看到。步骤见 docs/DEMO_CAMERA_CREATE.md。
demo-camera-create: contracts
	node scripts/demo-camera-create.mjs

# 改 CAM-EDIT-01 的备注和状态，列表和镜头详情都能看到。步骤见 docs/DEMO_CAMERA_EDIT.md。
demo-camera-edit: contracts
	node scripts/demo-camera-edit.mjs

# 停用 CAM-STOP-01，列表和镜头详情仍能看到停用。步骤见 docs/DEMO_CAMERA_STOP.md。
demo-camera-stop: contracts
	node scripts/demo-camera-stop.mjs

# 登记 CAM-DEL-01，改备注后再删除。列表和详情都不再有这一台。步骤见 docs/DEMO_CAMERA_DELETE.md。
demo-camera-delete: contracts
	node scripts/demo-camera-delete.mjs

# CSV 导入 CAM-CSV-01。同文件第二行编码冲突则跳过，不改原档案。步骤见 docs/DEMO_DEVICE_CSV_IMPORT.md。
demo-device-csv-import: contracts
	node scripts/demo-device-csv-import.mjs

# 发一条超阈值识别，留下一条温度过高告警。步骤见 docs/DEMO_ONE_ALERT.md。
demo-one-alert: contracts
	node scripts/demo-one-alert.mjs

# 保证一条温度过高告警，并打印详情地址。步骤见 docs/DEMO_ALERT_DETAIL.md。
demo-alert-detail: contracts
	node scripts/demo-alert-detail.mjs

# 确认这条待确认告警，再读一次。步骤见 docs/DEMO_ACK_CLOSE_ALERT.md。
demo-ack-one-alert: contracts
	node scripts/demo-ack-close-alert.mjs ack

# 关闭这条未闭合告警，再读一次。步骤见 docs/DEMO_ACK_CLOSE_ALERT.md。
demo-close-one-alert: contracts
	node scripts/demo-ack-close-alert.mjs close

# 列表留下待确认、已确认、已关闭。已关闭是先确认再关闭。步骤见 docs/DEMO_ALERT_ACK.md。
demo-alert-ack: contracts
	node scripts/demo-alert-ack.mjs

# 把演示规则阈值改低，再发一条超限识别。告警列表出现对应告警。步骤见 docs/DEMO_THRESHOLD_ALERT.md。
demo-threshold-alert: contracts
	node scripts/demo-threshold-alert.mjs

# 留下两台摄像头的告警，再按其中一台筛选。步骤见 docs/DEMO_ALERT_CAMERA_FILTER.md。
demo-alert-camera-filter: contracts
	node scripts/demo-alert-camera-filter.mjs

# 留下待确认、已确认、已关闭各一条告警，再按状态筛选。步骤见 docs/DEMO_ALERT_STATUS_FILTER.md。
demo-alert-status-filter: contracts
	node scripts/demo-alert-status-filter.mjs

# 留下三条不同 createdAt 的告警，再按起止时间筛选。步骤见 docs/DEMO_ALERT_TIME_RANGE.md。
demo-alert-time-range: contracts
	node scripts/demo-alert-time-range.mjs

# 留下两台设备的告警，再按设备 id 筛选。步骤见 docs/DEMO_ALERT_BY_DEVICE.md。
demo-alert-by-device: contracts
	node scripts/demo-alert-by-device.mjs

# 留下两条不同标题的告警，再按标题关键词搜索。步骤见 docs/DEMO_ALERT_TITLE_SEARCH.md。
demo-alert-title-search: contracts
	node scripts/demo-alert-title-search.mjs

# 确认一条待确认告警并写入处理说明，再读两次详情。步骤见 docs/DEMO_ALERT_HANDLE_NOTE.md。
demo-alert-handle-note: contracts
	node scripts/demo-alert-handle-note.mjs

# 发两条环境遥测，最新值出现在列表和详情。步骤见 docs/DEMO_TELEMETRY_LATEST.md。
demo-telemetry-latest: contracts
	node scripts/demo-telemetry-latest.mjs

# 按传感器和时间窗列出环境遥测历史。步骤见 docs/DEMO_TELEMETRY_HISTORY.md。
demo-telemetry-history: contracts
	node scripts/demo-telemetry-history.mjs

# 按起止时间筛选环境读数，宽窗口三条、窄窗口两条。步骤见 docs/DEMO_ENV_FILTER.md。
demo-env-filter: contracts
	node scripts/demo-env-filter.mjs

# 按摄像头和时间窗列出识别记录。步骤见 docs/DEMO_RECOGNITION_HISTORY.md。
demo-recognition-history: contracts
	node scripts/demo-recognition-history.mjs

# 发一条超阈值环境遥测，告警列表和详情出现这条告警。步骤见 docs/DEMO_TELEMETRY_THRESHOLD_ALERT.md。
demo-telemetry-threshold-alert: contracts
	node scripts/demo-telemetry-threshold-alert.mjs

# 改环境温度阈值后，同一条遥测按新阈值出现或不再出现告警。步骤见 docs/DEMO_ALERT_RULE_CONFIG.md。
demo-alert-rule-config: contracts
	node scripts/demo-alert-rule-config.mjs

# 保证一条阈值规则在列表和详情里都能打开。步骤见 docs/DEMO_ALERT_RULES.md。
demo-alert-rules: contracts
	node scripts/demo-alert-rules.mjs

# 新建一条阈值规则，再改阈值、等级、窗口和启用。列表与详情立刻是新值。步骤见 docs/DEMO_ALERT_RULE_EDIT.md。
demo-alert-rule-edit: contracts
	node scripts/demo-alert-rule-edit.mjs

# 登录按钮、告警链接和警告色文字的对比度，以及新建告警表单的可访问名称。步骤见 docs/DEMO_MAKE_UP.md。
demo-contrast: contracts
	npm --prefix apps/web install
	npm --prefix apps/web test -- src/demo-path-contrast.spec.ts

# 发一条带样例 JPEG 的温度过高告警，详情能打开对象存储里的抓拍。步骤见 docs/DEMO_ALERT_SNAPSHOT_MINIO.md。
demo-alert-snapshot-minio: contracts
	node scripts/demo-alert-snapshot-minio.mjs

# 超管与查看用已知密码登录，侧栏与审计、用户接口不同。步骤见 docs/DEMO_RBAC.md。
demo-rbac: contracts
	node scripts/demo-rbac.mjs

# 超管看到 S01 与 S02，棚区负责人只看到 S01。步骤见 docs/DEMO_SHED_SCOPE.md。
demo-shed-scope: contracts
	node scripts/demo-shed-scope.mjs

# 留下可认出的登录日志和操作审计，查看仍不能打开审计。步骤见 docs/DEMO_AUDIT_LOG.md。
demo-audit-log: contracts
	node scripts/demo-audit-log.mjs

# 留下失败和成功两条登录日志，按用户名和起止时间在审计页对照。步骤见 docs/DEMO_AUDIT_LOGIN_LOG.md。
demo-audit-login-log: contracts
	node scripts/demo-audit-login-log.mjs

# 留下两条时间错开的操作审计，按用户名和起止时间在审计页对照。步骤见 docs/DEMO_AUDIT_ACTION_FILTER.md。
demo-audit-action-filter: contracts
	node scripts/demo-audit-action-filter.mjs

# 超管打开用户页至少看到两条账号和角色，查看进不去。步骤见 docs/DEMO_USER_MGMT.md。
demo-user-mgmt: contracts
	node scripts/demo-user-mgmt.mjs

# 超管新建一条演示账号，再重设另一条的密码并对照登录。步骤见 docs/DEMO_USER_CREATE_RESET.md。
demo-user-create-reset: contracts
	node scripts/demo-user-create-reset.mjs

# 超管停用一条已有账号，启用列从启用变为停用，登录变为 401。步骤见 docs/DEMO_USER_ENABLE_DISABLE.md。
demo-user-enable-disable: contracts
	node scripts/demo-user-enable-disable.mjs

# 登录用户改自己的密码。旧密码登录 401，新密码登录成功。步骤见 docs/DEMO_PASSWORD_SELF.md。
demo-password-self: contracts
	node scripts/demo-password-self.mjs

# 园区生长预览有行，并下载 export.xlsx。步骤见 docs/DEMO_REPORT_XLSX.md。
demo-report-xlsx: contracts
	node scripts/demo-report-xlsx.mjs

# 园区生长全部棚比只看 S02 行更多，并下载 export.xlsx。步骤见 docs/DEMO_REPORT_BROWSE.md。
demo-report-browse: contracts
	node scripts/demo-report-browse.mjs

# 留下待确认和已关闭告警，核对告警闭环台账预览和 xlsx。步骤见 docs/DEMO_ALERT_LEDGER.md。
demo-alert-ledger: contracts
	node scripts/demo-alert-ledger.mjs

# 写入一条病害识别，列表和详情都能打开。步骤见 docs/DEMO_DISEASE_LIST.md。
demo-disease-list: contracts
	node scripts/demo-disease-list.mjs

# 写入轻度和严重两条病害识别，按等级对照列表。步骤见 docs/DEMO_DISEASE_GRADE_FILTER.md。
demo-disease-grade-filter: contracts
	node scripts/demo-disease-grade-filter.mjs

# 写入一条病害识别和同棚窗内环境读数，详情同一屏能看到温度、湿度、CO₂、基质含水率。步骤见 docs/DEMO_DISEASE_ENV_DETAIL.md。
demo-disease-env-detail: contracts
	node scripts/demo-disease-env-detail.mjs

# 写入两棚病害识别，小时和日都能看出高发时段与高发棚区。步骤见 docs/DEMO_DISEASE_HOTSPOT.md。
demo-disease-hotspot: contracts
	node scripts/demo-disease-hotspot.mjs

# 写入一条采摘识别，当日清单和详情都能打开。步骤见 docs/DEMO_HARVEST_LIST.md。
demo-harvest-list: contracts
	node scripts/demo-harvest-list.mjs

# 写入两棚两条采摘识别，按棚区和时间窗对照。步骤见 docs/DEMO_HARVEST_FILTER.md。
demo-harvest-filter: contracts
	node scripts/demo-harvest-filter.mjs

# 生成当日采摘任务，并排上人员和班次。步骤见 docs/DEMO_HARVEST_TASK.md。
demo-harvest-task: contracts
	node scripts/demo-harvest-task.mjs

# 写入 CAM-GT-01 三天生长点，趋势页能看到蘑菇数和成熟数。步骤见 docs/DEMO_GROWTH_TREND.md。
demo-growth-trend: contracts
	node scripts/demo-growth-trend.mjs

# 写入 CAM-GG-01 六个上海日，日、周、月的点数和周期标签不同。步骤见 docs/DEMO_GROWTH_GRAIN.md。
demo-growth-grain: contracts
	node scripts/demo-growth-grain.mjs

# 写入 CAM-MR-01 四天成熟率，趋势页同屏读出百分数和升降。步骤见 docs/DEMO_MATURITY_RATE.md。
demo-maturity-rate: contracts
	node scripts/demo-maturity-rate.mjs

# 写入 SENSOR-ENV24-01 近 24 小时环境曲线。步骤见 docs/DEMO_SHED_ENV_24H.md。
demo-shed-env-24h: contracts
	node scripts/demo-shed-env-24h.mjs

# 写入 S01 与 S02 各三天生长点，棚间对比页同屏看到差距。步骤见 docs/DEMO_SHED_GROWTH_COMPARE.md。
demo-shed-growth-compare: contracts
	node scripts/demo-shed-growth-compare.mjs

# 写入 CAM-GD-01 四天生长点，单棚增量页读出相邻日的差。步骤见 docs/DEMO_SHED_GROWTH_DELTA.md。
demo-shed-growth-delta: contracts
	node scripts/demo-shed-growth-delta.mjs

# 写入 CAM-SDT-01 四天病害数量，单棚病害趋势页读出日桶升降。步骤见 docs/DEMO_SHED_DISEASE_TREND.md。
demo-shed-disease-trend: contracts
	node scripts/demo-shed-disease-trend.mjs

# 写入 CAM-SLS-01 当日一条识别，单棚实时页读出蘑菇、成熟、待成熟、病害。步骤见 docs/DEMO_SHED_LIVE_STATS.md。
demo-shed-live-stats: contracts
	node scripts/demo-shed-live-stats.mjs

# 写入 CAM-CP-01 三条抓拍，对照页左右看原始图和 AI标注。步骤见 docs/DEMO_CAPTURE_PREVIEW.md。
demo-capture-preview: contracts
	node scripts/demo-capture-preview.mjs

# 写入 CAM-TRC-01 当天两条抓拍和一条无抓拍，总览与大屏读出今日识别次数、今日抓拍总量。步骤见 docs/DEMO_TODAY_RECOG_CAPTURE.md。
demo-today-recog-capture: contracts
	node scripts/demo-today-recog-capture.mjs

# 写入 CAM-TDC-01、CAM-TDC-02 当天各一条识别，总览与大屏读出当日病害总数。步骤见 docs/DEMO_TODAY_DISEASE_COUNT.md。
demo-today-disease-count: contracts
	node scripts/demo-today-disease-count.mjs

# 写入 CAM-LMT-01、CAM-LMT-02 与对照棚 0，总览与大屏读出在养、成熟、待成熟。步骤见 docs/DEMO_LIVE_MUSHROOM_TOTALS.md。
demo-live-mushroom-totals: contracts
	node scripts/demo-live-mushroom-totals.mjs

# 留下出菇批次，记下阶段，并回放棚级日桶。步骤见 docs/DEMO_FRUITING_BATCH.md。
demo-fruiting-batch: contracts
	node scripts/demo-fruiting-batch.mjs

# 写入 CAM-YF-01 三天成熟数，采摘页看到未来 2–3 日估计。步骤见 docs/DEMO_YIELD_FORECAST.md。
demo-yield-forecast: contracts
	node scripts/demo-yield-forecast.mjs

backup:
	node scripts/backup-postgres.mjs

# 超管触发一次 Postgres 备份，备份页看到新的成功时间。步骤见 docs/DEMO_BACKUP_RUN.md。
demo-backup-run: contracts
	node scripts/demo-backup-run.mjs

demo-sys-params: contracts
	node scripts/demo-sys-params.mjs

object-tier:
	node scripts/object-tier.mjs

# 计划与夹具转移前后对照。不连接 MinIO。步骤见 docs/DEMO_OBJECT_TIER.md（make demo-object-tier）。
demo-object-tier:
	node scripts/demo-object-tier.mjs
