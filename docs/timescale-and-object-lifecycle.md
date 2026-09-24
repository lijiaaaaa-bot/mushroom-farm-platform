# Timescale 可选路径与对象存储生命周期

默认本地演示仍是 `docker-compose.yml` 里的 `postgres:16-alpine`。本文件不把 Timescale 或冷存储写成已经在生产启用。

## Timescale

`make up` 不拉取 Timescale 镜像，也不改现有数据卷。

要换可选镜像（需要一份新的数据卷，不要把 vanilla PostgreSQL 的数据目录直接挂到 Timescale 镜像上）：

```bash
docker compose -f docker-compose.yml -f docker-compose.timescale.yml up -d postgres
make migrate
```

`docker-compose.timescale.yml` 只覆盖 `postgres.image`，其余服务不变。

`infra/migrations/009_timescale_optional.sql` 会在 `make migrate` 时执行。没有 `timescaledb` 扩展时只写一条 NOTICE，明细表保持普通 PostgreSQL 表。有扩展时也只写 NOTICE，不在这条迁移里 `CREATE EXTENSION`，也不把表改成 hypertable。

手工启用写在 `infra/timescale/enable.sql`。执行前要满足 Timescale 的约束：唯一索引必须包含分区时间列（`recognition_records.recognized_at`、`environment_readings.observed_at`）。当前主键和幂等键不包含时间列，所以这份 SQL 默认不进 `make migrate`。明细保留与补传窗口同为 90 天（`TIMESERIES_RETENTION_DAYS`）。`enable.sql` 里的 `add_retention_policy` 是注释，避免本地演示被自动删数。

## 对象存储

抓拍字节进 MinIO 或云 OSS，PostgreSQL 只存对象键和 URL。热数据按 90 天对齐补传窗口，更早的对象按前缀 `snapshots/` 转入冷存储或归档。本地 compose 的 MinIO 没有远端存储类，脚本不会假装已经执行生命周期。

计划文件：`infra/object-lifecycle.json`（`hotDays` 可用环境变量 `OBJECT_HOT_DAYS` 覆盖打印值）。

```bash
node scripts/object-lifecycle.mjs
```

退出码 0，并说明本地未下发生命周期。只有同时设置 `MINIO_APPLY_LIFECYCLE=1` 和 `MC_ALIAS`，且本机有 `mc` 时，脚本才会调用 `mc ilm rule add`。缺任一条件则仍然退出码 0，不改桶。

## 怎么验

1. `make migrate` 在普通 PostgreSQL 上能记上 `009_timescale_optional.sql`，`recognition_records` 仍是普通表。
2. `node scripts/object-lifecycle.mjs` 退出码 0，输出含 “未下发”。
3. 趋势、大屏 24 小时、环境 24 小时和病害高发读 `metric_buckets_hour` / `metric_buckets_day`。打开页面的这些接口不扫识别明细。验收测试见 `apps/api/src/growth/growth-trend.spec.ts` 与 `apps/api/src/dashboard/dashboard.buckets.spec.ts`。
