# 心跳停了之后，设备变离线并出现告警

先把数据库和前后端跑起来（已经在跑就跳过）。三个终端：

```bash
make up && make migrate
DEVICE_OFFLINE_AFTER_MS=2000 make api
make web
```

API 监听 http://127.0.0.1:41821 。页面是 http://127.0.0.1:43123 。

`DEVICE_OFFLINE_AFTER_MS` 要写在启动 API 的那条命令上。默认是 5 分钟，扫描大约每分钟一次。设成 `2000` 之后，超过 2 秒没有新的心跳就判离线，扫描间隔跟着变成约 1 秒。别的演示若要设备一直保持在线，把 API 停掉，去掉这个变量再 `make api`。

下面按顺序做。账号 `admin`，密码 `Admin@123456`。

## 1. 给 CAM-HB-OFF-01 发一条在线心跳，然后等它超时

在仓库根目录：

```bash
make demo-heartbeat-offline-alert
```

命令先请求 `POST /api/v1/devices`。请求体是 `{"code":"CAM-HB-OFF-01","name":"心跳超时镜头","type":"camera","shedCode":"S01","note":"心跳超时演示"}`。这一行已经在时，接口返回「设备编码已存在」，终端打印 `登记: 已有，未改档案`，名称和备注保持原样。还没有时，命令自己登记，终端打印 `登记: 新建`。

接着只 POST 一次 `POST /api/v1/ingest/heartbeat`。请求头 `X-Ingest-Token`，默认 `dev-ingest-token`。报文体是棚区 `S01`、设备编号 `CAM-HB-OFF-01`、设备类型 `camera`、`online` 为 true、心跳时间为运行命令的时刻。形状来自 `packages/contracts/fixtures/heartbeat.http.json`，但那个文件仍是 `EDGE-SIM-BOX` / `ai_box`，本命令不改文件。不发识别。

心跳响应里这一台是在线。命令再读 `GET /api/v1/devices?type=camera&shedCode=S01`，直到这一行的 `onlineStatus` 变成 `offline`，并且 `lastHeartbeatAt` 仍是刚才那次心跳。同时读 `GET /api/v1/alerts?shedCode=S01&cameraCode=CAM-HB-OFF-01`，要有一条未闭合告警：标题「设备离线」，说明里有「超时未心跳」。再读 `GET /api/v1/alerts/:id`，标题、棚区、摄像头、级别、状态都在。缺这些时命令失败。

API 没有带着 `DEVICE_OFFLINE_AFTER_MS=2000` 启动时，几秒内这一行还是在线，命令失败并写明要怎么重启 API。本命令不会空等默认的 5 分钟。

终端打印 `离线: 离线`、`告警 id:`。还有两行地址：`设备页:`、`告警详情:`。

再跑一次时，新的心跳先把这台改回在线，并自动关闭上一条未闭合的离线告警，然后再次超时，留下一条新的未闭合告警。

## 2. 在设备页看到离线，再打开告警详情

用已登录的浏览器打开终端里的地址。

设备页：

http://127.0.0.1:43123/devices

刷新后，CAM-HB-OFF-01 这一行状态是「离线」。最近心跳是第 1 步命令运行的时刻（页面显示到分钟，时区 Asia/Shanghai）。备注仍是登记时写下的那句。命令自己登记时，备注是「心跳超时演示」。

告警详情：

终端里的 `告警详情:` 地址，形如 http://127.0.0.1:43123/alerts/<id>

标题是「设备离线」。说明里有棚区 S01、设备 CAM-HB-OFF-01 和「超时未心跳」。短超时下级别是「一般」，状态是「待确认」。若有人已经确认过这条，状态是「已确认」，命令同样算通过。

`make demo-register-and-heartbeat` 仍登记 `CAM-REG-02` 并要求当时在线。它不改，也不使用 `CAM-HB-OFF-01`。
