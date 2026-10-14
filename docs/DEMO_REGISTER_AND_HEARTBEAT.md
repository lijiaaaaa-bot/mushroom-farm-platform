# 登记 CAM-REG-02 再发一条心跳

先把数据库和前后端跑起来（已经在跑就跳过）。三个终端：

```bash
make up && make migrate
make api
make web
```

API 监听 http://127.0.0.1:41821 。页面是 http://127.0.0.1:43123 。

下面按顺序做。账号 `admin`，密码 `Admin@123456`。

## 1. 登记这台摄像头，先看到离线

浏览器打开 http://127.0.0.1:43123/login ，登录后打开：

http://127.0.0.1:43123/devices

「登记摄像头」填这四项，然后点「登记」：

- 编号 `CAM-REG-02`
- 棚区 `S01`
- 名称 `西侧过道`
- 备注 `演示登记`

下方「摄像头 / AI 盒 / 传感器」出现这一行：编号 CAM-REG-02，名称西侧过道，类型摄像头，棚区 S01，状态离线，备注演示登记。最近心跳可以是「—」。

这一步就是设备页已有的 `POST /api/v1/devices`。请求体是 `{"code":"CAM-REG-02","name":"西侧过道","type":"camera","shedCode":"S01","note":"演示登记"}`。

若这一行已经在，并且状态已经是在线，先看最近心跳是不是这次命令写下的。识别上报可以在没有心跳时把状态标成在线，值班棚详情的最近心跳仍是「—」。

## 2. 给 CAM-REG-02 发一条心跳

在仓库根目录：

```bash
make demo-register-and-heartbeat
```

命令会再请求一次 `POST /api/v1/devices`，字段与第 1 步相同。第 1 步已经登记过时，接口返回「设备编码已存在」，终端打印 `登记: 已有，未改档案`，名称和备注保持页面上的内容。跳过第 1 步时，命令用这四项自己登记，终端打印 `登记: 新建`。

接着命令只 POST 一次 `POST /api/v1/ingest/heartbeat`。请求头 `X-Ingest-Token`，默认 `dev-ingest-token`。报文体是棚区 `S01`、设备编号 `CAM-REG-02`、设备类型 `camera`、`online` 为 true、心跳时间为运行命令的时刻。形状来自 `packages/contracts/fixtures/heartbeat.http.json`，但那个文件仍是 `EDGE-SIM-BOX` / `ai_box`，本命令不改文件。

命令再读 `GET /api/v1/devices?type=camera&shedCode=S01`。这一行的 `onlineStatus` 必须是 `online`，并且 `lastHeartbeatAt` 有值，否则命令失败。不发识别。

终端打印 `在线: 在线` 和 `最近心跳:`。还有三行地址：`设备页:`、`值班看板:`、`值班棚:`。

## 3. 在设备页和值班看板看到在线

用已登录的浏览器打开终端里的地址。

设备页：

http://127.0.0.1:43123/devices

刷新后，CAM-REG-02 这一行状态是「在线」。最近心跳是第 2 步命令运行的时刻（页面显示到分钟，时区 Asia/Shanghai）。备注仍是第 1 步写下的那句。命令自己登记时，备注是「演示登记」。

值班棚详情：

http://127.0.0.1:43123/duty-screen/S01

摄像头表里有编码 CAM-REG-02，状态「在线」，最近心跳不是「—」。这一页和设备页读的是同一份 `GET /api/v1/devices?type=camera&shedCode=S01`。

值班看板：

http://127.0.0.1:43123/duty-screen

S01 的棚卡把这台计入「在线摄像头」。棚卡上不写摄像头编码，编码在棚详情里。

默认超过 5 分钟没有新的心跳，这台会再变成离线。要再看在线，把第 2 步再跑一次。
