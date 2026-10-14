# 生长趋势可查可见

先把数据库和前后端跑起来（已经在跑就跳过）。三个终端：

```bash
make up && make migrate
make api
make web
```

API 监听 http://127.0.0.1:41821 。页面是 http://127.0.0.1:43123 。

在仓库根目录：

```bash
make demo-growth-trend
```

命令读取 `packages/contracts/fixtures/recognition.demo-growth-trend.json`，写入摄像头 `CAM-GT-01`、棚区 `S01` 的三天识别。数量以样例为准：前 5 个上海日蘑菇 8、成熟 2；前 2 个上海日蘑菇 14、成熟 5；当天蘑菇 21、成熟 8。识别时间按运行时刻往前推，幂等键是 `demo-growth-trend-CAM-GT-01-<上海日>`。同一天再跑沿用这一行，不另建，样本数不加。样例文件不改。`recognition.demo-one.json` 里的 `CAM-DEMO-01` 不改。

病害数量 0，病害等级 0，温度 22.5℃，湿度 88%，CO₂ 900，基质含水率 70%。成熟占比低于种子规则「成熟占比一般」的 0.6，所以这三天不因成熟占比新开告警。菌盖直径随日期变大，终端会打印每天的数。对象存储没起来时，第一次写入失败。

然后读三份接口：

- `GET /api/v1/growth-trends?days=7&shedCode=S01&cameraCode=CAM-GT-01` 的天数是 7。`CAM-GT-01` 至少两个点，并且含上面三天。蘑菇数、成熟数、菌盖直径和终端一致，后一天比前一天大。
- `GET /api/v1/growth-trends?days=30&shedCode=S01&cameraCode=CAM-GT-01` 的天数是 30，同样三天都在。
- `GET /api/v1/growth-trends?days=7&shedCode=S01&cameraCode=CAM-GT-NONE` 的 `sheds` 是空的。

终端打印这三行地址：

```text
打开: http://127.0.0.1:43123/growth-trends?days=7&shedCode=S01&cameraCode=CAM-GT-01
三十日: http://127.0.0.1:43123/growth-trends?days=30&shedCode=S01&cameraCode=CAM-GT-01
对照: http://127.0.0.1:43123/growth-trends?days=7&shedCode=S01&cameraCode=CAM-GT-NONE
```

浏览器打开 http://127.0.0.1:43123/login ，账号 `admin`，密码 `Admin@123456`。

## 1. 七日曲线有变化

打开终端里的「打开」。页顶筛选能读到：

| 位置 | 值 |
| --- | --- |
| 棚区下拉 | 一号菇棚（S01） |
| 文字 | 棚区 S01 · 7 天 |
| 摄像头 | CAM-GT-01 |
| 按钮 | 「7 天」是当前选中 |

页面向下有三块：蘑菇数量曲线、成熟数量曲线、菌盖直径均值曲线。曲线至少两个点，后一天高于前一天。不要停在「没有日聚合，未绘制曲线。」

再往下是表。至少三行，对象都是 `CAM-GT-01`。日期、蘑菇数量、成熟数量、菌盖直径均值与终端打印的三行一致。例如终端写 `蘑菇 8，成熟 2` 的那一天，表里就是 8 和 2，不能是空表。

## 2. 三十日仍能看到这三天

打开终端里的「三十日」，或在同一页点「30 天」。文字变成「棚区 S01 · 30 天」。表里仍有终端那三天，蘑菇数和成熟数不变。点「7 天」回到上一节。

点「分摄像头」时，这一台摄像头的点还在。点「棚汇总」看到的是棚级合计；只有 `CAM-GT-01` 这几天有数时，合计与这一台相同。

## 3. 对照

打开终端里的「对照」。摄像头是 `CAM-GT-NONE`。页面写「CAM-GT-NONE 在 … 至 … 没有日聚合，未绘制曲线。」表里没有 `CAM-GT-01`，也没有蘑菇 21 那一行。

和第一节并排时，一份有曲线和三行，一份没有曲线。

## 验收

- `make demo-growth-trend` 在 API 已启动时退出码 0，并打印 7 日、30 日、对照三个地址。
- 7 日截图能读到棚区 S01、7 天、摄像头 CAM-GT-01，曲线或表至少两个点，蘑菇数和成熟数肉眼能看出变化（8→14→21，2→5→8）。
- 30 日截图仍有这三天。
- 对照截图没有曲线，文案含「没有日聚合」。

`make demo-env-filter`、`make demo-harvest-list`、`make demo-harvest-filter`、`make demo-alert-rules`、`make demo-report-xlsx`、`make demo-telemetry-latest`、`make demo-telemetry-history`、`make demo-telemetry-threshold-alert` 与 `make demo-alert-rule-config` 不改。不改产量预测算法。不导出 xlsx。
