# 按设备筛选告警

先把数据库和前后端跑起来（已经在跑就跳过）。三个终端：

```bash
make up && make migrate
make api
make web
```

API 监听 http://127.0.0.1:41821 。页面是 http://127.0.0.1:43123 。

在仓库根目录执行：

```bash
make demo-alert-by-device
```

命令用管理员账号登记两台摄像头，再调用已有的告警接口。不发识别，不确认，不关闭。状态下拉保持「全部」，不改 `make demo-alert-status-filter`。起止时间筛选也不改。

告警行上没有单独的设备主键。`GET /api/v1/alerts` 接受 `deviceId`，按这台设备的编号精确匹配告警的 `cameraCode` 或 `sensorCode`。空白不传。不是设备 id 时接口返回 400，页面写出请求失败。没有这台设备时列表为空。`cameraCode` 仍按摄像头编号精确匹配，可以和 `deviceId`、`status`、`from`、`to` 同时用。

1. 棚区 S01、摄像头 `CAM-DEVF-01`，名称「东侧设备」。没有这台时 `POST /api/v1/devices` 新建。已有则不改名称和备注。
2. 棚区 S01、摄像头 `CAM-DEVF-02`，名称「西侧设备」。同样，已有则不改档案。
3. 标题「东侧设备告警」挂在 `CAM-DEVF-01`。没有同棚、同摄像头、同标题的待确认告警时，`POST /api/v1/alerts` 新建一条，级别一般。
4. 标题「西侧设备告警」挂在 `CAM-DEVF-02`。同样只在没有待确认时新建。
5. `GET /api/v1/alerts?deviceId=<东侧 id>&q=设备告警` 含有第 3 步，不含第 4 步。每一行的摄像头或传感器都是 `CAM-DEVF-01`。条数少于不带 `deviceId` 的同一关键词列表。
6. `GET /api/v1/alerts?deviceId=<西侧 id>&q=设备告警` 含有第 4 步，不含第 3 步。每一行都是 `CAM-DEVF-02`。条数同样少于全部。
7. `GET /api/v1/alerts?q=设备告警` 不带 `deviceId` 时，两条都在。
8. `GET /api/v1/alerts?cameraCode=CAM-DEVF-01&q=设备告警` 仍只含东侧那条。`deviceId=<东侧 id>&status=open` 时东侧还在，西侧仍不在。状态下拉没有被设备换成别的参数。

终端打印两台设备的 id、两条告警的 id，以及三个地址：全部列表、设备 A 列表、设备 B 列表。三个地址都带 `q=设备告警`，都不带 `status`。

浏览器打开 http://127.0.0.1:43123/login ，账号 `admin`，密码 `Admin@123456`。

## 截图

在 Mac 上拍三张，都要登录后的告警列表。状态下拉是「全部」。设备下拉能看出选中的是哪一台。

1. 打开终端打印的「全部列表」。地址带 `q=设备告警`，不带 `deviceId`，不带 `status`。设备下拉是「全部」。表里同时有「东侧设备告警」和「西侧设备告警」。摄像头列分别是 `CAM-DEVF-01` 和 `CAM-DEVF-02`。
2. 打开终端打印的「设备A列表」。地址带东侧设备的 `deviceId`。设备下拉是「东侧设备（CAM-DEVF-01）」，旁边写出「设备 东侧设备（CAM-DEVF-01）」。表里有「东侧设备告警」，没有「西侧设备告警」。行数比第 1 张少。
3. 打开终端打印的「设备B列表」。地址带西侧设备的 `deviceId`。设备下拉是「西侧设备（CAM-DEVF-02）」。表里有「西侧设备告警」，没有「东侧设备告警」。和第 2 张不是同一行。

也可以在 `/alerts` 自己把设备下拉改成这两台之一。改回「全部」后不再传 `deviceId`，两条都回到关键词列表里。地址栏直接打开终端打印的地址，效果与改下拉相同。

把状态下拉改成「待确认」时，地址仍带着原来的 `deviceId`。东侧待确认还在，西侧那条仍不在。改回「全部」后，设备筛选还在。摄像头编号输入框仍可点「筛选」，和设备下拉互不替换。

`make demo-alert-ack`、`make demo-alert-detail`、`make demo-alert-status-filter`、`make demo-alert-time-range`、`make demo-alert-camera-filter`、`make demo-device-online`、`make demo-device-online-filter`、`make demo-device-detail`、`make demo-duty-board` 不改。
