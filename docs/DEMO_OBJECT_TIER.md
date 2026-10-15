# 热冷复制的计划和转移前后

不需要数据库，也不需要前后端。冷端 MinIO 没起来时，这一条仍然能看计划和不连接存储的夹具对照。在仓库根目录：

```bash
make demo-object-tier
```

命令打两段，退出码 0。第一段是计划，第二段是夹具。两段都在同一次终端输出里。

## 1. 计划（未执行）

这一段等价于未设置 `MINIO_APPLY_TIER` 的 `make object-tier`。即使当前 shell 里已经有 `MINIO_APPLY_TIER=1` 或 `OBJECT_HOT_DAYS`，演示也会清掉再跑，所以热天数仍是计划文件里的 90。

| 检查 | 结果 |
|------|------|
| 退出码 | `计划退出码: 0` |
| 执行 | 输出含「未执行」，不含「已执行」，不含「已下发」 |
| 对象键 | `热端对象键: 未列出`，`冷端对象键: 未列出` |
| 前缀 | `snapshots/`，超过 90 天 |
| 连接 | 不连接热端，也不连接冷端。不复制，不删除 |

计划段里没有 `snapshots/tier-old.jpg`。未执行时本来就不列出键。

## 2. 夹具复制（不连接 MinIO）

内存里放三枚对象，热天数按 1 天算，当前时刻固定在 2026-10-15 00:00 UTC。不访问 9000 或 9002。

| 键 | 转移前 | 转移后 |
|----|--------|--------|
| `snapshots/tier-old.jpg` | 只在热端（早于 1 天） | 只在冷端。读回字节与原来一致后，热端没有 |
| `snapshots/tier-new.jpg` | 只在热端（未超龄） | 仍只在热端 |
| `other/tier-leave.jpg` | 只在热端（不在前缀 `snapshots/`） | 仍只在热端 |

终端里要能同时看到这些行：

```text
夹具热端（前）: snapshots/tier-old.jpg
夹具冷端（前）: （无）
热端（前）: snapshots/tier-old.jpg
冷端（后）: snapshots/tier-old.jpg
热端（后）: 无 snapshots/tier-old.jpg
夹具热端（后）: snapshots/tier-new.jpg
夹具热端（后）: other/tier-leave.jpg
夹具冷端（后）: snapshots/tier-old.jpg
夹具热端已无: snapshots/tier-old.jpg
夹具退出码: 0
```

三行 `热端（前）`、`冷端（后）`、`热端（后）` 与实盘 `make object-tier` 在 `MINIO_APPLY_TIER=1` 且读回一致时打印的格式相同。读回不一致时只有 `热端（前）`，没有 `热端（后）: 无`，热端对象留着。

夹具段含「已执行」。计划段不含。这就是未执行和已转移的差别。

截这一整段终端：上半是「未执行 / 未列出」，下半是上面的键。

## 3. Mac 上拍实盘控制台（可选）

云上虚拟机或本机没有冷端时，停在第 2 节。`make demo-object-tier` 不会去连热盘或冷盘，也不会把已经在桶里的抓拍转走。

实盘要热端和冷端都在，而且热桶里已经有早于 `OBJECT_HOT_DAYS`（默认 90）的 `snapshots/` 对象。当天刚上传的对象修改时间是现在，不会被移走。没有这样的超龄对象时，不要为了截图去改生产桶；终端夹具就是前后对照。

有超龄对象时：

```bash
make up
docker compose -f docker-compose.yml -f docker-compose.minio-cold.yml up -d minio minio-cold
```

热控制台 http://127.0.0.1:9001 ，冷控制台 http://127.0.0.1:9003 。账号 `minioadmin` / `minioadmin`。桶 `mushroom-snapshots`。

先截两张：热控制台里该键还在；冷控制台里还没有这个键。

然后在仓库根目录：

```bash
export MINIO_APPLY_TIER=1
export MINIO_ENDPOINT=127.0.0.1:9000
export MINIO_ACCESS_KEY=minioadmin
export MINIO_SECRET_KEY=minioadmin
export MINIO_COLD_ENDPOINT=127.0.0.1:9002
export MINIO_COLD_ACCESS_KEY=minioadmin
export MINIO_COLD_SECRET_KEY=minioadmin
make object-tier
```

再截三处：终端里该键的 `热端（前）`、`冷端（后）`、`热端（后）: 无 …`；冷控制台已经有这个键；热控制台已经没有。退出码非 0 时热端该键还在，不要把失败截成已经转走。

管理端打开抓拍仍只读热端。对象离开热端后页面打不开这张图，本仓不自动从冷端回源。本命令不调用 `setBucketLifecycle`。

不改接入观测。`make object-tier` 在未设置 `MINIO_APPLY_TIER` 时仍只打印计划。
