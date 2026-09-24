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

抓拍字节进 MinIO 或云 OSS，PostgreSQL 只存对象键和 URL。热数据按 90 天对齐补传窗口。更早的对象有两条路，都默认不执行：

1. **自建热冷盘**：热 MinIO 用 `docker-compose.yml` 的卷 `minio-hot`（可用 `MINIO_HOT_DATA` 指到 SSD）。冷 MinIO 用可选文件 `docker-compose.minio-cold.yml`（卷 `minio-cold`，端口 9002）。`node scripts/object-tier.mjs` 在未设置 `MINIO_APPLY_TIER=1` 时退出码 0，输出含「未执行」，不连接存储，也不调用 `setBucketLifecycle`。设置该变量且冷热端点与密钥齐全时，把前缀 `snapshots/` 上超过热天数的对象复制到冷桶，读回字节一致后才从热端删除；读回不一致或不可达则退出码非 0，当前对象留在热端。本地单 MinIO 演示不需要冷端。
2. **云归档存储类**：计划文件 `infra/object-lifecycle.json`（`hotDays` 可用 `OBJECT_HOT_DAYS` 覆盖），目标存储类 `GLACIER`。

```bash
node scripts/object-lifecycle.mjs
```

未设置 `MINIO_APPLY_LIFECYCLE=1` 时退出码 0，并说明未下发。不调用 MinIO，也不把未执行写成已经生效。

要真下发云上的生命周期规则，同时设置：

- `MINIO_APPLY_LIFECYCLE=1`
- `MINIO_ENDPOINT`（`主机:端口`，或带 `http://` / `https://`）
- `MINIO_ACCESS_KEY`
- `MINIO_SECRET_KEY`

可选：`MINIO_BUCKET`、`MINIO_USE_SSL=1`、`OBJECT_HOT_DAYS`。脚本用 MinIO 的 `setBucketLifecycle` 写入前缀 `snapshots/` 的过渡规则，再 `getBucketLifecycle` 读回。读回的启用规则带同一前缀才打印「已下发」并退出码 0。端点不可达、密钥缺失、存储类被拒绝或读回不匹配时退出码非 0，并在标准错误写明原因。不得在失败时退出码 0。

本地 compose 的热 MinIO 没有远端存储类。在这份 MinIO 上按上面的条件去下发会失败。热冷复制脚本不会把这次失败改写成已下发。

产品现阶段不必开 Timescale。备份、登录日志、cron 与恢复命令见 [`OPS_STORAGE_BACKUP.md`](OPS_STORAGE_BACKUP.md)。

## 怎么验

1. `make migrate` 在普通 PostgreSQL 上能记上 `009_timescale_optional.sql`，`recognition_records` 仍是普通表。`enable.sql` 仍不进 `make migrate`。
2. `node scripts/object-lifecycle.mjs` 在未设置 `MINIO_APPLY_LIFECYCLE` 时退出码 0，输出含 “未下发”。`MINIO_APPLY_LIFECYCLE=1` 但端点不可达时退出码非 0。
3. `node scripts/object-tier.mjs` 在未设置 `MINIO_APPLY_TIER` 时退出码 0，输出含 “未执行”，且不含 “已下发”。`MINIO_APPLY_TIER=1` 但没有冷端点时退出码非 0。
4. 趋势、大屏 24 小时、环境 24 小时和病害高发读 `metric_buckets_hour` / `metric_buckets_day`。打开页面的这些接口不扫识别明细。验收测试见 `apps/api/src/growth/growth-trend.spec.ts` 与 `apps/api/src/dashboard/dashboard.buckets.spec.ts`。
