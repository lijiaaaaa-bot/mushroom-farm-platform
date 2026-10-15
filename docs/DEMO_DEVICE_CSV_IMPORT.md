# 设备 CSV 导入可查可见

先把数据库和前后端跑起来（已经在跑就跳过）。三个终端：

```bash
make up && make migrate
make api
make web
```

API 监听 http://127.0.0.1:41821 。页面是 http://127.0.0.1:43123 。`make api` 可设 `MQTT_ENABLED=false`。

下面按顺序做。账号 `admin`，密码 `Admin@123456`。

## 1. 导入 CAM-CSV-01

在仓库根目录：

```bash
make demo-device-csv-import
```

命令自己生成两行 CSV，不把这份文件提交进仓库。表头是 `设备编码,棚编码,名称,类型,备注`。

| 设备编码 | 棚编码 | 名称 | 类型 | 备注 |
| --- | --- | --- | --- | --- |
| CAM-CSV-01 | S01 | CSV导入镜头 | 摄像头 | CSV导入可演示 |
| CAM-CSV-01 | S01 | 覆盖名称 | 摄像头 | 覆盖备注 |

然后 `POST /api/v1/devices/import`，请求体是 `{ "csv": "..." }`。超管、生产管理员、棚区负责人可以导入。查看人员不行。

库里还没有 `CAM-CSV-01` 时，第一行写入，第二行因为编码已在本文件出现过而跳过。终端打印 `导入: 新建`，成功 1，失败 0，跳过 1，明细是 `第 2 行：设备编码已存在，已跳过`。

编码已经在库里时，两行都跳过。终端打印 `导入: 已有，未改档案`，成功 0，失败 0，跳过 2。名称、备注、棚区、状态、心跳和启用保持导入前的样子。冲突行的「覆盖名称」「覆盖备注」不会写进去。

命令再读设备页用的同一份列表：`GET /api/v1/devices?pageSize=100`。这一行必须是摄像头，棚区 S01，镜头码 `CAM-CSV-01`。新建时名称是「CSV导入镜头」，备注是「CSV导入可演示」，状态离线，最近心跳为空。缺字段、写成冲突行、或再跑一次改了原档案时，命令失败。不发识别，不发心跳，不单条 `POST /api/v1/devices`，不改告警。

新建时终端还有这几行：

```text
导入: 新建
成功: 1
失败: 0
跳过: 1
跳过明细: 第 2 行：设备编码已存在，已跳过
镜头码: CAM-CSV-01
编号: CAM-CSV-01
名称: CSV导入镜头
类型: 摄像头
棚区: S01
状态: 离线
备注: CSV导入可演示
最近心跳: —
设备页: http://127.0.0.1:43123/devices
```

已有档案时，名称、状态、备注、最近心跳以终端打印为准。镜头码仍是 `CAM-CSV-01`。

## 2. 在设备页对上导入和跳过

浏览器打开 http://127.0.0.1:43123/login ，登录后打开：

http://127.0.0.1:43123/devices

页顶是「批量导入」。能导入的角色看得到文件选择、粘贴框和「导入」。说明里写着：表头要有设备编码、棚编码、名称；备注可空；已存在的设备编码会跳过，不覆盖原档案。

把上面两行（含表头）贴进「粘贴 CSV」，或选一个同样内容的 `.csv` 文件。选择文件时以文件为准。点「导入」。

新建时，表单下写出「成功 1，失败 0，跳过 1」，以及「第 2 行：设备编码已存在，已跳过」。下方列表出现这一行：

| 镜头码 | 编号 | 名称 | 类型 | 棚区 | 状态 | 备注 |
| --- | --- | --- | --- | --- | --- | --- |
| CAM-CSV-01 | CAM-CSV-01 | CSV导入镜头 | 摄像头 | S01 | 离线 | CSV导入可演示 |

再贴同一份 CSV，再点一次「导入」。这次是「成功 0，失败 0，跳过 2」，两行都是「设备编码已存在，已跳过」。列表里名称仍是「CSV导入镜头」，备注仍是「CSV导入可演示」，不是「覆盖名称」或「覆盖备注」。

截图放在 `docs/evidence/demo-device-csv-import/`：

1. `import-form.png`：批量导入这一块能读到。粘贴框里有 `CAM-CSV-01`、「CSV导入镜头」和「覆盖名称」，「导入」按钮在。
2. `list-after-import.png`：列表里能读到镜头码 `CAM-CSV-01`、名称「CSV导入镜头」、备注「CSV导入可演示」。
3. `skip-reimport.png`：能读到跳过，以及「设备编码已存在，已跳过」。同一张图里名称仍是「CSV导入镜头」，不是「覆盖名称」。

## 3. 和已有演示对编号

- `make demo-camera-create` 仍只登记 `CAM-NEW-01`，编码已存在则不改档案。
- `make demo-camera-edit`、`make demo-camera-stop`、`make demo-camera-delete` 仍只动各自的镜头码。
- `make demo-camera-list` 与 `make demo-camera-detail` 仍只保证 `CAM-ALERT-01`。
- 本命令不登记、不修改 `CAM-REG-02`。

`make demo-camera-list`、`make demo-camera-detail`、`make demo-camera-create`、`make demo-camera-edit`、`make demo-camera-stop`、`make demo-camera-delete`、`make demo-device-online`、`make demo-device-detail`、`make demo-device-online-filter` 都不改。不改接入观测。不改协议字段。
