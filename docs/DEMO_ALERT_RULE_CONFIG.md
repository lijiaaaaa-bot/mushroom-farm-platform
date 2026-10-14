# 改环境温度阈值后，遥测按新阈值出现或不再出现告警

先把数据库和前后端跑起来（已经在跑就跳过）。三个终端：

```bash
make up && make migrate
make api
make web
```

API 监听 http://127.0.0.1:41821 。页面是 http://127.0.0.1:43123 。

在仓库根目录执行：

```bash
make demo-alert-rule-config
```

命令用管理员账号调用已有的阈值规则接口。账号 `admin`，密码 `Admin@123456`。不改种子规则「温度过高」（指标温度过高、阈值 28、已启用、不限定棚区）。

1. 读取 `GET /api/v1/alert-rules`。种子规则必须仍是阈值 28。没有名为「演示环境温度过高」的规则时，`POST /api/v1/alert-rules` 新建一条：指标温度过高，阈值 30，级别一般，棚区 S03，窗口 720 分钟，启用。
2. `PATCH /api/v1/alert-rules/:id`，把这条规则的阈值写成 30，并保持启用、级别一般。
3. 若棚区 S03、传感器 `SENSOR-RULE-01` 上还有未闭合告警，先 `POST /api/v1/alerts/:id/close`，备注「改环境阈值前关闭」。不关闭其他传感器，也不关闭 S01 上的告警。
4. POST 一次 `POST /api/v1/ingest/environment`。请求头是 `X-Ingest-Token: dev-ingest-token`（或环境变量 `INGEST_TOKEN`）。报文是棚区 S03、传感器 `SENSOR-RULE-01`、温度 26℃、湿度 88%、CO₂ 900、基质含水率 70%，观测时间是当前时刻，幂等键是 `demo-alert-rule-<毫秒>-quiet`。26 不高于 30，也不高于种子阈值 28，湿度、CO₂、基质含水率也不碰到其余种子规则。待确认和已确认列表里，这台传感器没有告警。
5. 再 `PATCH` 一次，阈值写成 24，并保持启用。然后再读规则列表，确认这条是 24、启用、棚区 S03，且种子规则仍是 28。
6. 再 POST 一次同样的温度 26℃，幂等键是 `demo-alert-rule-<毫秒>-fire`。待确认列表出现「温度过高告警」。说明是「棚区 S03 传感器 SENSOR-RULE-01 温度过高 26，阈值 24」。级别一般，状态待确认，当前值 26，阈值 24，传感器是 `SENSOR-RULE-01`，摄像头为空。
7. 把阈值改回 30。先关闭这台传感器上的未闭合告警（备注仍是「改环境阈值前关闭」），再 POST 一次温度 26℃，幂等键是 `demo-alert-rule-<毫秒>-raised`。列表里不再有这台传感器的未闭合告警。
8. 把阈值写回 24 并保持启用，再 POST 一次温度 26℃，幂等键是 `demo-alert-rule-<毫秒>-again`。留下第 6 步那种待确认告警，供列表和详情查看。`GET /api/v1/alerts/:id` 与待确认列表里的这一条一致。缺这些字段时命令失败。

26 高于 24，所以改低之后会告警。26 不高于 30，所以阈值停在 30 或改回 30 时不告警。26 不高于种子规则的 28，所以不会另建一条严重的温度过高告警。规则限定棚区 S03，S01 上的 `SENSOR-TELEM-01`（32℃）和 `SENSOR-LATEST-01`（24.6℃）对不上这条规则。

终端打印 `阈值 30 时未告警: 是`、`阈值: 30 → 24`、`把阈值改回 30 后未告警: 是`、`最终阈值: 24`、`当前值: 26` 和 `告警 id:`。

浏览器打开 http://127.0.0.1:43123/login ，账号 `admin`，密码 `Admin@123456`。

打开 http://127.0.0.1:43123/alert-rules 。表里有一行名称「演示环境温度过高」，指标是温度过高，阈值输入框是 24，等级是一般，启用是「是」，棚区是 S03。种子行「温度过高」仍是 28。页面上也可以改这一行的阈值；这条命令走的是同一组 `POST` / `PATCH`。

再打开终端打印的告警列表地址（带 `shedCode=S03` 和 `alertId`）。这一行高亮。标题是「温度过高告警」。标题下面是传感器 `SENSOR-RULE-01`，再下面的说明里有 26 和阈值 24。级别列是「一般」，状态列是「待确认」。点标题进入：

http://127.0.0.1:43123/alerts/`<id>`

详情里标题是「温度过高告警」，说明同上，级别是一般，状态是待确认，棚区是 S03，摄像头是「—」，传感器是 SENSOR-RULE-01，指标是温度过高，当前值是 26℃，阈值是 24℃。刷新后仍是这组数。

`make demo-one-alert` 仍发识别，摄像头 `CAM-ALERT-01`、温度 30。`make demo-threshold-alert` 仍改「演示二氧化碳过高」后再发识别。`make demo-telemetry-latest` 仍发 `SENSOR-LATEST-01` 的 24.6℃。`make demo-telemetry-threshold-alert` 仍不改种子规则，并 POST `SENSOR-TELEM-01` 的 32℃。`make demo-alert-snapshot-minio`、`make demo-ack-one-alert`、`make demo-close-one-alert` 不改。
