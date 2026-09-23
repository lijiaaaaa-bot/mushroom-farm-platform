# 架构墙

只记录代码会强制失败的约束。

| 墙 | 入口 | 强制点 |
| --- | --- | --- |
| 唯一入口 | `Makefile` | `up` `migrate` `api` `web` `test` `smoke` |
| 接入报文 | `packages/contracts/src/index.ts` `recognitionIngressSchema` | `.strict()`，未知字段返回 `UNKNOWN_FIELD` |
| 告警报文 | 同文件 `createAlertSchema` `alertNoteSchema` `alertStatusSchema` | 创建/确认/关闭走 schema；状态机只允许 open→acked→closed 与 open→closed |
| 错误码 | 同文件 `errorCodeSchema` | `UNKNOWN_FIELD` `VALIDATION_FAILED` `INVALID_TRANSITION` `UNAUTHORIZED` `FORBIDDEN` `NOT_FOUND` |
| 黄金报文 | `packages/contracts/fixtures/*.json` | `packages/contracts/src/contracts.spec.ts` 与 `scripts/smoke.mjs` 只读这些文件 |
| 模块边界 | `apps/api/.eslintrc.js` `no-restricted-imports`；`scripts/check-boundaries.mjs` | 功能模块只能从 `apps/api/src/<module>/index.ts` 导入 |
| Web 边界 | `apps/web/.eslintrc.cjs`；同一检查脚本 | 禁止 `@nestjs/*`、`apps/api`、`entities`；类型来自 `@mushroom/contracts` |
| 冒烟门禁 | `make smoke` | compose 依赖 + `infra/migrations` + 黄金接入 + 列表断言 + 告警确认；失败即非 0 |

共享内核（`common` `entities` `config` `database`）不在功能模块墙内。
