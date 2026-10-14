# 镜头详情

先把数据库和前后端跑起来（已经在跑就跳过）。三个终端：

```bash
make up && make migrate
make api
make web
```

API 监听 http://127.0.0.1:41821 。页面是 http://127.0.0.1:43123 。

下面按顺序做。账号 `admin`，密码 `Admin@123456`。

## 1. 准备 CAM-ALERT-01 和一条相关告警

在仓库根目录：

```bash
make demo-camera-detail
```

命令登录后 `POST /api/v1/devices`。请求体与 `make demo-camera-list` 相同：`{"code":"CAM-ALERT-01","name":"温度告警镜头","type":"camera","shedCode":"S01","note":"镜头码对照告警"}`。编码已存在时接口返回「设备编码已存在」，终端打印 `登记: 已有，未改档案`。库里还没有这台时终端打印 `登记: 新建`。

命令再读设备页同一份 `GET /api/v1/devices?pageSize=100`，用这一行的 `id` 读 `GET /api/v1/devices/:id`。详情的编号、名称、类型、棚区、状态、备注、最近心跳必须和列表这一行一致。对不上时命令失败。不改档案，不发识别，不发心跳。

然后读详情页同一份相关告警：`GET /api/v1/alerts?cameraCode=CAM-ALERT-01&pageSize=100`。这一页里已有标题「镜头详情告警」、棚区 S01 的告警时沿用，终端打印 `告警: 已有，未改`。没有时 `POST /api/v1/alerts`，级别一般，说明「棚区 S01 摄像头 CAM-ALERT-01 镜头详情」，状态待确认，终端打印 `告警: 新建`。筛选结果里的每一条摄像头都必须是 `CAM-ALERT-01`，并且含有这条告警。再读一次 `GET /api/v1/alerts/:id`。

新建摄像头、新建告警时终端还有这几行：

```text
镜头码: CAM-ALERT-01
编号: CAM-ALERT-01
名称: 温度告警镜头
类型: 摄像头
棚区: S01
状态: 离线
备注: 镜头码对照告警
最近心跳: —
相关告警: 镜头详情告警
告警级别: 一般
告警状态: 待确认
告警说明: 棚区 S01 摄像头 CAM-ALERT-01 镜头详情
设备页: http://127.0.0.1:43123/devices
镜头详情: http://127.0.0.1:43123/devices/<id>
告警详情: http://127.0.0.1:43123/alerts/<id>
```

`make demo-one-alert` 若先跑过，这台摄像头的名称、备注、状态、心跳以终端打印为准。镜头码仍是 `CAM-ALERT-01`。温度过高告警可以同时出现在相关告警里，本命令不确认、不关闭它。

## 2. 从设备列表点进详情

浏览器打开 http://127.0.0.1:43123/login ，登录后打开：

http://127.0.0.1:43123/devices

「摄像头 / AI 盒 / 传感器」里找到镜头码 `CAM-ALERT-01`。点这一格镜头码，或点同一行「相关」里的「详情」。地址是终端打印的镜头详情。

详情页是：

| 镜头码 | 编号 | 名称 | 类型 | 棚区 | 状态 | 备注 | 最近心跳 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| CAM-ALERT-01 | CAM-ALERT-01 | 温度告警镜头 | 摄像头 | S01 | 离线 | 镜头码对照告警 | — |

已有档案时，名称、状态、备注、最近心跳以终端打印为准。

同一页「相关告警」里有「镜头详情告警」，级别一般，状态与终端一致。点标题进入终端打印的告警详情。没有这条、或把别的摄像头的告警放在这里，都算没对上。

传感器和 AI 盒的镜头码仍是「—」，这一行没有「详情」。

## 3. 和已有演示对编号

- `make demo-camera-list` 仍只保证列表里有 `CAM-ALERT-01`，不读详情，不新建告警。
- `make demo-one-alert` 仍是温度过高告警，标题不是「镜头详情告警」。
- `CAM-REG-02`、`CAM-FILTER-01`、`CAM-FILTER-02` 不在本命令里登记或修改。
- 环境遥测的传感器仍在 `/environment`，不是这页的镜头码。

`make demo-camera-list`、`make demo-one-alert`、`make demo-threshold-alert`、`make demo-alert-camera-filter`、`make demo-alert-status-filter`、`make demo-alert-title-search`、`make demo-alert-handle-note`、`make demo-alert-snapshot-minio`、`make demo-telemetry-latest`、`make demo-telemetry-threshold-alert`、`make demo-alert-rule-config`、`make demo-register-and-ingest`、`make demo-register-and-heartbeat`、`make demo-ack-one-alert`、`make demo-close-one-alert` 都不改。
