# 告警闭环台账可预览导出

先把数据库和前后端跑起来（已经在跑就跳过）。三个终端：

```bash
make up && make migrate
make api
make web
```

API 监听 http://127.0.0.1:41821 。页面是 http://127.0.0.1:43123 。`make api` 可设 `MQTT_ENABLED=false`。

在仓库根目录播种并核对：

```bash
make demo-alert-ledger
```

命令用 `admin` / `Admin@123456` 登录。不发识别。

在棚区 `S01` 留下两条告警，优先 `POST /api/v1/alerts`：

- `CAM-ALED-OPEN`，标题「台账待确认告警」，状态待确认。同标题同状态已在则沿用，不新建。
- `CAM-ALED-CLOSED`，标题「台账已关闭告警」，状态已关闭。同标题同状态已在则沿用。还是待确认或已确认时，用 `POST /api/v1/alerts/:id/close` 关掉，备注「台账关闭」，关闭原因 `resolved`。没有这条时先新建再关闭。

两条的创建时间都落在上海日期窗口里。命令用这个窗口读三份预览，都带 `shedCode=S01`：

- `GET /api/v1/reports/preview?kind=alerts&from=<开始>&to=<结束>&shedCode=S01`
- 同一窗口再加 `status=open`
- 同一窗口再加 `status=closed`

不筛状态时，两行都在，状态能读出来。`status=open` 有「台账待确认告警」，没有「台账已关闭告警」，行数少于全部。`status=closed` 有「台账已关闭告警」，没有「台账待确认告警」，行数少于全部，这一行带关闭原因。然后 `GET /api/v1/reports/export.xlsx` 用已关闭这一组参数。响应是 xlsx，文件名 `export.xlsx`，工作表名称是「告警闭环」，表里有「台账已关闭告警」和 `CAM-ALED-CLOSED`，没有「台账待确认告警」。`GET /api/v1/reports/alerts.xlsx` 也是工作簿，工作表名称是「告警」，里面有这条已关闭告警。缺行或文件不是工作簿时，命令失败。

终端打印三个可打开的页面地址。浏览器打开 http://127.0.0.1:43123/login ，账号 `admin`，密码 `Admin@123456`。然后打开终端里的地址，形如：

```text
http://127.0.0.1:43123/reports?kind=alerts&from=YYYY-MM-DD&to=YYYY-MM-DD&shedCode=S01&status=open
http://127.0.0.1:43123/reports?kind=alerts&from=YYYY-MM-DD&to=YYYY-MM-DD&shedCode=S01&status=closed
http://127.0.0.1:43123/reports?kind=alerts&from=YYYY-MM-DD&to=YYYY-MM-DD&shedCode=S01
```

地址带 `kind=alerts` 时，页面自己请求预览，不用先点「预览」。报表是「告警闭环台账」。状态下拉是「待确认」或「已关闭」。表标题是「告警闭环」。等级、状态、关闭原因用告警页同一套中文：一般、待确认、已关闭、正常关闭。没有行时页面写「该筛选下没有数据。」，这不算通过。

点「导出」。页面写出「已开始下载 alerts.xlsx」，浏览器同时下载这个文件。用表格软件打开，工作表里能看到已关闭那一行。空文件时页面写「该报表没有可导出的数据。」，这不算通过。

`make demo-report-xlsx` 仍只看园区生长。本命令不改那条演示，不改样例文件，不改接入观测。

## 1. 待确认预览

登录后再打开终端里的「预览（待确认）」地址。画面里能读到「告警闭环」和「台账待确认告警」，状态是待确认，摄像头是 `CAM-ALED-OPEN`。没有「台账已关闭告警」。

截图：`docs/evidence/demo-alert-ledger/preview-open.png`。

## 2. 已关闭预览

打开「预览（已关闭）」地址。画面里能读到「台账已关闭告警」，状态是已关闭，关闭原因是正常关闭，摄像头是 `CAM-ALED-CLOSED`。没有「台账待确认告警」。和上一张比，行不一样。

截图：`docs/evidence/demo-alert-ledger/preview-closed.png`。

## 3. 导出

在已关闭这张预览上点「导出」。页面上有「已开始下载 alerts.xlsx」，或浏览器下载列表里有这个文件。两处都有就留页面这一张。

截图：`docs/evidence/demo-alert-ledger/export-download.png`。
