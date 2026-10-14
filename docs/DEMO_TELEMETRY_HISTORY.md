# 环境遥测历史列表

先把数据库和前后端跑起来（已经在跑就跳过）。三个终端：

```bash
make up && make migrate
make api
make web
```

API 监听 http://127.0.0.1:41821 。页面是 http://127.0.0.1:43123 。

在仓库根目录发一组样例：

```bash
make demo-telemetry-history
```

命令 POST 四条环境读数，都在棚区 S01。传感器 `SENSOR-HIST-01` 有三条：三小时前温度 16.5℃、湿度 84%、CO₂ 900、基质含水率 68%；八分钟前温度 18.4℃、湿度 86%、CO₂ 820、基质含水率 66%；当前时刻温度 23.1℃、湿度 80%、CO₂ 740、基质含水率 71%。另一台 `SENSOR-HIST-02` 在四分钟前，温度 21℃、湿度 82%、CO₂ 880、基质含水率 67%。接入时会按传感器编号登记设备。

查询窗口是当前时刻前 30 分钟到后 1 分钟。命令再读：

- `GET /api/v1/ingest/environment-readings?sensorCode=SENSOR-HIST-01&from=…&to=…`，按观测时间从新到旧。结果里有 23.1℃ 和 18.4℃，第一条是 23.1℃。16.5℃ 和 `SENSOR-HIST-02` 不在这个结果里。
- 同一条 16.5℃ 用它自己的观测时间再查一次，读得回来。它只是不在上面那个窗口里。
- `GET /api/v1/ingest/environment-readings?sensorCode=SENSOR-HIST-02&from=…&to=…` 有 21℃，没有 `SENSOR-HIST-01`。

窗口里缺了 18.4℃，或把 16.5℃ 算进窗口时，命令失败。`deviceCode` 与 `sensorCode` 一样，按传感器编号精确匹配。

浏览器打开 http://127.0.0.1:43123/login ，账号 `admin`，密码 `Admin@123456`。然后打开终端打印的地址，形如：

http://127.0.0.1:43123/environment?sensorCode=SENSOR-HIST-01&from=…&to=…

「历史读数」里有两行：传感器 SENSOR-HIST-01，温度 23.1℃ 和 18.4℃。没有 16.5℃，也没有 SENSOR-HIST-02。点传感器编号进入这一条的 `/environment/<id>`。「最新值」里这一台是 23.1℃，不是两行历史。

也可以在 `/environment` 的「传感器」填 `SENSOR-HIST-01`，开始和结束选终端打印的窗口，点「查询」。点「清除」后不再按这台设备和这段时间过滤。开始或结束不是有效时间时，页面写「时间筛选无效」，不把空表当成没有读数。

小时均值仍是入库时写入的环境小时桶，这一页上方有点时才列出。历史读数是 `environment_readings` 里的一条条读数，查询时不再汇总。

样例文件是 `packages/contracts/fixtures/environment.demo-history.json`。`body` 是窗内较新的一条，`older` 是窗内较早的一条，`outside` 是窗外的一条，`other` 是另一台传感器。脚本把观测时间改成当前时刻、八分钟前、三小时前和四分钟前，幂等键改成带毫秒的 `demo-telemetry-history-…`。请求头是 `X-Ingest-Token: dev-ingest-token`（或环境变量 `INGEST_TOKEN`）。`environment.golden.json` 不改。

`make demo-telemetry-latest` 仍发 `SENSOR-LATEST-01`。`make demo-telemetry-threshold-alert` 仍发 `SENSOR-TELEM-01` 的 32℃。

MQTT 备选（Mosquitto 在 1883，API 未设置 `MQTT_ENABLED=false`）：

```bash
node scripts/demo-telemetry-history.mjs --channel mqtt
```

`SENSOR-HIST-01` 的三条走主题 `mushroom/S01/SENSOR-HIST-01/environment`。`SENSOR-HIST-02` 走 `mushroom/S01/SENSOR-HIST-02/environment`。终端同样打印窗口和页面地址。
