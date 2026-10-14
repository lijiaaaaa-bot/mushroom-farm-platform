# 值班看板看在线、离线和待确认

先把数据库和前后端跑起来（已经在跑就跳过）。三个终端：

```bash
make up && make migrate
make api
make web
```

API 监听 http://127.0.0.1:41821 。页面是 http://127.0.0.1:43123 。

下面按顺序做。账号 `admin`，密码 `Admin@123456`。

## 1. 放进一台在线、一台离线，再留一条待确认

在仓库根目录：

```bash
make demo-duty-board
```

命令先登记 `CAM-DUTY-ON`。请求体是 `{"code":"CAM-DUTY-ON","name":"值班在线镜头","type":"camera","shedCode":"S01","note":"值班看板在线"}`。这一行已经在时，接口返回「设备编码已存在」，终端打印 `登记 CAM-DUTY-ON: 已有，未改档案`，名称和备注保持原样。还没有时，终端打印 `登记 CAM-DUTY-ON: 新建`。

接着只 POST 一次 `POST /api/v1/ingest/heartbeat`。请求头 `X-Ingest-Token`，默认 `dev-ingest-token`。报文体是棚区 `S01`、设备编号 `CAM-DUTY-ON`、设备类型 `camera`、`online` 为 true、心跳时间为运行命令的时刻。形状来自 `packages/contracts/fixtures/heartbeat.http.json`，但那个文件仍是 `EDGE-SIM-BOX` / `ai_box`，本命令不改文件。不发识别。

然后登记 `CAM-DUTY-OFF`。请求体是 `{"code":"CAM-DUTY-OFF","name":"值班离线镜头","type":"camera","shedCode":"S01","note":"值班看板离线"}`。已存在则不改名称和备注。新建后本来就是离线，终端打印 `离线: 本来就是离线`。若这台已经在线，命令只 `PATCH /api/v1/devices/:id`，把状态改成离线，终端打印 `离线: 已改状态`。这一步不发心跳。

最后保证一条待确认告警：标题「值班看板告警」，棚区 S01，摄像头 `CAM-DUTY-OFF`，说明是「棚区 S01 摄像头 CAM-DUTY-OFF 值班看板待确认」，级别一般。同标题已经是待确认则沿用，终端打印 `告警: 沿用待确认`。还没有则新建，终端打印 `告警: 新建`。

命令再读四份接口，对不上就失败：

- `GET /api/v1/devices?online=online` 的 total 至少为 1，并且含 `CAM-DUTY-ON`
- `GET /api/v1/devices?online=offline` 的 total 至少为 1，并且含 `CAM-DUTY-OFF`
- `GET /api/v1/alerts?status=open` 的 total 至少为 1
- `GET /api/v1/dashboard/overview` 的 `deviceOnline` 等于在线 total，`deviceTotal - deviceOnline` 等于离线 total

`GET /api/v1/alerts/:id` 能打开这条告警，状态是待确认。

终端打印 `在线设备:`、`离线设备:`、`待确认:`，以及五行地址：`值班看板:`、`在线列表:`、`离线列表:`、`告警列表:`、`告警详情:`。

## 2. 在值班看板上对这三个数

浏览器打开 http://127.0.0.1:43123/login ，登录后打开终端里的 `值班看板:` 地址：

http://127.0.0.1:43123/duty-screen

棚卡上方有三格：

- **在线设备**：数字等于终端的 `在线设备:`，也等于总览的 `deviceOnline`
- **离线设备**：数字等于终端的 `离线设备:`
- **待确认**：数字等于终端的 `待确认:`

总览没返回时，在线和离线是「—」。告警列表没返回时，待确认是「—」。不要把失败读成 0。

点 **在线设备**，打开：

http://127.0.0.1:43123/devices?online=online

页上写「在线 N 台」，N 与看板上的在线设备相同。表里有 `CAM-DUTY-ON`，状态是在线。这一页读的是 `GET /api/v1/devices?pageSize=100&online=online`。

点 **离线设备**，打开：

http://127.0.0.1:43123/devices?online=offline

页上写「离线 N 台」，N 与看板上的离线设备相同。表里有 `CAM-DUTY-OFF`，状态是离线。

点 **待确认**，打开：

http://127.0.0.1:43123/alerts?status=open

状态下拉是「待确认」。列表里有标题「值班看板告警」。点这个标题，打开终端里的 `告警详情:`。详情能读到标题、说明、级别（一般）、状态（待确认）、棚区 S01、摄像头 `CAM-DUTY-OFF`。

棚卡仍按摄像头显示在线数和未闭合告警。图例和底部的「未闭合」仍是待确认加已确认，和上面这一格的「待确认」不是同一个数。

默认超过 5 分钟没有新的心跳，`CAM-DUTY-ON` 会再变成离线。要再看在线，把第 1 步再跑一次。

`make demo-register-and-heartbeat` 仍只动 `CAM-REG-02`。`make demo-heartbeat-offline-alert` 仍只动 `CAM-HB-OFF-01`。本命令不改它们。
