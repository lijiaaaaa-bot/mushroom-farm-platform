# 识别记录按镜头和时间查询

先把数据库和前后端跑起来（已经在跑就跳过）。三个终端：

```bash
make up && make migrate
make api
make web
```

API 监听 http://127.0.0.1:41821 。页面是 http://127.0.0.1:43123 。

在仓库根目录发一组样例：

```bash
make demo-recognition-history
```

命令 POST 四条识别，都在棚区 S01。摄像头 `CAM-HIST-01` 有三条：三小时前总数 7、成熟 2；八分钟前总数 9、成熟 3；当前时刻总数 12、成熟 5。另一台 `CAM-HIST-02` 在四分钟前，总数 11、成熟 4。温度都是 22.5℃，不超过种子规则「温度过高」。接入时会按摄像头编号登记设备。每条带同一张样例 JPEG。

查询窗口是当前时刻前 30 分钟到后 1 分钟。命令再读：

- `GET /api/v1/ingest/recognitions?cameraCode=CAM-HIST-01&from=…&to=…`，按识别时间从新到旧。结果里有总数 12 和总数 9，第一条是总数 12。总数 7 和 `CAM-HIST-02` 不在这个结果里。
- 同一条总数 7 用它自己的识别时间再查一次，读得回来。它只是不在上面那个窗口里。
- `GET /api/v1/ingest/recognitions?cameraCode=CAM-HIST-02&from=…&to=…` 有总数 11，没有 `CAM-HIST-01`。

窗口里缺了总数 9，或把总数 7 算进窗口时，命令失败。`cameraCode` 按摄像头编号精确匹配，首尾空白不传。

浏览器打开 http://127.0.0.1:43123/login ，账号 `admin`，密码 `Admin@123456`。然后打开终端打印的地址，形如：

http://127.0.0.1:43123/recognitions?cameraCode=CAM-HIST-01&from=…&to=…

识别记录里有两张卡：摄像头 CAM-HIST-01，总数 12 和总数 9。没有总数 7，也没有 CAM-HIST-02。

也可以在 `/recognitions` 的「摄像头」填 `CAM-HIST-01`，开始和结束选终端打印的窗口，点「查询」。点「清除」后不再按这台摄像头和这段时间过滤。开始或结束不是有效时间时，页面写「时间筛选无效」，不把空列表当成没有记录。没有符合条件的行时写「没有符合条件的识别记录。」

大屏按上海日打开 `/recognitions` 时，地址栏仍带这一日的 `from`、`to`，以及棚区 `shedCode`。这一页的开始、结束用同一对时间。点「查询」不会丢掉棚区。上海日筛选仍按识别时间比较，不另做按到达日入列。

样例文件是 `packages/contracts/fixtures/recognition.demo-history.json`。`body` 是窗内较新的一条，`older` 是窗内较早的一条，`outside` 是窗外的一条，`other` 是另一台摄像头。脚本把识别时间改成当前时刻、八分钟前、三小时前和四分钟前，幂等键改成带毫秒的 `demo-recognition-history-…`。请求头是 `X-Ingest-Token: dev-ingest-token`（或环境变量 `INGEST_TOKEN`）。`recognition.golden.json` 和 `recognition.demo-one.json` 不改。

`make demo-one-ingest` 仍发 `CAM-DEMO-01`。`make demo-telemetry-history` 仍发环境读数，不发识别。

MQTT 备选（Mosquitto 在 1883，API 未设置 `MQTT_ENABLED=false`）：

```bash
node scripts/demo-recognition-history.mjs --channel mqtt
```

`CAM-HIST-01` 的三条走主题 `mushroom/S01/CAM-HIST-01/recognition`。`CAM-HIST-02` 走 `mushroom/S01/CAM-HIST-02/recognition`。终端同样打印窗口和页面地址。
