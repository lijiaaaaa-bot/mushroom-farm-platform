# 删除一台镜头

先把数据库和前后端跑起来（已经在跑就跳过）。三个终端：

```bash
make up && make migrate
make api
make web
```

API 监听 http://127.0.0.1:41821 。页面是 http://127.0.0.1:43123 。

下面按顺序做。账号 `admin`，密码 `Admin@123456`。前面可以先跑 `make demo-camera-create`、`make demo-camera-edit` 和 `make demo-camera-stop`，那三台镜头不是这一条。

## 1. 登记 CAM-DEL-01，改一句备注，再删除

在仓库根目录：

```bash
make demo-camera-delete
```

命令登录后 `POST /api/v1/devices`。请求体是 `{"code":"CAM-DEL-01","name":"可删除镜头","type":"camera","shedCode":"S01","note":"删除前"}`。库里还没有这台时接口返回 201，终端打印 `登记: 新建`。编码已存在时接口返回「设备编码已存在」，终端打印 `登记: 已有，未改名称和心跳`，名称、棚区、在线状态和最近心跳保持原样。

命令再读设备页用的同一份列表：`GET /api/v1/devices?pageSize=100`。这一行必须是摄像头，棚区 S01，镜头码 `CAM-DEL-01`。然后 `PATCH /api/v1/devices/:id`，请求体只有 `{"note":"删除前已改"}`。保存后再读同一份列表，备注必须是「删除前已改」。名称、棚区、在线状态、启用和最近心跳与改前一致。然后 `DELETE /api/v1/devices/:id`。再读同一份列表，镜头码 `CAM-DEL-01` 不在里面。别的设备还在。再用这一行原来的 `id` 读 `GET /api/v1/devices/:id`，返回 404，说明是「设备不存在」。缺字段、列表还留着这一台、或详情不是 404 时命令失败。不发识别，不发心跳，不改告警，不改阈值规则。

新建时终端还有这几行：

```text
登记: 新建
列表: CAM-DEL-01
改后备注: 删除前已改
在线状态: 离线
最近心跳: —
删除: CAM-DEL-01
列表: 已无这一台
详情: 不存在
设备页: http://127.0.0.1:43123/devices
```

已有档案时，改前的名称、在线状态、启用和最近心跳以列表为准。改后备注是「删除前已改」，其余与改前相同。删除后列表没有这一台，详情是 404。再跑一次会重新登记，因为编码已经空出来。

删除去掉的是设备表里的这一行，没有另留停用标记。告警和识别仍按镜头码留着，这条命令不新建、不修改它们。之后若再上报心跳或识别，现有接入会按编码重新建档。这条命令不验证重新建档。

## 2. 在设备页和详情页对上删除

浏览器打开 http://127.0.0.1:43123/login ，登录后打开：

http://127.0.0.1:43123/devices

超管或生产管理员可以再登记一台，例如编号 `CAM-DEL-01`、棚区 `S01`、名称 `可删除镜头`、备注 `删除前`。登记后列表有这一行。可以先改备注再点「删除」，也可以直接点「删除」。列表重新读取后，这一行没有了。点过的详情地址再打开，提示设备不存在。

同一行「相关」里有「删除」。详情页 `/devices/:id` 也有「删除」，点了回到设备列表。查看员看不到删除。传感器和 AI 盒在能改档案时也可以删除，镜头码一列仍是「—」。

停用和删除不是一回事。停用后这一行还在，详情仍可打开。删除后列表和详情都没有这一台。

## 3. 和已有演示对编号

- `make demo-camera-create` 仍只登记 `CAM-NEW-01`，编码已存在则不改档案。
- `make demo-camera-edit` 仍只改 `CAM-EDIT-01` 的备注和在线状态。
- `make demo-camera-stop` 仍只停用 `CAM-STOP-01`，档案仍在。
- `make demo-camera-list` 与 `make demo-camera-detail` 仍只保证 `CAM-ALERT-01`。
- `CAM-REG-02` 仍由登记后再发识别、登记后再发心跳使用。本命令不登记、不修改它。
- 环境遥测的传感器仍在 `/environment`，不是这页的镜头码。

`make demo-camera-list`、`make demo-camera-detail`、`make demo-camera-create`、`make demo-camera-edit`、`make demo-camera-stop`、`make demo-one-alert`、`make demo-threshold-alert`、`make demo-alert-camera-filter`、`make demo-alert-status-filter`、`make demo-alert-title-search`、`make demo-alert-handle-note`、`make demo-alert-snapshot-minio`、`make demo-telemetry-latest`、`make demo-telemetry-threshold-alert`、`make demo-alert-rule-config`、`make demo-register-and-ingest`、`make demo-register-and-heartbeat`、`make demo-ack-one-alert`、`make demo-close-one-alert` 都不改。
