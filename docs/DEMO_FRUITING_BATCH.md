# 出菇批次可查可见

先把数据库和前后端跑起来（已经在跑就跳过）。三个终端：

```bash
make up && make migrate
make api
make web
```

API 监听 http://127.0.0.1:41821 。页面是 http://127.0.0.1:43123 。`make api` 可设 `MQTT_ENABLED=false`。

在仓库根目录：

```bash
make demo-fruiting-batch
```

命令用管理员账号。账号 `admin`，密码 `Admin@123456`。

1. 读取 `packages/contracts/fixtures/recognition.demo-fruiting-batch.json`，写入摄像头 `CAM-FB-01`、棚区 `S01` 的三天识别。数量以样例为准：前 5 个上海日蘑菇 11、成熟 2；前 2 个上海日蘑菇 18、成熟 6；当天蘑菇 27、成熟 11。识别时间按运行时刻往前推。幂等键是 `demo-fruiting-batch-CAM-FB-01-<上海日>`。同一天再跑沿用这一行，不另建。样例文件不改。`recognition.demo-one.json` 里的 `CAM-DEMO-01` 不改。
2. 成熟数对蘑菇数低于种子规则「成熟占比一般」的 0.6。病害数量 0，病害等级 0，温度 22.5℃。这三天不因这些规则新开告警。菌盖直径随日期变大。识别入库时写入棚级日桶（`cameraCode` 为空）。对象存储没起来时抓拍可能存不上，日桶仍写入，命令继续。
3. 批次 `FB-DEMO-01` 已在棚区 `S01` 则沿用，不改开始时间。没有则新建，开始时间是上面最早那一天，阶段为出菇。
4. 再记阶段。没有「快速生长」就记 `fast_growth`，没有「成熟」或当前阶段还不是成熟就记 `mature`。已有这三段并且当前阶段已是成熟时不再追加。不从识别结果自动推进阶段。
5. 读 `GET /api/v1/batches?shedCode=S01`。列表里有 `FB-DEMO-01`，当前阶段是成熟。再读 `GET /api/v1/batches/:id/replay`。阶段顺序是出菇、快速生长、成熟。回放曲线至少两天，并且含上面落在批次开始日之后的那几天。蘑菇数、成熟数不少于这次写入的数。棚级日桶是当天各摄像头最新蘑菇数、成熟数之和，同一天若还有别的摄像头，页面上的数会更大。菌盖是数字。

终端打印棚区、批次、阶段记录、回放窗口和每一天的数，以及可打开的地址：

```text
棚区: S01
批次: FB-DEMO-01
当前阶段: 成熟
阶段记录: 出菇（新建或沿用） → 快速生长（新建或沿用） → 成熟（新建或沿用）
回放: <开始日> 至 <结束日>，共 N 天
<日期>: 蘑菇 …，成熟 …，菌盖 …
打开: http://127.0.0.1:43123/batches?batchCode=FB-DEMO-01
```

浏览器打开 http://127.0.0.1:43123/login ，账号 `admin`，密码 `Admin@123456`。再打开终端里的地址。这个地址会打开该批次的回放，不用再点「回放」。

## 1. 列表能看到批次和当前阶段

页上「出菇批次」表里有一行：

| 棚区 | 批次 | 当前阶段 |
| --- | --- | --- |
| S01 | FB-DEMO-01 | 成熟 |

批次编号和「成熟」要能读出来。没有这一行，或当前阶段仍是「出菇」，都算没对上。

截图：`docs/evidence/demo-fruiting-batch/list.png`。

## 2. 阶段能看到三次变化

同一页「全周期回放 FB-DEMO-01」下面有「阶段」。至少三行，依次能读到：

- 出菇
- 快速生长
- 成熟

每行带时间。当前阶段写成「成熟」。

截图：`docs/evidence/demo-fruiting-batch/phases.png`。

## 3. 回放能看到窗口里的数

「阶段」下面有「回放 <开始日> 至 <结束日>，共 N 天」，N 至少是 2。下面是「棚级日桶」表，列是日期、蘑菇、成熟、菌盖。终端打印的每一天都在表里，蘑菇、成熟、菌盖与终端那一行一致，不是「该时间窗内没有棚级日桶。」

截图：`docs/evidence/demo-fruiting-batch/replay.png`。

## 验收

- `make demo-fruiting-batch` 在 API 已启动时退出码 0，并打印棚区、批次、阶段记录、回放窗口和 `/batches?batchCode=FB-DEMO-01`。
- 列表截图能读到 `FB-DEMO-01` 和当前阶段「成熟」。
- 阶段截图能读到出菇、快速生长、成熟。
- 回放截图能读到窗口和至少两天的蘑菇、成熟、菌盖。
- 样例文件 `recognition.demo-one.json` 里的 `CAM-DEMO-01` 不改。

`make demo-harvest-task`、`make demo-harvest-list` 与 `make demo-harvest-filter` 不改。不改接入观测。不估计产量。
