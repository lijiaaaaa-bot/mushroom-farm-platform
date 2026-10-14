# 新增一台镜头

先把数据库和前后端跑起来（已经在跑就跳过）。三个终端：

```bash
make up && make migrate
make api
make web
```

API 监听 http://127.0.0.1:41821 。页面是 http://127.0.0.1:43123 。

下面按顺序做。账号 `admin`，密码 `Admin@123456`。

## 1. 新增 CAM-NEW-01

在仓库根目录：

```bash
make demo-camera-create
```

命令登录后 `POST /api/v1/devices`。请求体是 `{"code":"CAM-NEW-01","name":"新增镜头","type":"camera","shedCode":"S01","note":"新增可演示"}`。库里还没有这台时接口返回 201，终端打印 `登记: 新建`。编码已存在时接口返回「设备编码已存在」，终端打印 `登记: 已有，未改档案`，名称、备注、状态和心跳保持原样。

命令再读设备页用的同一份列表：`GET /api/v1/devices?pageSize=100`。这一行必须是摄像头，棚区 S01，镜头码 `CAM-NEW-01`。然后用这一行的 `id` 读 `GET /api/v1/devices/:id`。详情的编号、名称、类型、棚区、状态、备注、最近心跳必须和列表这一行一致。缺字段或对不上时命令失败。不发识别，不发心跳，不改告警，不改阈值规则。

新建时终端还有这几行：

```text
镜头码: CAM-NEW-01
编号: CAM-NEW-01
名称: 新增镜头
类型: 摄像头
棚区: S01
状态: 离线
备注: 新增可演示
最近心跳: —
设备页: http://127.0.0.1:43123/devices
镜头详情: http://127.0.0.1:43123/devices/<id>
```

已有档案时，名称、状态、备注、最近心跳以终端打印为准。镜头码仍是 `CAM-NEW-01`。

## 2. 在设备页和详情页对上这一台

浏览器打开 http://127.0.0.1:43123/login ，登录后打开：

http://127.0.0.1:43123/devices

也可以在「登记摄像头」里再填一台别的编号。编号、棚区、名称必填，备注可空，点「登记」。成功后表单下有「打开详情」，下方列表出现这一行。镜头码和「详情」都进入 `/devices/<id>`。

对 `CAM-NEW-01`，「摄像头 / AI 盒 / 传感器」里找到镜头码 `CAM-NEW-01`。点这一格镜头码，或点同一行「相关」里的「详情」，或打开终端打印的镜头详情。

新建时这一行和详情页是：

| 镜头码 | 编号 | 名称 | 类型 | 棚区 | 状态 | 备注 | 最近心跳 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| CAM-NEW-01 | CAM-NEW-01 | 新增镜头 | 摄像头 | S01 | 离线 | 新增可演示 | — |

镜头码与编号相同。传感器和 AI 盒的镜头码仍是「—」，这一行没有「详情」。

详情页「相关告警」可以是「暂无相关告警」。本命令不新建告警。

## 3. 和已有演示对编号

- `make demo-camera-list` 仍只保证列表里有 `CAM-ALERT-01`，不读详情。
- `make demo-camera-detail` 仍读 `CAM-ALERT-01` 的详情，并留下或沿用「镜头详情告警」。
- `CAM-REG-02` 仍由登记后再发识别、登记后再发心跳使用。本命令不登记、不修改它。
- 环境遥测的传感器仍在 `/environment`，不是这页的镜头码。

`make demo-camera-list`、`make demo-camera-detail`、`make demo-one-alert`、`make demo-threshold-alert`、`make demo-alert-camera-filter`、`make demo-alert-status-filter`、`make demo-alert-title-search`、`make demo-alert-handle-note`、`make demo-alert-snapshot-minio`、`make demo-telemetry-latest`、`make demo-telemetry-threshold-alert`、`make demo-alert-rule-config`、`make demo-register-and-ingest`、`make demo-register-and-heartbeat`、`make demo-ack-one-alert`、`make demo-close-one-alert` 都不改。
