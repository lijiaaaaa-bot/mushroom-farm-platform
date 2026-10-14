.PHONY: up api web test smoke smoke-evidence migrate contracts lint gates gates-selftest backup object-tier demo-one-ingest demo-register-and-ingest demo-register-and-heartbeat

contracts:
	npm --prefix packages/contracts install
	npm --prefix packages/contracts run build

up:
	docker compose up -d --wait

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
	node --test scripts/boundaries.spec.mjs scripts/evidence.spec.mjs scripts/edge-simulator.spec.mjs scripts/demo-one-http-recognition.spec.mjs scripts/demo-register-and-ingest.spec.mjs scripts/demo-register-and-heartbeat.spec.mjs scripts/object-lifecycle.spec.mjs scripts/object-tier.spec.mjs scripts/backup-postgres.spec.mjs scripts/compose-minio-image.spec.mjs
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

backup:
	node scripts/backup-postgres.mjs

object-tier:
	node scripts/object-tier.mjs
