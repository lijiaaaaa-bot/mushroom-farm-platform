# 设备列表按在线或离线筛选

先把数据库和前后端跑起来（已经在跑就跳过）。三个终端：

```bash
make up && make migrate
make api
make web
```

API 监听 http://127.0.0.1:41821 。页面是 http://127.0.0.1:43123 。

本机没有 Docker 或 Postgres 时，活命令连不上 API。`make test` 里的 `scripts/demo-device-online-filter.spec.mjs` 仍覆盖登录、登记、心跳、改离线和两份筛选列表。

下面按顺序做。账号 `admin`，密码 `Admin@123456`。

## 1. 放进一台在线、一台离线

在仓库根目录：

```bash
make demo-device-online-filter
```

命令先登记 `CAM-FLST-ON`。请求体是 `{"code":"CAM-FLST-ON","name":"筛选在线镜头","type":"camera","shedCode":"S01","note":"列表筛选在线"}`。这一行已经在时，接口返回「设备编码已存在」，终端打印 `登记 CAM-FLST-ON: 已有，未改档案`，名称和备注保持原样。还没有时，终端打印 `登记 CAM-FLST-ON: 新建`。

接着只 POST 一次 `POST /api/v1/ingest/heartbeat`。请求头 `X-Ingest-Token`，默认 `dev-ingest-token`。报文体是棚区 `S01`、设备编号 `CAM-FLST-ON`、设备类型 `camera`、`online` 为 true、心跳时间为运行命令的时刻。形状来自 `packages/contracts/fixtures/heartbeat.http.json`，但那个文件仍是 `EDGE-SIM-BOX` / `ai_box`，本命令不改文件。不发识别。

然后登记 `CAM-FLST-OFF`。请求体是 `{"code":"CAM-FLST-OFF","name":"筛选离线镜头","type":"camera","shedCode":"S01","note":"列表筛选离线"}`。已存在则不改名称和备注。新建后本来就是离线，终端打印 `离线: 本来就是离线`。若这台已经在线，命令只 `PATCH /api/v1/devices/:id`，请求体是 `{"onlineStatus":"offline"}`，终端打印 `离线: 已改状态`。这一步不发心跳，也不新建告警。

命令再读设备页会请求的两份列表：

- `GET /api/v1/devices?pageSize=100&online=online`：每一行的 `onlineStatus` 都是 `online`，含有 `CAM-FLST-ON`，并且 `lastHeartbeatAt` 有值，不含 `CAM-FLST-OFF`。
- `GET /api/v1/devices?pageSize=100&online=offline`：每一行的 `onlineStatus` 都是 `offline`，含有 `CAM-FLST-OFF`，不含 `CAM-FLST-ON`。

缺一行、状态混在一起，或两份列表出现同一台演示镜头时，命令失败。

终端还有这几行：

```text
在线筛选: CAM-FLST-ON 在线
离线筛选: CAM-FLST-OFF 离线
在线列表不含: CAM-FLST-OFF
离线列表不含: CAM-FLST-ON
在线列表: http://127.0.0.1:43123/devices?online=online
离线列表: http://127.0.0.1:43123/devices?online=offline
```

## 2. 在设备列表上切换筛选

浏览器打开 http://127.0.0.1:43123/login ，登录后打开：

http://127.0.0.1:43123/devices

「摄像头 / AI 盒 / 传感器」表上方有状态下拉，选项是「全部」「在线」「离线」。打开侧栏这一页时是「全部」，地址栏不带 `online`。这时 `CAM-FLST-ON` 和 `CAM-FLST-OFF` 可以出现在同一张表里，状态列分别写「在线」和「离线」。这一页读的是 `GET /api/v1/devices?pageSize=100`。

把状态下拉改成「在线」。地址变成 `/devices?online=online`，列表重新请求 `online=online`。表里有 `CAM-FLST-ON`，状态列写「在线」，没有 `CAM-FLST-OFF`。页上写「在线 N 台」。镜头码仍可点进 `/devices/<id>`。

再把状态下拉改成「离线」。地址变成 `/devices?online=offline`。表里有 `CAM-FLST-OFF`，状态列写「离线」，没有 `CAM-FLST-ON`。页上写「离线 N 台」。

改回「全部」。两台都回到列表，地址不再带 `online`。

没有匹配行时，页面写「没有符合条件的设备。」，不会把上一次的表留在页面上。

地址栏也可以直接打开终端打印的两个地址。状态下拉与地址一致。值班看板的在线、离线仍打开这两个地址。

默认超过 5 分钟没有新的心跳，`CAM-FLST-ON` 会再变成离线。要再看在线筛选里的这一行，把第 1 步再跑一次。手改成离线的 `CAM-FLST-OFF` 会留在离线，直到有新的心跳。

## 3. 截图（Mac，验收要有）

在 Mac 上登录后截两张整页，地址栏要在画面里。两张图的表行必须不一样。

1. 在线：打开 `http://127.0.0.1:43123/devices?online=online`。状态下拉是「在线」。表里有编号 `CAM-FLST-ON`，状态列是「在线」。没有编号 `CAM-FLST-OFF`。
2. 离线：打开 `http://127.0.0.1:43123/devices?online=offline`。状态下拉是「离线」。表里有编号 `CAM-FLST-OFF`，状态列是「离线」。没有编号 `CAM-FLST-ON`。

也可以从 `/devices` 把下拉从「全部」改成「在线」，再改成「离线」，地址栏应变成上面两个地址，然后截这两张。本仓不附截图文件。

## 4. 和已有演示对编号

本命令不改 `make demo-device-online`。`CAM-ON-01` 与 `CAM-OFF-01` 仍只由那条命令留下，那条命令仍打开不带 `online` 的 `/devices`。

- `make demo-device-detail` 仍只动 `CAM-DTL-ON` 与 `CAM-DTL-OFF`，截图仍走详情页。
- `make demo-duty-board` 仍只动 `CAM-DUTY-ON` 与 `CAM-DUTY-OFF`。点在线、离线仍打开 `/devices?online=`。
- `make demo-register-and-heartbeat` 仍只动 `CAM-REG-02`。
- `make demo-heartbeat-offline-alert` 仍只动 `CAM-HB-OFF-01`。
- `make demo-camera-list`、`make demo-camera-detail`、`make demo-camera-create`、`make demo-camera-edit`、`make demo-camera-stop`、`make demo-camera-delete` 都不改。
- `make demo-alert-status-filter`、`make demo-alert-camera-filter`、`make demo-alert-time-range` 都不改。报表、病害、采收也不改。
