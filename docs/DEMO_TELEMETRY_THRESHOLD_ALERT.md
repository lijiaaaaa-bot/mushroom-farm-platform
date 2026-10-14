# 环境遥测超阈后出现在告警列表

先把数据库和前后端跑起来（已经在跑就跳过）。三个终端：

```bash
make up && make migrate
make api
make web
```

API 监听 http://127.0.0.1:41821 。页面是 http://127.0.0.1:43123 。

在仓库根目录发一条超阈样例：

```bash
make demo-telemetry-threshold-alert
```

命令不改种子规则「温度过高」。先读 `GET /api/v1/alert-rules`，这条规则必须仍是指标温度过高、阈值 28、已启用。阈值不是 28 时命令失败，不会去改它。

样例文件是 `packages/contracts/fixtures/environment.demo-telemetry-threshold.json`。脚本把观测时间改成当前时刻，幂等键改成 `demo-telemetry-threshold-<毫秒>`，只 POST 一次 `POST /api/v1/ingest/environment`。请求头是 `X-Ingest-Token: dev-ingest-token`（或环境变量 `INGEST_TOKEN`）。

这次报文是：

- 棚区 S01
- 传感器 `SENSOR-TELEM-01`
- 温度 32℃（高于种子阈值 28）
- 湿度 88%（不低于 70，也不高于 98）
- CO₂ 900（不高于 2000）
- 基质含水率 70%（不低于 50）

所以只会留下温度过高这一条。`environment.golden.json` 和 `environment.demo-latest.json` 不改。

若这台传感器上还有未闭合告警，命令先 `POST /api/v1/alerts/:id/close`，备注「遥测样例重发前关闭」。不关闭其他传感器，也不关闭摄像头告警。

然后再读待确认列表。要有一条新告警：标题「温度过高告警」，说明是「棚区 S01 传感器 SENSOR-TELEM-01 温度过高 32，阈值 28」，级别严重，状态待确认，当前值 32，阈值 28，传感器是 `SENSOR-TELEM-01`，摄像头为空。`GET /api/v1/alerts/:id` 与列表里的这一条一致。缺这些字段时命令失败。

终端打印 `读数 id:`、`告警 id:`、`当前值: 32`。

浏览器打开 http://127.0.0.1:43123/login ，账号 `admin`，密码 `Admin@123456`。然后打开终端打印的告警列表地址（带 `shedCode=S01` 和 `alertId`）。这一行高亮。标题是「温度过高告警」。标题下面是传感器 `SENSOR-TELEM-01`，再下面的说明里有 32 和阈值 28。状态列是「待确认」。点标题进入：

http://127.0.0.1:43123/alerts/`<id>`

详情里标题是「温度过高告警」，说明同上，级别是严重，状态是待确认，棚区是 S01，摄像头是「—」，传感器是 SENSOR-TELEM-01，指标是温度过高，当前值是 32℃，阈值是 28℃。刷新后仍是这组数。

MQTT 备选（Mosquitto 在 1883，API 未设置 `MQTT_ENABLED=false`）：

```bash
node scripts/demo-telemetry-threshold-alert.mjs --channel mqtt
```

主题 `mushroom/S01/SENSOR-TELEM-01/environment`。终端同样打印告警 id 和详情地址。

`make demo-one-alert` 仍发识别，摄像头 `CAM-ALERT-01`、温度 30。`make demo-threshold-alert` 仍改「演示二氧化碳过高」后再发识别。`make demo-telemetry-latest` 仍发 `SENSOR-LATEST-01` 的 24.6℃，不超过 28。
