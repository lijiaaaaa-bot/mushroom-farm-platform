# 按起止时间筛选环境读数

先把数据库和前后端跑起来（已经在跑就跳过）。三个终端：

```bash
make up && make migrate
make api
make web
```

API 监听 http://127.0.0.1:41821 。页面是 http://127.0.0.1:43123 。

在仓库根目录执行：

```bash
make demo-env-filter
```

命令用固定幂等键留下棚区 S01、传感器 `SENSOR-ENVF-01` 的三条环境读数。同一幂等键已在时，改这一行的观测时间和读数，不另建一行。这台传感器上不是这三条幂等键的旧行会删掉，避免宽窗口被旧数据撑大。不改 `SENSOR-HIST-01`、`SENSOR-HIST-02`，也不改 `SENSOR-LATEST-01`、`SENSOR-TELEM-01`。

三条的温度各不相同，都低于种子规则「温度过高」的 28℃，也都高于「温度过低」的 12℃。湿度在 80% 到 86%，基质含水率高于 50%，CO₂ 低于 2000，不触发其余种子规则。

1. 幂等键 `demo-env-filter-outside`。温度 15.2℃，湿度 82%，CO₂ 910，基质含水率 66%。观测时间是当前时刻前 3 小时。这是窗外那一条。
2. 幂等键 `demo-env-filter-older`。温度 19.7℃，湿度 86%，CO₂ 820，基质含水率 68%。观测时间是当前时刻前 8 分钟。这是窗内较早的一条。
3. 幂等键 `demo-env-filter-now`。温度 26.4℃，湿度 80%，CO₂ 740，基质含水率 71%。观测时间是当前时刻。这是窗内当前的一条。

`GET /api/v1/ingest/environment-readings` 在 `from`、`to` 都有时，按观测时间比较，含两端。空白不传。开始晚于结束，或不是有效时间，接口返回 400，页面写「时间筛选无效」，不保留上一次的历史表，也不写「暂无环境读数。」或「没有符合条件的环境读数。」。没有落在窗口里的行时写「没有符合条件的环境读数。」。

4. 宽窗口是当前时刻前 4 小时到后 1 分钟。`sensorCode=SENSOR-ENVF-01` 时三条都在，`total` 是 3。15.2℃、19.7℃、26.4℃ 都能看见。
5. 窄窗口是当前时刻前 30 分钟到后 1 分钟。同一传感器只剩 19.7℃ 和 26.4℃，没有 15.2℃。`total` 是 2，小于宽窗口。
6. 开始晚于结束时，同一接口返回 400，正文含「时间筛选无效」。
7. 把窗口放到 2000-01-01 的一分钟里，这台传感器的 `total` 是 0。

终端打印三条的 id、温度和观测时间，以及两个列表地址：宽窗口、窄窗口。两个地址都带 `sensorCode=SENSOR-ENVF-01` 以及 `from`、`to`。

浏览器打开 http://127.0.0.1:43123/login ，账号 `admin`，密码 `Admin@123456`。

## 截图

拍两张，都要登录后的环境读数页。

1. 打开终端打印的「宽窗口列表」。地址带 `sensorCode=SENSOR-ENVF-01` 以及 `from`、`to`。页面有「开始时间」「结束时间」，并写出「时间 … 至 …」和「共 3 条」。历史读数表里同时有 15.2℃、19.7℃、26.4℃，传感器都是 `SENSOR-ENVF-01`。时间列能对上这三条的先后：15.2℃ 最早，26.4℃ 最新。
2. 打开终端打印的「窄窗口列表」。开始时间和结束时间与上一张不同，范围文字也不同。页面写出「共 2 条」。表里有 19.7℃ 和 26.4℃，没有 15.2℃。行数比第 1 张少。

也可以在 `/environment` 自己填传感器 `SENSOR-ENVF-01`，开始和结束选终端打印的窗口，点「查询」。点「清除」后不再按这台传感器和这段时间过滤。开始晚于结束，或时间填不开时，页面写「时间筛选无效」。地址栏直接打开终端打印的地址，效果与点「查询」相同。

样例文件是 `packages/contracts/fixtures/environment.demo-env-filter.json`。`body` 是窗内当前的 26.4℃，`older` 是窗内较早的 19.7℃，`outside` 是窗外的 15.2℃。脚本把观测时间改成当前时刻、八分钟前和三小时前。请求头是 `X-Ingest-Token: dev-ingest-token`（或环境变量 `INGEST_TOKEN`）。`environment.golden.json` 不改。

`make demo-telemetry-history`、`make demo-telemetry-latest`、`make demo-telemetry-threshold-alert` 不改。`make demo-alert-time-range`、`make demo-harvest-filter`、`make demo-alert-rules` 不改。
