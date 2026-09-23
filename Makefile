.PHONY: up api web test smoke migrate contracts lint

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
	node --test scripts/boundaries.spec.mjs
	npm --prefix apps/api test
	npm --prefix apps/web run typecheck

smoke: contracts
	npm --prefix apps/api install
	$(MAKE) up
	$(MAKE) migrate
	node scripts/smoke.mjs
