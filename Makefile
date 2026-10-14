.PHONY: up images images-probe api web test smoke smoke-evidence migrate contracts lint gates gates-selftest backup object-tier demo-one-ingest demo-register-and-ingest demo-register-and-heartbeat demo-camera-list demo-camera-detail demo-camera-create demo-camera-edit demo-camera-stop demo-camera-delete demo-one-alert demo-ack-one-alert demo-close-one-alert demo-threshold-alert demo-alert-camera-filter demo-alert-status-filter demo-alert-title-search demo-alert-handle-note demo-telemetry-latest demo-telemetry-history demo-recognition-history demo-telemetry-threshold-alert demo-alert-rule-config demo-alert-snapshot-minio demo-contrast

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
	node --test scripts/boundaries.spec.mjs scripts/evidence.spec.mjs scripts/edge-simulator.spec.mjs scripts/demo-one-http-recognition.spec.mjs scripts/demo-register-and-ingest.spec.mjs scripts/demo-register-and-heartbeat.spec.mjs scripts/demo-camera-list.spec.mjs scripts/demo-camera-detail.spec.mjs scripts/demo-camera-create.spec.mjs scripts/demo-camera-edit.spec.mjs scripts/demo-camera-stop.spec.mjs scripts/demo-camera-delete.spec.mjs scripts/demo-one-alert.spec.mjs scripts/demo-ack-close-alert.spec.mjs scripts/demo-threshold-alert.spec.mjs scripts/demo-alert-camera-filter.spec.mjs scripts/demo-alert-status-filter.spec.mjs scripts/demo-alert-title-search.spec.mjs scripts/demo-alert-handle-note.spec.mjs scripts/demo-telemetry-latest.spec.mjs scripts/demo-telemetry-history.spec.mjs scripts/demo-recognition-history.spec.mjs scripts/demo-telemetry-threshold-alert.spec.mjs scripts/demo-alert-rule-config.spec.mjs scripts/demo-alert-snapshot-minio.spec.mjs scripts/object-lifecycle.spec.mjs scripts/object-tier.spec.mjs scripts/backup-postgres.spec.mjs scripts/compose-minio-image.spec.mjs
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

# 发一条超阈值识别，留下一条温度过高告警。步骤见 docs/DEMO_ONE_ALERT.md。
demo-one-alert: contracts
	node scripts/demo-one-alert.mjs

# 确认这条待确认告警，再读一次。步骤见 docs/DEMO_ACK_CLOSE_ALERT.md。
demo-ack-one-alert: contracts
	node scripts/demo-ack-close-alert.mjs ack

# 关闭这条未闭合告警，再读一次。步骤见 docs/DEMO_ACK_CLOSE_ALERT.md。
demo-close-one-alert: contracts
	node scripts/demo-ack-close-alert.mjs close

# 把演示规则阈值改低，再发一条超限识别。告警列表出现对应告警。步骤见 docs/DEMO_THRESHOLD_ALERT.md。
demo-threshold-alert: contracts
	node scripts/demo-threshold-alert.mjs

# 留下两台摄像头的告警，再按其中一台筛选。步骤见 docs/DEMO_ALERT_CAMERA_FILTER.md。
demo-alert-camera-filter: contracts
	node scripts/demo-alert-camera-filter.mjs

# 留下一条待确认和一条已关闭告警，再按状态筛选。步骤见 docs/DEMO_ALERT_STATUS_FILTER.md。
demo-alert-status-filter: contracts
	node scripts/demo-alert-status-filter.mjs

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

# 按摄像头和时间窗列出识别记录。步骤见 docs/DEMO_RECOGNITION_HISTORY.md。
demo-recognition-history: contracts
	node scripts/demo-recognition-history.mjs

# 发一条超阈值环境遥测，告警列表和详情出现这条告警。步骤见 docs/DEMO_TELEMETRY_THRESHOLD_ALERT.md。
demo-telemetry-threshold-alert: contracts
	node scripts/demo-telemetry-threshold-alert.mjs

# 改环境温度阈值后，同一条遥测按新阈值出现或不再出现告警。步骤见 docs/DEMO_ALERT_RULE_CONFIG.md。
demo-alert-rule-config: contracts
	node scripts/demo-alert-rule-config.mjs

# 登录按钮、告警链接和警告色文字的对比度，以及新建告警表单的可访问名称。步骤见 docs/DEMO_MAKE_UP.md。
demo-contrast: contracts
	npm --prefix apps/web install
	npm --prefix apps/web test -- src/demo-path-contrast.spec.ts

# 发一条带样例 JPEG 的温度过高告警，详情能打开对象存储里的抓拍。步骤见 docs/DEMO_ALERT_SNAPSHOT_MINIO.md。
demo-alert-snapshot-minio: contracts
	node scripts/demo-alert-snapshot-minio.mjs

backup:
	node scripts/backup-postgres.mjs

object-tier:
	node scripts/object-tier.mjs
