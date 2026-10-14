# 设备列表显示镜头码

先把数据库和前后端跑起来（已经在跑就跳过）。三个终端：

```bash
make up && make migrate
make api
make web
```

API 监听 http://127.0.0.1:41821 。页面是 http://127.0.0.1:43123 。

下面按顺序做。账号 `admin`，密码 `Admin@123456`。

## 1. 保证列表里有 CAM-ALERT-01

在仓库根目录：

```bash
make demo-camera-list
```

命令登录后 `POST /api/v1/devices`。请求体是 `{"code":"CAM-ALERT-01","name":"温度告警镜头","type":"camera","shedCode":"S01","note":"镜头码对照告警"}`。编码已存在时接口返回「设备编码已存在」，终端打印 `登记: 已有，未改档案`，名称、备注、状态和心跳保持原样。库里还没有这台时终端打印 `登记: 新建`。

命令再读设备页用的同一份列表：`GET /api/v1/devices?pageSize=100`。这一行必须是摄像头，棚区 S01，镜头码 `CAM-ALERT-01`。缺这些字段时命令失败。不发识别，不发心跳，不改告警，不改阈值规则。

新建时终端还有这几行：

```text
镜头码: CAM-ALERT-01
编号: CAM-ALERT-01
名称: 温度告警镜头
类型: 摄像头
棚区: S01
状态: 离线
备注: 镜头码对照告警
最近心跳: —
设备页: http://127.0.0.1:43123/devices
告警筛选: http://127.0.0.1:43123/alerts?cameraCode=CAM-ALERT-01
识别记录: http://127.0.0.1:43123/recognitions?cameraCode=CAM-ALERT-01
```

`make demo-one-alert` 若先跑过，这台可能已经由识别自动建档。那时名称可能是 `CAM-ALERT-01`，备注是 `—`，状态可能是在线，最近心跳是识别写入的 `lastSeenAt`。镜头码仍是 `CAM-ALERT-01`。命令不改这份档案。

## 2. 在设备页对上这一行

浏览器打开 http://127.0.0.1:43123/login ，登录后打开：

http://127.0.0.1:43123/devices

「摄像头 / AI 盒 / 传感器」里找到镜头码 `CAM-ALERT-01`。种子里还有 `CAM-S01-01` 等摄像头，不要把别的行当成这一台。

新建时这一行是：

| 镜头码 | 编号 | 名称 | 类型 | 棚区 | 状态 | 备注 | 最近心跳 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| CAM-ALERT-01 | CAM-ALERT-01 | 温度告警镜头 | 摄像头 | S01 | 离线 | 镜头码对照告警 | — |

镜头码与编号相同。传感器和 AI 盒的镜头码是「—」，编号仍是设备编码。

这一行「相关」里有「告警」和「识别」：

- 告警打开 http://127.0.0.1:43123/alerts?cameraCode=CAM-ALERT-01 。这就是告警列表的摄像头筛选。还没跑 `make demo-one-alert` 时，这里可以没有「温度过高告警」。跑过之后，筛选结果里的摄像头是同一个 `CAM-ALERT-01`。
- 识别打开 http://127.0.0.1:43123/recognitions?cameraCode=CAM-ALERT-01 。`make demo-one-alert` 发出的识别用的也是这个镜头码。`make demo-one-ingest` 仍是 `CAM-DEMO-01`，`make demo-register-and-ingest` 仍是 `CAM-REG-02`。

已有档案时，名称、状态、备注、最近心跳以终端打印为准，镜头码不变。

## 3. 和已有演示对编号

镜头码就是告警筛选和识别地址里的 `cameraCode`。

- `CAM-ALERT-01`：`make demo-one-alert`，告警 `/alerts?cameraCode=CAM-ALERT-01`
- `CAM-REG-02`：先跑过 `make demo-register-and-ingest` 或 `make demo-register-and-heartbeat` 时，同一张设备表里还有这一行。识别是 `/recognitions?cameraCode=CAM-REG-02`。心跳演示把它标成在线。本命令不登记、不修改 `CAM-REG-02`。
- 环境遥测的传感器 `SENSOR-LATEST-01`、`SENSOR-TELEM-01`、`SENSOR-RULE-01` 不是镜头码。它们出现在 `/environment` 和遥测告警的传感器字段里。设备表里若有传感器行，镜头码列是「—」。

`make demo-one-alert`、`make demo-threshold-alert`、`make demo-alert-camera-filter`、`make demo-alert-status-filter`、`make demo-alert-title-search`、`make demo-alert-handle-note`、`make demo-alert-snapshot-minio`、`make demo-telemetry-latest`、`make demo-telemetry-threshold-alert`、`make demo-alert-rule-config`、`make demo-register-and-ingest`、`make demo-register-and-heartbeat` 都不改。
