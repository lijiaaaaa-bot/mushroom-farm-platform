# 设备详情看见在线和最近心跳

先把数据库和前后端跑起来（已经在跑就跳过）。三个终端：

```bash
make up && make migrate
make api
make web
```

API 监听 http://127.0.0.1:41821 。页面是 http://127.0.0.1:43123 。

本机没有 Docker 或 Postgres 时，活命令连不上 API。`make test` 里的 `scripts/demo-device-detail.spec.mjs` 仍覆盖登录、登记、心跳、改离线和 `GET /devices/:id`。

下面按顺序做。账号 `admin`，密码 `Admin@123456`。

截图打开的是镜头详情 `/devices/<id>`，不是设备列表，也不带 `online` 筛选。

## 1. 留下一台在线、一台离线

在仓库根目录：

```bash
make demo-device-detail
```

命令先登记 `CAM-DTL-ON`。请求体是 `{"code":"CAM-DTL-ON","name":"详情在线镜头","type":"camera","shedCode":"S01","note":"设备详情在线"}`。这一行已经在时，接口返回「设备编码已存在」，终端打印 `登记 CAM-DTL-ON: 已有，未改档案`，名称和备注保持原样。还没有时，终端打印 `登记 CAM-DTL-ON: 新建`。

接着只 POST 一次 `POST /api/v1/ingest/heartbeat`。请求头 `X-Ingest-Token`，默认 `dev-ingest-token`。报文体是棚区 `S01`、设备编号 `CAM-DTL-ON`、设备类型 `camera`、`online` 为 true、心跳时间为运行命令的时刻。形状来自 `packages/contracts/fixtures/heartbeat.http.json`，但那个文件仍是 `EDGE-SIM-BOX` / `ai_box`，本命令不改文件。不发识别。

然后读这一台的 `GET /api/v1/devices/:id`。`onlineStatus` 必须是 `online`，并且 `lastHeartbeatAt` 有值，和这次心跳时间一致（重复心跳时不早于这次）。对不上时命令失败。

然后登记 `CAM-DTL-OFF`。请求体是 `{"code":"CAM-DTL-OFF","name":"详情离线镜头","type":"camera","shedCode":"S01","note":"设备详情离线"}`。已存在则不改名称和备注。新建后本来就是离线，最近心跳为空，终端打印 `离线: 本来就是离线`。若这台已经在线，命令只 `PATCH /api/v1/devices/:id`，请求体是 `{"onlineStatus":"offline"}`，终端打印 `离线: 已改状态`。这一步不发心跳，也不新建告警。手改状态不会清掉已有的最近心跳。

再读 `CAM-DTL-OFF` 的 `GET /api/v1/devices/:id`。`onlineStatus` 必须是 `offline`。`lastHeartbeatAt` 和 `lastSeenAt` 都空时，页面「最近心跳」是「—」。已经有过心跳时，状态仍是离线，最近心跳留着上次时间。

终端还有这几行（id 以命令打印为准）：

```text
在线编号: CAM-DTL-ON
在线状态: 在线
在线最近心跳: <这次心跳的时间>
离线编号: CAM-DTL-OFF
离线状态: 离线
离线最近心跳: —
在线详情: http://127.0.0.1:43123/devices/<CAM-DTL-ON 的 id>
离线详情: http://127.0.0.1:43123/devices/<CAM-DTL-OFF 的 id>
```

离线行若留着上次心跳，`离线最近心跳:` 是那个时间，下一行是 `离线心跳: 状态已是离线，最近心跳留着上次时间`。新建时下一行是 `离线心跳: 无心跳，页面写「—」`。

## 2. 打开两台的详情页

浏览器打开 http://127.0.0.1:43123/login ，登录后直接打开终端打印的两个地址。不要只停在 `/devices`。

在线详情 `CAM-DTL-ON`：

| 镜头码 | 编号 | 名称 | 类型 | 棚区 | 状态 | 备注 | 最近心跳 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| CAM-DTL-ON | CAM-DTL-ON | 详情在线镜头 | 摄像头 | S01 | 在线 | 设备详情在线 | 命令运行的时刻 |

「状态」是「在线」。「最近心跳」是第 1 步命令运行的时刻，页面显示到分钟，时区 Asia/Shanghai，不是「—」。已有档案时，名称和备注以终端打印为准。

离线详情 `CAM-DTL-OFF`：

| 镜头码 | 编号 | 名称 | 类型 | 棚区 | 状态 | 备注 | 最近心跳 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| CAM-DTL-OFF | CAM-DTL-OFF | 详情离线镜头 | 摄像头 | S01 | 离线 | 设备详情离线 | — |

「状态」是「离线」。新建或从未心跳时，「最近心跳」是「—」。若终端写着上次时间，这一格是那个时间，状态仍是「离线」。

两页都读 `GET /api/v1/devices/:id`。相关告警可以是「暂无相关告警」，本命令不新建告警。

默认超过 5 分钟没有新的心跳，`CAM-DTL-ON` 会再变成离线。要再看在线，把第 1 步再跑一次。手改成离线的 `CAM-DTL-OFF` 会留在离线，直到有新的心跳。

## 3. 和已有演示对编号

- `make demo-camera-detail` 仍只保证 `CAM-ALERT-01`，不发心跳。那一页经常是离线、「最近心跳」为「—」。
- `make demo-device-online` 仍只动 `CAM-ON-01` 与 `CAM-OFF-01`，截图仍是列表 `/devices`。
- `make demo-register-and-heartbeat` 仍只动 `CAM-REG-02`。
- `CAM-DUTY-ON`、`CAM-DUTY-OFF`、`CAM-HB-OFF-01` 不在本命令里登记或修改。

`make demo-device-online`、`make demo-camera-list`、`make demo-camera-detail`、`make demo-camera-create`、`make demo-camera-edit`、`make demo-camera-stop`、`make demo-camera-delete`、`make demo-register-and-heartbeat`、`make demo-heartbeat-offline-alert`、`make demo-duty-board` 都不改。
