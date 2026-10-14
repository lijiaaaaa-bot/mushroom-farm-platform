# 编辑一台镜头

先把数据库和前后端跑起来（已经在跑就跳过）。三个终端：

```bash
make up && make migrate
make api
make web
```

API 监听 http://127.0.0.1:41821 。页面是 http://127.0.0.1:43123 。

下面按顺序做。账号 `admin`，密码 `Admin@123456`。

## 1. 登记 CAM-EDIT-01，再改备注和状态

在仓库根目录：

```bash
make demo-camera-edit
```

命令登录后 `POST /api/v1/devices`。请求体是 `{"code":"CAM-EDIT-01","name":"可编辑镜头","type":"camera","shedCode":"S01","note":"编辑前"}`。库里还没有这台时接口返回 201，终端打印 `登记: 新建`。编码已存在时接口返回「设备编码已存在」，终端打印 `登记: 已有，未改名称和心跳`，名称、棚区和最近心跳保持原样。

命令再读设备页用的同一份列表：`GET /api/v1/devices?pageSize=100`。这一行必须是摄像头，棚区 S01，镜头码 `CAM-EDIT-01`。然后 `PATCH /api/v1/devices/:id`，请求体是 `{"note":"备注已改","onlineStatus":"online"}`。保存后再读同一份列表，并用这一行的 `id` 读 `GET /api/v1/devices/:id`。列表和详情的备注都必须是「备注已改」，状态都必须是在线，名称、棚区和最近心跳与保存前一致。缺字段或对不上时命令失败。不发识别，不发心跳，不改告警，不改阈值规则。

新建时终端还有这几行：

```text
登记: 新建
编辑前状态: 离线
编辑前备注: 编辑前
编辑后状态: 在线
编辑后备注: 备注已改
镜头码: CAM-EDIT-01
编号: CAM-EDIT-01
名称: 可编辑镜头
类型: 摄像头
棚区: S01
最近心跳: —
设备页: http://127.0.0.1:43123/devices
镜头详情: http://127.0.0.1:43123/devices/<id>
```

已有档案时，编辑前的状态和备注、名称、最近心跳以终端打印为准。编辑后仍是备注「备注已改」、状态在线。镜头码仍是 `CAM-EDIT-01`。

没有心跳、也没有最近出现时间时，改成在线会留着。下一次心跳仍按上报改状态，不清这句备注。已有心跳超过离线阈值时，超时任务仍会把在线改回离线。

## 2. 在设备页和详情页对上改过的这一台

浏览器打开 http://127.0.0.1:43123/login ，登录后打开：

http://127.0.0.1:43123/devices

「摄像头 / AI 盒 / 传感器」里找到镜头码 `CAM-EDIT-01`。这一行的状态是在线，备注框里是「备注已改」。把状态下拉改成离线或在线，备注改成另一句，点「保存」。这一行重新读取后，状态列和备注框都是刚保存的值。最近心跳仍是「—」，除非这台本来就有心跳。

点这一格镜头码，或点同一行「相关」里的「详情」，或打开终端打印的镜头详情。详情页的状态和备注与列表这一行相同。详情上的「状态」「备注」再改一次，点「保存」。这一页的状态和备注变成刚保存的值。返回设备列表，同一行也是这两项。

传感器和 AI 盒的镜头码仍是「—」，这一行没有「详情」。查看员看不到保存。

## 3. 和已有演示对编号

- `make demo-camera-create` 仍只登记 `CAM-NEW-01`，编码已存在则不改档案。
- `make demo-camera-list` 与 `make demo-camera-detail` 仍只保证 `CAM-ALERT-01`。
- `CAM-REG-02` 仍由登记后再发识别、登记后再发心跳使用。本命令不登记、不修改它。
- 环境遥测的传感器仍在 `/environment`，不是这页的镜头码。

`make demo-camera-list`、`make demo-camera-detail`、`make demo-camera-create`、`make demo-one-alert`、`make demo-threshold-alert`、`make demo-alert-camera-filter`、`make demo-alert-status-filter`、`make demo-alert-title-search`、`make demo-alert-handle-note`、`make demo-alert-snapshot-minio`、`make demo-telemetry-latest`、`make demo-telemetry-threshold-alert`、`make demo-alert-rule-config`、`make demo-register-and-ingest`、`make demo-register-and-heartbeat`、`make demo-ack-one-alert`、`make demo-close-one-alert` 都不改。
