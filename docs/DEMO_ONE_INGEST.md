# 发一条识别

先把数据库和前后端跑起来（已经在跑就跳过）。三个终端：

```bash
make up && make migrate
make api
make web
```

API 监听 http://127.0.0.1:41821 。页面是 http://127.0.0.1:43123 。

在仓库根目录发一条：

```bash
make demo-one-ingest
```

终端打印 `id:`。这是 `recognition_records.id`。同一段还打印 `抓拍对象键:`。命令会再读 `GET /api/v1/ingest/recognitions/<id>/snapshot`，字节必须和样例里的 AI抓拍图 JPEG 一致。对象存储没写入或读不回时，命令失败。

浏览器打开 http://127.0.0.1:43123/login ，账号 `admin`，密码 `Admin@123456`。然后打开：

http://127.0.0.1:43123/recognitions?cameraCode=CAM-DEMO-01

最新一条就是刚才那条：棚区 S01，摄像头 CAM-DEMO-01，成熟 5，总数 12，病害 1。识别时间是运行命令的时刻。

同一条也在 http://127.0.0.1:43123/big-screen 的抓拍墙里（按识别时间从新到旧）。

可选，把 `<id>` 换成终端里的 id：

```bash
psql postgres://mushroom:mushroom@127.0.0.1:5432/mushroom -c "SELECT id, shed_code, camera_code, recognized_at, mushroom_count, mature_count, disease_count FROM recognition_records WHERE id = '<id>';"
```

样例文件是 `packages/contracts/fixtures/recognition.demo-one.json`。字段对应收到的数据：棚区编号 `shedCode`、摄像头编号 `cameraCode`、识别时间 `recognizedAt`、蘑菇数量 `mushroomCount`、成熟数量 `matureCount`、各菌盖直径 `capDiameters`、病害数量 `diseaseCount`、病害等级 `diseaseLevel`、AI抓拍图 `snapshotBase64`、环境温度 `temperature`、环境湿度 `humidity`、CO₂ `co2`、基质含水率 `substrateMoisture`。脚本把识别时间改成当前时刻，幂等键改成 `demo-one-<毫秒>`，只 POST 一次。请求头是 `X-Ingest-Token: dev-ingest-token`（或环境变量 `INGEST_TOKEN`）。

MQTT 备选（Mosquitto 在 1883，API 未设置 `MQTT_ENABLED=false`）：

```bash
node scripts/demo-one-http-recognition.mjs --channel mqtt
```

主题 `mushroom/S01/CAM-DEMO-01/recognition`。终端同样打印 `id:`，页面路径相同。
