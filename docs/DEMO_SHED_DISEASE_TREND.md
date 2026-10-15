# 单棚病害发生趋势可查可见

先把数据库和前后端跑起来（已经在跑就跳过）。三个终端：

```bash
make up && make migrate
make api
make web
```

API 监听 http://127.0.0.1:41821 。页面是 http://127.0.0.1:43123 。

在仓库根目录：

```bash
make demo-shed-disease-trend
```

命令读取 `packages/contracts/fixtures/recognition.demo-growth-trend.json`，写入摄像头 `CAM-SDT-01`、棚区 `S01` 的四天识别。病害数量是这次请求自己的，样例文件不改：

| 上海日 | 病害数量 | 病害等级 |
| --- | --- | --- |
| 前 5 日 | 1 | 1 |
| 前 3 日 | 3 | 1 |
| 前 1 日 | 6 | 1 |
| 当天 | 10 | 1 |

日桶按当天最新病害数量记下 1、3、6、10。旁注是「病害 1 → 3 → 6 → 10（升）」。识别时间按运行时刻往前推，幂等键是 `demo-shed-disease-trend-CAM-SDT-01-<上海日>`。同一天再跑沿用这一行，不另建，样本数不加。样例里的 `CAM-GT-01` 和病害数量 0 不改。`recognition.demo-one.json` 里的 `CAM-DEMO-01` 不改。

病害等级保持 1，低于种子规则「病害等级一般」的 2。病害数量 6 和 10 达到种子规则「病害数量一般」的 5，会留下未闭合告警。命令末尾按摄像头 `CAM-SDT-01` 关闭这些告警，备注「病害趋势演示后关闭」。蘑菇数 40、成熟数 4，成熟占比低于 0.6。温度 22.5℃，湿度 88%，CO₂ 900，基质含水率 70%。菌盖直径逐日增加，不低于生长停滞的 0.05。对象存储没起来时，第一次写入失败。

然后读两份日桶，都带棚区 `S01` 和摄像头 `CAM-SDT-01`：

- `GET /api/v1/diseases/trends?days=7&shedCode=S01&cameraCode=CAM-SDT-01` 的天数是 7。这一台摄像头含上面四天，病害数量是 1、3、6、10。
- `GET /api/v1/diseases/trends?days=30&shedCode=S01&cameraCode=CAM-SDT-01` 同样四天都在，数量不变。
- `GET /api/v1/diseases/trends?days=7&shedCode=S01&cameraCode=CAM-SDT-NONE` 的 `sheds` 是空的。

接口读 `metric_buckets_day` 的 `disease_count`。不传摄像头时是棚汇总（各摄像头当日最新相加）。页面选了摄像头就画这一台，不画棚汇总。

终端打印这三个地址：

```text
打开: http://127.0.0.1:43123/shed-disease-trend?days=7&shedCode=S01&cameraCode=CAM-SDT-01
三十日: http://127.0.0.1:43123/shed-disease-trend?days=30&shedCode=S01&cameraCode=CAM-SDT-01
对照: http://127.0.0.1:43123/shed-disease-trend?days=7&shedCode=S01&cameraCode=CAM-SDT-NONE
```

浏览器打开 http://127.0.0.1:43123/login ，账号 `admin`，密码 `Admin@123456`。侧栏「病害趋势」也进这一页。

## 1. 同一屏读到病害数量

打开终端里的「打开」。页顶能读到：

| 位置 | 值 |
| --- | --- |
| 标题 | 单棚病害发生趋势 |
| 棚区下拉 | 一号菇棚（S01） |
| 文字 | 棚区 S01 · 7 天 · 摄像头 CAM-SDT-01 |
| 按钮 | 「7 天」是当前选中 |
| 旁注 | 病害 1 → 3 → 6 → 10（升） |

页面向下有一条病害数量曲线，后一个点高于前一个点。不要停在「没有病害日趋势，未绘制曲线。」

再往下是表。四行，病害数量列是 1、3、6、10。第二行相对上一日写「升 2」，接着是「升 3」「升 4」。表头是日期、病害数量、相对上一日。没有高发时段，也没有温度、蘑菇数。

## 2. 三十日仍是这组数

打开终端里的「三十日」，或在同一页点「30 天」。文字变成「棚区 S01 · 30 天」。旁注仍是「病害 1 → 3 → 6 → 10（升）」。点「7 天」回到上一节。

## 3. 对照

打开终端里的「对照」。摄像头是 `CAM-SDT-NONE`。页面写「没有病害日趋势，未绘制曲线。」没有 1、3、6、10 那一行。

## 验收

- `make demo-shed-disease-trend` 在 API 已启动时退出码 0，并打印 7 日、30 日、对照三个地址。终端里的旁注是「病害 1 → 3 → 6 → 10（升）」。
- 7 日截图同一屏能读到棚区 S01、摄像头 CAM-SDT-01，旁注含「病害 1 → 3 → 6 → 10（升）」。曲线或表是病害数量。表里相邻日能读出「升」。
- 30 日截图仍是这组数。
- 对照截图没有曲线，文案含「没有病害日趋势」。
- `CAM-SDT-01` 上这次打开的未闭合告警已经关闭。

这一页读病害日桶。`/diseases?grain=` 的高发时段和高发棚区仍走 `GET /api/v1/diseases/peaks`。`/diseases` 列表检索不改。`/diseases/:id` 的同期环境不改。`/shed-growth-delta`、`/shed-env-24h`、`/growth-trends` 不改。`make demo-disease-list`、`make demo-disease-grade-filter`、`make demo-disease-hotspot`、`make demo-disease-env-detail`、`make demo-growth-trend`、`make demo-shed-growth-delta` 不改。不改接入观测。不改样例文件。

本机若没有 Docker，或 API 没在 41821 监听，命令不会对接口实发。Mac 上再跑 `make demo-shed-disease-trend`，并按上面的地址截图。
