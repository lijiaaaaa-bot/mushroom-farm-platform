.PHONY: up api web test smoke smoke-evidence migrate contracts lint gates gates-selftest backup object-tier

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
	node --test scripts/boundaries.spec.mjs scripts/evidence.spec.mjs scripts/edge-simulator.spec.mjs scripts/object-lifecycle.spec.mjs scripts/object-tier.spec.mjs scripts/backup-postgres.spec.mjs
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

backup:
	node scripts/backup-postgres.mjs

object-tier:
	node scripts/object-tier.mjs
