# 停用一台镜头

先把数据库和前后端跑起来（已经在跑就跳过）。三个终端：

```bash
make up && make migrate
make api
make web
```

API 监听 http://127.0.0.1:41821 。页面是 http://127.0.0.1:43123 。

下面按顺序做。账号 `admin`，密码 `Admin@123456`。前面可以先跑 `make demo-camera-create` 和 `make demo-camera-edit`，那两台镜头不是这一条。

## 1. 登记 CAM-STOP-01，再停用

在仓库根目录：

```bash
make demo-camera-stop
```

命令登录后 `POST /api/v1/devices`。请求体是 `{"code":"CAM-STOP-01","name":"可停用镜头","type":"camera","shedCode":"S01","note":"停用前"}`。库里还没有这台时接口返回 201，终端打印 `登记: 新建`。编码已存在时接口返回「设备编码已存在」，终端打印 `登记: 已有，未改名称和心跳`，名称、棚区、备注、在线状态和最近心跳保持原样。

命令再读设备页用的同一份列表：`GET /api/v1/devices?pageSize=100`。这一行必须是摄像头，棚区 S01，镜头码 `CAM-STOP-01`。然后 `PATCH /api/v1/devices/:id`，请求体只有 `{"enabled":false}`。保存后再读同一份列表，并用这一行的 `id` 读 `GET /api/v1/devices/:id`。列表和详情的启用都必须是停用。名称、棚区、备注、在线状态和最近心跳与停用前一致。这一行仍在列表里，详情仍返回 200。缺字段或对不上时命令失败。不发识别，不发心跳，不改告警，不改阈值规则，不删除档案。

新建时终端还有这几行：

```text
登记: 新建
停用前: 启用
停用后: 停用
在线状态: 离线
备注: 停用前
镜头码: CAM-STOP-01
编号: CAM-STOP-01
名称: 可停用镜头
类型: 摄像头
棚区: S01
最近心跳: —
设备页: http://127.0.0.1:43123/devices
镜头详情: http://127.0.0.1:43123/devices/<id>
```

已有档案时，停用前的启用、在线状态、备注、名称、最近心跳以终端打印为准。停用后启用是停用，其余与停用前相同。镜头码仍是 `CAM-STOP-01`。再跑一次仍是停用，不改名称和心跳。

在线或离线仍由心跳和手改状态决定。停用不写心跳，也不把在线改成离线。下一次心跳仍按上报改在线状态，不清这句备注，也不把停用改回启用。

## 2. 在设备页和详情页对上停用的这一台

浏览器打开 http://127.0.0.1:43123/login ，登录后打开：

http://127.0.0.1:43123/devices

「摄像头 / AI 盒 / 传感器」里找到镜头码 `CAM-STOP-01`。这一行还在。启用一列是停用。状态仍是离线（已有档案则以列表为准），备注框里仍是停用前的那句。

点这一格镜头码，或点同一行「相关」里的「详情」，或打开终端打印的镜头详情。详情页的启用是停用，状态和备注与列表这一行相同。详情仍可打开。

超管或生产管理员可以点「启用」，列表和详情的启用变回启用。查看员看不到停用和启用。传感器和 AI 盒没有这个按钮。

要再看一次从启用到停用：在详情或列表点「启用」，确认启用一列是启用，再点「停用」。这一行重新读取后，启用是停用，详情也是停用。

## 3. 和已有演示对编号

- `make demo-camera-create` 仍只登记 `CAM-NEW-01`，编码已存在则不改档案。
- `make demo-camera-edit` 仍只改 `CAM-EDIT-01` 的备注和在线状态。
- `make demo-camera-list` 与 `make demo-camera-detail` 仍只保证 `CAM-ALERT-01`。
- `CAM-REG-02` 仍由登记后再发识别、登记后再发心跳使用。本命令不登记、不修改它。
- 环境遥测的传感器仍在 `/environment`，不是这页的镜头码。

`make demo-camera-list`、`make demo-camera-detail`、`make demo-camera-create`、`make demo-camera-edit`、`make demo-one-alert`、`make demo-threshold-alert`、`make demo-alert-camera-filter`、`make demo-alert-status-filter`、`make demo-alert-title-search`、`make demo-alert-handle-note`、`make demo-alert-snapshot-minio`、`make demo-telemetry-latest`、`make demo-telemetry-threshold-alert`、`make demo-alert-rule-config`、`make demo-register-and-ingest`、`make demo-register-and-heartbeat`、`make demo-ack-one-alert`、`make demo-close-one-alert` 都不改。
