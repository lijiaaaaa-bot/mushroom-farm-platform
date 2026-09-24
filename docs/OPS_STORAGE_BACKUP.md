# 部署与运维：存储、备份与登录日志

应用仍把抓拍对象键放在 PostgreSQL。图片字节在对象存储。下面是省钱部署怎么开，以及还不能自动做的批次阶段。

## 自建双盘（推荐）

热数据放 SSD 上的 MinIO，冷数据放 HDD 上的另一份 MinIO。不买云归档，也不把图片写进数据库。

| 角色 | 怎么起 | 端口 | 数据位置 |
|------|--------|------|----------|
| 热 MinIO | `make up`（`docker-compose.yml`） | 9000，控制台 9001 | 命名卷 `minio-hot`。要落在 SSD 上时，启动前设置 `MINIO_HOT_DATA=/mnt/ssd/minio` |
| 冷 MinIO | 在热盘之外再加 overlay | 9002，控制台 9003 | 命名卷 `minio-cold`。HDD 路径用 `MINIO_COLD_DATA=/mnt/hdd/minio` |

冷端：

```bash
docker compose -f docker-compose.yml -f docker-compose.minio-cold.yml up -d minio minio-cold
```

API 的 `MINIO_ENDPOINT` 继续指向热端（默认 `127.0.0.1:9000`）。新抓拍只写热端。

超龄对象从热端挪到冷端用 `scripts/object-tier.mjs`（或 `make object-tier`）：

- 未设置 `MINIO_APPLY_TIER=1`：只打印计划，退出码 0，不连接 MinIO。
- `MINIO_APPLY_TIER=1` 且热端、冷端端点与密钥齐全：列出热桶前缀 `snapshots/`，把早于 `OBJECT_HOT_DAYS`（默认 90，与补传窗口一致）的对象复制到冷桶，读回字节一致后才从热端删除。
- 冷端读回不一致、端点不可达或密钥缺失：退出码非 0。当前这个对象留在热端。已经核对成功的对象会留在冷端。
- 本脚本不调用 `setBucketLifecycle`，也不把结果说成 GLACIER 规则已下发。

```bash
export MINIO_APPLY_TIER=1
export MINIO_ENDPOINT=127.0.0.1:9000
export MINIO_ACCESS_KEY=minioadmin
export MINIO_SECRET_KEY=minioadmin
export MINIO_COLD_ENDPOINT=127.0.0.1:9002
export MINIO_COLD_ACCESS_KEY=minioadmin
export MINIO_COLD_SECRET_KEY=minioadmin
export OBJECT_HOT_DAYS=90
make object-tier
```

可放进 cron，例如每天 03:10。失败时退出码非 0，便于告警。

管理端打开抓拍只读热端。对象转到冷端之后，页面上这张图会打不开。本仓不会自动从冷端回源。需要再看时，由运维把该对象拷回热桶原键。

本地演示可以不启冷端，只跑 `make up` 的一份 MinIO。

另一条路是给热 MinIO 登记远端层，再用生命周期规则过渡（需要本机有 `mc`，且该 MinIO 版本支持 `ilm tier`）。登记成功与否以 `mc ilm rule ls` 为准。未登记远端层时，不要把 `scripts/object-lifecycle.mjs` 的失败当成已经转冷。示例：

```bash
mc alias set hot http://127.0.0.1:9000 minioadmin minioadmin
mc alias set cold http://127.0.0.1:9002 minioadmin minioadmin
mc ilm tier add minio hot COLD --endpoint http://minio-cold:9000 \
  --access-key minioadmin --secret-key minioadmin --bucket mushroom-snapshots
mc ilm rule add hot/mushroom-snapshots --prefix "snapshots/" \
  --transition-days 90 --transition-tier COLD
```

`object-tier.mjs` 是仓内可核对读回的路径。`mc ilm` 是同一双盘思路的另一种下发方式，二选一即可，不要两套同时删热端数据。

## 云归档（备选）

抓拍仍只在库里存对象键和 URL。字节放到阿里云 OSS 或 AWS S3。标准存储放热数据，到期后由云厂商转到归档类。费用在云账单，本仓不调用计费接口。

| 云 | 热 | 冷 | 谁改规则 |
|----|----|----|----------|
| 阿里云 OSS | 标准存储 | 归档或冷归档 | OSS 控制台生命周期：前缀 `snapshots/`，90 天后转换 |
| AWS S3 | Standard | Glacier 或 Deep Archive | 桶生命周期规则，同样按前缀和天数 |

若端点兼容 S3 生命周期，且接受存储类 `GLACIER`，可以用已有脚本真下发：

```bash
export MINIO_APPLY_LIFECYCLE=1
export MINIO_ENDPOINT=对象存储主机:端口
export MINIO_ACCESS_KEY=...
export MINIO_SECRET_KEY=...
export MINIO_BUCKET=mushroom-snapshots
node scripts/object-lifecycle.mjs
```

未设置 `MINIO_APPLY_LIFECYCLE=1` 时退出码 0，只打印计划。设置了但端点拒绝存储类、不可达或读不回同一前缀的启用规则时，退出码非 0。本地 compose 的 MinIO 没有远端存储类，在这份热盘上执行会失败，这是预期。

归档对象取回通常要等解冻。管理端没有解冻接口。打开过期抓拍会失败，直到对象回到热存储或标准存储。

## 登录日志

迁移 `012_login_logs.sql` 随 `make migrate` 建表 `login_logs`。没有单独开关：登录接口每次成功或失败都写一行。

记下的字段：用户名（失败时是尝试的名字；用户存在则同时有用户 id）、结果 `success` / `failure`、时间、IP（`request.ip`）、User-Agent。密码不入库。

读取：`GET /api/v1/login-logs`。仅 `super_admin` 与 `production_admin`。棚区负责人和查看返回 403。

可选查询：`username`（精确）、`from`、`to`（可解析的时间）。分页参数 `page`、`pageSize`。

管理端 `/audit` 上方是登录日志，下方仍是操作审计。操作审计里的 `auth.login` / `auth.login_failed` 还在，登录日志是按结果检索的那张表。

反向代理后面若要客户端 IP，需要在 API 进程启用 Express `trust proxy`。当前没有改这个默认值，IP 是 API 看到的对端地址。

## 备份

`make backup` 运行 `scripts/backup-postgres.mjs`，用 `pg_dump` 写出纯文本 SQL。文件在 `backups/mushroom-<UTC时间>.sql`（可用 `BACKUP_DIR` 改目录）。该目录已在 `.gitignore`。

- 本机有 `pg_dump` 时优先用它，连接串是 `DATABASE_URL`。
- 没有 `pg_dump` 时用 `docker compose exec` 在 Postgres 容器里导出。强制容器导出：`BACKUP_VIA=docker make backup`。
- 找不到工具、命令失败或文件为空：退出码非 0，不把空文件当成备份完成。
- 日志不打印数据库口令。

Redis 是幂等缓存，重启即丢，不在这份文件里。重复报文仍靠数据库唯一约束。

MinIO 是独立数据卷（热卷，以及可选冷卷）。`pg_dump` 只有对象键。只恢复数据库、不保留磁盘时，旧抓拍键会指向已经不在的文件。要留住图片，热盘和已转出的冷盘一起保留。

Cron 示例（每天 02:15，保留约 14 天，按现场磁盘再改）：

```bash
15 2 * * * cd /opt/mushroom-farm-platform && make backup >> /var/log/mushroom-backup.log 2>&1
20 2 * * * find /opt/mushroom-farm-platform/backups -name 'mushroom-*.sql' -mtime +14 -delete
```

恢复（会覆盖现有库，先停 API，并确认文件非空）：

```bash
# 容器内导出的文件用 psql 灌回。下面会删掉并重建 mushroom 库。
docker compose exec -T postgres psql -U mushroom -d postgres -v ON_ERROR_STOP=1 \
  -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'mushroom' AND pid <> pg_backend_pid();" \
  -c "DROP DATABASE IF EXISTS mushroom;" \
  -c "CREATE DATABASE mushroom OWNER mushroom;"
docker compose exec -T postgres psql -U mushroom -d mushroom -v ON_ERROR_STOP=1 \
  < backups/mushroom-20260924T091455Z.sql
```

本机 `pg_dump` 写出的文件同样用 `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f 该文件` 灌回空库。不要在业务还在写入时覆盖。

## 批次自动切阶段

出菇批次的阶段接口保持人工调用：`POST /api/v1/batches/:id/phases`，阶段只有 `flush`（出菇）、`fast_growth`（快速生长）、`mature`（成熟）。

原始需求要求自动记录这些阶段，但没有给出从哪一阶段进入下一阶段的条件。本仓不发明阈值，也不做定时改阶段。

待业主确认规则后可做。可选口径（先定一条，再写进代码；数字由业主给）：

1. 成熟率：棚级日桶的成熟数 / 蘑菇数跨过给定比例后记下一阶段。
2. 连续天数：上述比例连续若干天成立才记。
3. 菌盖直径：棚级日桶平均菌盖直径跨过给定毫米数。
4. 日历：批次开始后第若干天记快速生长，再第若干天记成熟，不看识别。
5. 只提示：算出建议阶段，仍由人调用现有接口，不自动改 `flush_batches.phase`。

在业主选定口径之前，阶段以人在 `/batches` 记下的事件为准。

## Timescale

产品现阶段不必开 Timescale。默认仍是普通 PostgreSQL；可选镜像和 `infra/timescale/enable.sql` 不进入 `make migrate`。
