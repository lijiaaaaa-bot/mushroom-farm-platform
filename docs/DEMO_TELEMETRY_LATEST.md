# 环境遥测最新值

先把数据库和前后端跑起来（已经在跑就跳过）。三个终端：

```bash
make up && make migrate
make api
make web
```

API 监听 http://127.0.0.1:41821 。页面是 http://127.0.0.1:43123 。

在仓库根目录发一对样例：

```bash
make demo-telemetry-latest
```

命令先 POST 一条较早的环境读数，再 POST 一条观测时间为当前时刻的读数。两条都是棚区 S01、传感器 `SENSOR-LATEST-01`。较早一条温度 19.2℃、湿度 91%、CO₂ 1100、基质含水率 64%。后一条温度 24.6℃、湿度 85%、CO₂ 760、基质含水率 72%。

终端打印 `id:`。这是后一条 `environment_readings.id`。同一段还打印最新温度 24.6℃。命令会再读：

- `GET /api/v1/ingest/environment-readings/latest?sensorCode=SENSOR-LATEST-01`，只能有这一条，数值必须是 24.6 / 85 / 760 / 72
- `GET /api/v1/ingest/environment-readings?sensorCode=SENSOR-LATEST-01`，第一条是 24.6℃，列表里仍能看到较早的 19.2℃
- `GET /api/v1/ingest/environment-readings/<id>`，详情与后一条一致

最新值仍是 19.2℃，或详情对不上时，命令失败。

浏览器打开 http://127.0.0.1:43123/login ，账号 `admin`，密码 `Admin@123456`。然后打开：

http://127.0.0.1:43123/environment

「最新值」表里这一行是传感器 SENSOR-LATEST-01，温度 24.6℃，湿度 85%，CO₂ 760，基质含水率 72%。点传感器进入：

http://127.0.0.1:43123/environment/`<id>`

详情是同一组数。刷新后仍是这组数。「最近读数」里可以有较早的 19.2℃，它不在「最新值」这一行。

样例文件是 `packages/contracts/fixtures/environment.demo-latest.json`。`body` 是后一条，`older` 是较早一条。脚本把观测时间改成当前时刻和两分钟前，幂等键改成 `demo-telemetry-latest-<毫秒>` 与 `demo-telemetry-older-<毫秒>`。请求头是 `X-Ingest-Token: dev-ingest-token`（或环境变量 `INGEST_TOKEN`）。`environment.golden.json` 不改。

MQTT 备选（Mosquitto 在 1883，API 未设置 `MQTT_ENABLED=false`）：

```bash
node scripts/demo-telemetry-latest.mjs --channel mqtt
```

主题 `mushroom/S01/SENSOR-LATEST-01/environment`。先发较早一条，再发后一条。终端同样打印 `id:` 和最新温度 24.6℃。页面路径相同。
