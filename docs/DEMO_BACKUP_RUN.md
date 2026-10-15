# 超管在备份页看到最近一次成功时间

先把数据库和前后端跑起来（已经在跑就跳过）。三个终端：

```bash
make up && make migrate
make api
make web
```

没有 Docker、也没有本机 `pg_dump` 时，活的 `make demo-backup-run` 会把这次记成失败并退出码非 0。成功路径和 403 由 `scripts/demo-backup-run.spec.mjs` 在 `make test` 里覆盖。本机要看到新的成功时间，需要 `pg_dump`，或者 `make up` 之后能用 `docker compose exec` 导出。页面本身仍需要上面的 `make up && make migrate` 和 `make api`、`make web`。

API 监听 http://127.0.0.1:41821 。页面是 http://127.0.0.1:43123 。

## 1. 跑一次备份

在仓库根目录：

```bash
make demo-backup-run
```

命令用种子超管 `admin` / `Admin@123456` 登录。

先读 `GET /api/v1/backups/status`。还没有成功记录时，`lastSuccessAt` 是空，`lastStatus` 是 `never`。已经有过成功时，记下这个更早的时间。

然后 `POST /api/v1/backups/run`。接口调用与 `make backup` 相同的 `scripts/backup-postgres.mjs`，把结果写入 `postgres_backup_runs`。再读一次状态：

| 检查 | 结果 |
|------|------|
| 最近一次 | `success` |
| 最近成功时间 | 比跑之前更晚；之前是空则现在有时间 |
| 文件 | `mushroom-<UTC时间>.sql`，只有文件名 |
| 触发人 | `admin` |
| 连接串、密码 | 响应里没有 |

`make backup` 成功或失败时也会写同一张表，触发人是 `make-backup`。这一次演示不调用 `make backup`。

接着用查看 `viewer` / `Viewer@123456` 登录。`GET /api/v1/backups/status` 和 `POST /api/v1/backups/run` 都是 403。不改这个账号的密码。生产管理员、棚区负责人调用同样是 403。

不发识别，不发心跳，不改告警，不改用户。不改接入观测。

终端打印跑之前的最近成功时间（空则写「尚未成功备份」）、跑之后的时间、文件名和备份页地址。

## 2. 在页面上看前后

浏览器打开 http://127.0.0.1:43123/login 。

用 `admin` / `Admin@123456` 登录。侧栏有「数据备份」。打开 http://127.0.0.1:43123/backup 。

跑命令之前，最近成功是「尚未成功备份」或一条更早的时间，最近一次是「尚未运行」、绿色「成功」或红色「失败」。

跑完 `make demo-backup-run` 后刷新这一页。最近成功变成终端里「最近成功（后）」的时间，字是绿色。最近一次是「成功」。文件名与终端一致。触发人是 `admin`。

再点「立即备份」。按钮在请求期间写「备份中…」。完成后这一块被描出，页面写「本次备份成功。最近成功时间是 …。」这个时间比刷新时看到的更晚。

若本机没有 `pg_dump` 和 Docker，点下去会写「本次备份失败。最近成功时间仍是 …。」失败说明里没有数据库口令。已有的成功时间留在「最近成功」。

退出后用 `viewer` / `Viewer@123456` 登录。侧栏没有「数据备份」。打开 http://127.0.0.1:43123/backup 会回到总览。

`make backup`、`make demo-rbac` 以及其他已有演示命令都不改。
