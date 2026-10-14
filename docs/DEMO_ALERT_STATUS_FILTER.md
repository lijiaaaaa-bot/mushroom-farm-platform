# 按状态筛选告警

先把数据库和前后端跑起来（已经在跑就跳过）。三个终端：

```bash
make up && make migrate
make api
make web
```

API 监听 http://127.0.0.1:41821 。页面是 http://127.0.0.1:43123 。

在仓库根目录执行：

```bash
make demo-alert-status-filter
```

命令用管理员账号调用已有的告警接口。不发识别，不改阈值规则，也不确认或关闭温度过高那条告警。

1. 棚区 S01、摄像头 `CAM-STATUS-01`，标题「待确认筛选告警」。没有同标题的待确认告警时，`POST /api/v1/alerts` 新建一条，级别一般，状态是待确认。
2. 棚区 S01、摄像头 `CAM-STATUS-02`，标题「已关闭筛选告警」。已有同标题的已关闭告警则沿用。只有待确认或已确认时，用 `POST /api/v1/alerts/:id/close` 关掉，备注是「已关闭」，与 `make demo-close-one-alert` 相同。都没有则先新建再关闭。
3. `GET /api/v1/alerts?status=open` 的每一条都是待确认，含有第 1 步的告警 id，不含第 2 步。
4. `GET /api/v1/alerts/:id` 能打开第 1 步那条，状态仍是待确认。
5. `GET /api/v1/alerts?status=closed` 的每一条都是已关闭，含有第 2 步的告警 id，不含第 1 步。详情状态是已关闭。
6. `GET /api/v1/alerts?shedCode=S01` 不带 `status` 时，两条告警都在。

终端打印两条告警的 id，以及四个地址：全部列表、待确认、已关闭、告警详情。

浏览器打开 http://127.0.0.1:43123/login ，账号 `admin`，密码 `Admin@123456`。

打开终端打印的告警列表地址（不带 `status`）。状态下拉是「全部」。表里至少有「待确认筛选告警」和「已关闭筛选告警」。

把状态下拉改成「待确认」。列表只剩待确认，没有「已关闭筛选告警」。标题仍可点。点「待确认筛选告警」，详情状态是待确认。点「返回告警列表」，筛选还在。

再把状态下拉改成「已关闭」。列表只剩已关闭，没有「待确认筛选告警」。点「已关闭筛选告警」，详情状态是已关闭。

把状态下拉改回「全部」。两条都回到列表。

地址栏也可以直接打开终端打印的筛选地址：`/alerts?status=open` 或 `/alerts?status=closed`。改回「全部」后地址不再带 `status`。

`make demo-one-ingest`、`make demo-register-and-ingest`、`make demo-register-and-heartbeat`、`make demo-one-alert`、`make demo-ack-one-alert`、`make demo-close-one-alert`、`make demo-threshold-alert`、`make demo-alert-camera-filter` 不改。样例文件里的 `CAM-DEMO-01` 不改。
