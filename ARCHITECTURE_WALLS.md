# 架构墙

只记录会让 `make test` 或 `.github/workflows/test.yml` 退出码非 0 的约束。拦截点是这两个入口的退出码。

| 墙 | 入口 | 强制点 |
| --- | --- | --- |
| 唯一入口 | `Makefile` | `up` `migrate` `api` `web` `test` `smoke` `gates` |
| 交付物门禁 | `make gates`；`.github/workflows/deliverable-gates.yml` | `node scripts/gates/run-all.mjs`；与 `make test` 分开，非 0 即失败 |
| 接入报文 | `packages/contracts/src/index.ts` `recognitionIngressSchema` | `.strict()`，未知字段返回 `UNKNOWN_FIELD`。`parseRecognitionIngress` 必须调用 `recognitionIngressSchema.safeParse` |
| 接入路径 | `apps/api/src/ingest/ingest.controller.ts`、`mqtt.adapter.ts`、`ingest.service.ts`、`apps/api/src/configure-app.ts` | `scripts/check-boundaries.mjs`：controller 调用 `this.ingest.handle(body, 'http')`，参数为 `@Body() body: unknown`；MQTT `on('message')` 进入 `onMessage`，识别报文调用 `this.ingest.handle(body, 'mqtt')`；`IngestService` 调用 `parseRecognitionIngress`。`main.ts` 与 `ingest.wall.spec.ts` 都调用 `configureApp` |
| 告警报文 | 同文件 `createAlertSchema` `alertNoteSchema` `alertStatusSchema` | 创建/确认/关闭走 schema；状态机只允许 open→acked→closed 与 open→closed |
| 错误码 | 同文件 `errorCodeSchema` | `UNKNOWN_FIELD` `VALIDATION_FAILED` `INVALID_TRANSITION` `UNAUTHORIZED` `FORBIDDEN` `NOT_FOUND` |
| 黄金报文 | `packages/contracts/fixtures/*.json` | `packages/contracts/src/contracts.spec.ts` 与 `scripts/smoke.mjs` 只读这些文件 |
| 模块边界 | `apps/api/.eslintrc.js` `no-restricted-imports`；`scripts/check-boundaries.mjs` | 功能模块只能从 `apps/api/src/<module>/index.ts` 导入 |
| Web 边界 | `apps/web/.eslintrc.cjs`；同一检查脚本 | 禁止 `@nestjs/*`、`apps/api`、`entities`；类型来自 `@mushroom/contracts` |
| 负例 | `scripts/boundaries.spec.mjs`、`apps/api/src/ingest/ingest.wall.spec.ts` | 深导入使 check-boundaries 与 eslint `no-restricted-imports` 失败；HTTP 与 MQTT 未知字段得到 `UNKNOWN_FIELD` |
| 冒烟门禁 | `make smoke` | compose 依赖 + `infra/migrations` + 黄金接入（HTTP 与 MQTT）+ 列表断言 + 告警确认；失败即非 0 |
| CI | `.github/workflows/test.yml` | `pull_request` 与 `main` push 执行 `make test` |

共享内核（`common` `entities` `config` `database`）不在功能模块墙内。心跳 `mushroom/+/+/heartbeat` 进入 `DevicesService.heartbeat`，不写识别记录。
