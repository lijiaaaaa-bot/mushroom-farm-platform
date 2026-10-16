# 全局设备在线（按类型）

先把数据库和前后端跑起来（已经在跑就跳过）。三个终端：

```bash
make up && make migrate
make api
make web
```

API 监听 http://127.0.0.1:41821 。页面是 http://127.0.0.1:43123 。

在仓库根目录：

```bash
make demo-device-online-by-type
```

命令登记六台设备。编码已存在则不改名称和备注。在线的三台各 POST 一次 `POST /api/v1/ingest/heartbeat`，`online` 为 true，心跳时间是运行命令的时刻。形状来自 `packages/contracts/fixtures/heartbeat.http.json`，那个文件仍是 `EDGE-SIM-BOX` / `ai_box`，本命令不改文件。离线的三台不发心跳。已经在线时只 `PATCH /api/v1/devices/:id`，把 `onlineStatus` 改成 `offline`。这一步不新建告警。

| 编号 | 类型 | 棚区 | 状态 |
| --- | --- | --- | --- |
| `CAM-DOT-01` | 摄像头 | `S01` | 在线 |
| `CAM-DOT-02` | 摄像头 | `S01` | 离线 |
| `BOX-DOT-01` | AI 盒子 | `S01` | 在线 |
| `BOX-DOT-02` | AI 盒子 | `S02` | 离线 |
| `SENSOR-DOT-01` | 传感器 | `S01` | 在线 |
| `SENSOR-DOT-02` | 传感器 | `S02` | 离线 |

对照 `CAM-DOT-NONE`、`BOX-DOT-NONE`、`SENSOR-DOT-NONE` 不登记。命令再读全园设备列表（每页 100 条，按 `total` 翻页）和 `GET /api/v1/dashboard/overview`。

口径：当前账号能看见的设备档案。管理员是全园。在线是 `onlineStatus` 为 `online` 的台数，总数含离线。停用的设备仍计入。未知类型不进这三格。摄像头、AI 盒子、传感器的在线相加等于 `deviceOnline`，总数相加等于 `deviceTotal`。

种子设备在全新库里是离线，共 4 台摄像头（`CAM-S01-01`、`CAM-S01-02`、`CAM-S02-01`、`CAM-S03-01`）、2 台 AI 盒子（`BOX-01`、`BOX-02`）、2 台传感器（`SENSOR-S01`、`SENSOR-S02`）。加上上面六台，且种子仍全部离线、没有别的设备时：

```text
摄像头 1/6 · AI盒子 1/4 · 传感器 1/4
```

库里还有别的设备，或种子设备已经不是离线时，旁注按同一口径变，仍然等于总览接口，也等于下面两个页面。三种类型仍各至少一台在线、一台离线。

默认超过 5 分钟没有新的心跳，在线的三台会再变成离线。要再看在线，把命令再跑一次。手改成离线的三台会留在离线，直到有新的心跳。

浏览器打开 http://127.0.0.1:43123/login ，账号 `admin`，密码 `Admin@123456`。

## 1. 总览

打开 http://127.0.0.1:43123/ 。「异常环境点位数」下面有一块「全局设备在线」。三张卡是「摄像头」「AI盒子」「传感器」，卡上是在线/总数。下面一行旁注与三张卡相同。干净库存这一行是「摄像头 1/6 · AI盒子 1/4 · 传感器 1/4」。

## 2. 基地大屏

打开 http://127.0.0.1:43123/big-screen 。指标条里原来的「设备在线」仍是全部类型的 `deviceOnline/deviceTotal`。它下面另有一块「全局设备在线」，三张卡和旁注与总览相同。点某一个棚之后，这一块仍是全园（当前账号可见范围），不改成单棚设备列表。

## 3. 对照

`CAM-DOT-NONE`、`BOX-DOT-NONE`、`SENSOR-DOT-NONE` 不在设备列表里。`CAM-DOT-02`、`BOX-DOT-02`、`SENSOR-DOT-02` 是离线。干净库存时总览和大屏旁注都是「摄像头 1/6 · AI盒子 1/4 · 传感器 1/4」。再跑一次仍是这个旁注，只要种子设备保持离线且没有新的设备。

## Mac 截图验收

在 Mac 上 API 已监听 41821、页面已打开时：

1. 跑 `make demo-device-online-by-type`。终端第一行与总览、大屏旁注相同。
2. 截总览 `/`：标题是「全局设备在线」，三张卡能读到在线/总数，与旁注相同。干净库存旁注是「摄像头 1/6 · AI盒子 1/4 · 传感器 1/4」。
3. 截基地大屏 `/big-screen`：同样的标题、三张卡和同一句旁注。原来的「设备在线」总数字仍在。

## 验收

- `make demo-device-online-by-type` 在 API 已启动时退出码 0。终端第一行是「摄像头 a/b · AI盒子 c/d · 传感器 e/f」。干净库存是「摄像头 1/6 · AI盒子 1/4 · 传感器 1/4」。
- 总览 `/` 与基地大屏 `/big-screen` 上的标题、三张卡和旁注与这一行相同。
- `GET /api/v1/dashboard/overview` 的 `cameraOnline`、`cameraTotal`、`aiBoxOnline`、`aiBoxTotal`、`sensorOnline`、`sensorTotal` 与设备列表按类型点数相同。
- 对照编号未登记。离线三台是离线。在线三台有最近心跳。

不改值班看板页面，也不改它读的 `deviceOnline`、`deviceTotal`。这六台会计入那两个总数。不改异常环境点位数、全园环境参数均值、在养三数、当日病害总数、今日识别次数、今日抓拍总量的旁注。不改 `overview.env`。不改接入观测。不改 `heartbeat.http.json`。不画点位分布。

本机若没有 Docker，或 API 没在 41821 监听，命令不会对接口实发。Mac 上再跑 `make demo-device-online-by-type`，并按上面的地址截图。
