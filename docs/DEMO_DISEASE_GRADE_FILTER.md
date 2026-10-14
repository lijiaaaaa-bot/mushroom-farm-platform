# 病害按等级筛选可查可见

先把数据库和前后端跑起来（已经在跑就跳过）。三个终端：

```bash
make up && make migrate
make api
make web
```

API 监听 http://127.0.0.1:41821 。页面是 http://127.0.0.1:43123 。

在仓库根目录：

```bash
make demo-disease-grade-filter
```

命令读取 `packages/contracts/fixtures/recognition.demo-one.json`，写两次，样例文件不改。样例里的 `CAM-DEMO-01`、病害数量 1、病害等级 1 不改。

1. 棚区 S01、摄像头 `CAM-DG-MILD`。病害等级 1（轻度），病害数量 1。识别时间是当前时刻，幂等键是 `demo-disease-grade-mild-<毫秒>`。
2. 棚区 S01、摄像头 `CAM-DG-SEV`。病害等级 3（严重），病害数量 2。识别时间比上一条晚 1 秒，幂等键是 `demo-disease-grade-sev-<毫秒>`。

温度仍是 22.5℃。蘑菇数量 12、成熟数量 5，成熟占比低于种子规则「成熟占比一般」的 0.6。两条的病害数量都低于「病害数量一般」的 5。轻度的病害等级 1 低于「病害等级一般」的 2，所以轻度这一条不因病害等级新开告警。严重的病害等级 3 会碰到「病害等级一般」（阈值 2）和「病害等级严重」（阈值 3）。命令在核对列表之后，关闭 `CAM-DG-MILD` 与 `CAM-DG-SEV` 上因此留下的待确认或已确认告警，备注「病害等级筛选演示后关闭」，再读一次，这两台摄像头上不再有待确认告警。其他摄像头的告警不动。

然后读三份接口，`pageSize=50`：

- `GET /api/v1/diseases?diseaseLevel=1` 里有 `CAM-DG-MILD`。病害等级都是 1。没有 `CAM-DG-SEV`。`total` 大于 0。
- `GET /api/v1/diseases?diseaseLevel=3` 里有 `CAM-DG-SEV`。病害等级都是 3。没有 `CAM-DG-MILD`。`total` 大于 0。
- `GET /api/v1/diseases` 不传病害等级，两台都在。

终端打印这三行地址：

```text
轻度列表: http://127.0.0.1:43123/diseases?diseaseLevel=1
严重列表: http://127.0.0.1:43123/diseases?diseaseLevel=3
全部等级: http://127.0.0.1:43123/diseases
```

浏览器打开 http://127.0.0.1:43123/login ，账号 `admin`，密码 `Admin@123456`。

## 1. 轻度

打开终端里的「轻度列表」。病害等级下拉是「轻度」。表里至少有一行：

| 时间 | 棚区 | 位置 | 病害等级 | 病害数量 |
| --- | --- | --- | --- | --- |
| 上海时间 | S01 | CAM-DG-MILD | 轻度（1） | 1 |

没有 `CAM-DG-SEV`，也没有「严重（3）」。时间以终端打印的时刻为准，页面按上海时间显示到分钟。库里如果还有别的轻度记录（例如 `make demo-disease-list` 留下的 `CAM-DIS-01`），可以同时出现，等级仍是轻度。

没有 `CAM-DG-MILD`，或写成「没有符合条件的病害记录。」，都算没对上。

截图：`docs/evidence/demo-disease-grade-filter/mild.png`。要能读到下拉「轻度」、位置 `CAM-DG-MILD`、病害等级「轻度（1）」。

## 2. 严重

打开终端里的「严重列表」。病害等级下拉是「严重」。表里至少有一行：

| 时间 | 棚区 | 位置 | 病害等级 | 病害数量 |
| --- | --- | --- | --- | --- |
| 上海时间，比轻度晚约 1 秒 | S01 | CAM-DG-SEV | 严重（3） | 2 |

没有 `CAM-DG-MILD`，也没有「轻度（1）」。

截图：`docs/evidence/demo-disease-grade-filter/severe.png`。要能读到下拉「严重」、位置 `CAM-DG-SEV`、病害等级「严重（3）」。

## 3. 对照

把第一节和第二节并排。一份有 `CAM-DG-MILD` 和「轻度（1）」，没有 `CAM-DG-SEV`。另一份有 `CAM-DG-SEV` 和「严重（3）」，没有 `CAM-DG-MILD`。两份都不是空表。

也可以打开终端里的「全部等级」。不选病害等级时，两台都在，等级分别是轻度（1）和严重（3）。

截图：`docs/evidence/demo-disease-grade-filter/contrast.png`。同一张图里能看出两份列表的差别：各自有自己的等级，没有对方那一台。

也可以在 `/diseases` 自己选。病害等级选「轻度」，点「查询」，地址栏是 `diseaseLevel=1`。改成「严重」后再查，地址栏是 `diseaseLevel=3`。点「清除」不再按等级过滤。

## 验收

- `make demo-disease-grade-filter` 在 API 已启动时退出码 0，并打印轻度列表、严重列表、全部等级三个地址。
- 轻度截图里能读到 `CAM-DG-MILD` 和「轻度（1）」，没有 `CAM-DG-SEV`。
- 严重截图里能读到 `CAM-DG-SEV` 和「严重（3）」，没有 `CAM-DG-MILD`。
- 对照截图能看出两份列表不一样，对方等级不在这一份里。

`make demo-disease-list` 不改。那条演示仍写入 `CAM-DIS-01`、病害数量 2、病害等级 1，并且 `diseaseLevel=3` 的对照列表是空的，文案仍是「没有符合条件的病害记录。」。步骤见 [`DEMO_DISEASE_LIST.md`](DEMO_DISEASE_LIST.md)。样例文件不改。不改接入观测。不改协议字段。
