# 设备列表看见在线和离线

先把数据库和前后端跑起来（已经在跑就跳过）。三个终端：

```bash
make up && make migrate
make api
make web
```

API 监听 http://127.0.0.1:41821 。页面是 http://127.0.0.1:43123 。

本机没有 Docker 或 Postgres 时，活命令连不上 API。`make test` 里的 `scripts/demo-device-online.spec.mjs` 仍覆盖登录、登记、心跳、改离线和设备页同一份列表。

下面按顺序做。账号 `admin`，密码 `Admin@123456`。

## 1. 放进一台在线、一台离线

在仓库根目录：

```bash
make demo-device-online
```

命令先登记 `CAM-ON-01`。请求体是 `{"code":"CAM-ON-01","name":"列表在线镜头","type":"camera","shedCode":"S01","note":"设备列表在线"}`。这一行已经在时，接口返回「设备编码已存在」，终端打印 `登记 CAM-ON-01: 已有，未改档案`，名称和备注保持原样。还没有时，终端打印 `登记 CAM-ON-01: 新建`。

接着只 POST 一次 `POST /api/v1/ingest/heartbeat`。请求头 `X-Ingest-Token`，默认 `dev-ingest-token`。报文体是棚区 `S01`、设备编号 `CAM-ON-01`、设备类型 `camera`、`online` 为 true、心跳时间为运行命令的时刻。形状来自 `packages/contracts/fixtures/heartbeat.http.json`，但那个文件仍是 `EDGE-SIM-BOX` / `ai_box`，本命令不改文件。不发识别。

然后登记 `CAM-OFF-01`。请求体是 `{"code":"CAM-OFF-01","name":"列表离线镜头","type":"camera","shedCode":"S01","note":"设备列表离线"}`。已存在则不改名称和备注。新建后本来就是离线，终端打印 `离线: 本来就是离线`。若这台已经在线，命令只 `PATCH /api/v1/devices/:id`，请求体是 `{"onlineStatus":"offline"}`，终端打印 `离线: 已改状态`。这一步不发心跳，也不新建告警。

命令再读设备页同一份列表：`GET /api/v1/devices?pageSize=100`，不带 `online`。`CAM-ON-01` 的 `onlineStatus` 必须是 `online`，并且 `lastHeartbeatAt` 有值。`CAM-OFF-01` 的 `onlineStatus` 必须是 `offline`。缺一行或状态对不上时命令失败。

终端还有这几行：

```text
在线行: CAM-ON-01 在线
离线行: CAM-OFF-01 离线
在线 onlineStatus: online
离线 onlineStatus: offline
设备页: http://127.0.0.1:43123/devices
```

## 2. 在设备列表上对这两行

浏览器打开 http://127.0.0.1:43123/login ，登录后打开：

http://127.0.0.1:43123/devices

地址栏不要带 `online`。侧栏进入设备页就是这一份列表。

「摄像头 / AI 盒 / 传感器」表的状态列：

- 编号 `CAM-ON-01` 这一行写着「在线」
- 编号 `CAM-OFF-01` 这一行写着「离线」

两行在同一张表里。这一页读的是 `GET /api/v1/devices?pageSize=100`，列表按编号排序，每页 100 条。

默认超过 5 分钟没有新的心跳，`CAM-ON-01` 会再变成离线。要再看在线，把第 1 步再跑一次。手改成离线的 `CAM-OFF-01` 会留在离线，直到有新的心跳。

## 3. 和已有演示对编号

本命令不改值班看板，也不改 `make demo-duty-board`。`CAM-DUTY-ON` 与 `CAM-DUTY-OFF` 仍只由那条命令留下。

- `make demo-register-and-heartbeat` 仍只动 `CAM-REG-02`。
- `make demo-heartbeat-offline-alert` 仍只动 `CAM-HB-OFF-01`，仍按已有超时扫描留下离线告警。本命令不等超时，也不扩大超时。
- `make demo-camera-list`、`make demo-camera-detail`、`make demo-camera-create`、`make demo-camera-edit`、`make demo-camera-stop`、`make demo-camera-delete` 都不改。
- `make demo-user-mgmt`、`make demo-audit-log`、`make demo-rbac` 都不改。
