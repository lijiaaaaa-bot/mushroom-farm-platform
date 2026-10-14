# 按摄像头编号筛选告警

先把数据库和前后端跑起来（已经在跑就跳过）。三个终端：

```bash
make up && make migrate
make api
make web
```

API 监听 http://127.0.0.1:41821 。页面是 http://127.0.0.1:43123 。

在仓库根目录执行：

```bash
make demo-alert-camera-filter
```

命令用管理员账号调用已有的告警接口，不发识别，不改阈值规则，也不确认或关闭已有告警。

1. 棚区 S01、摄像头 `CAM-FILTER-01`，标题「东侧过道告警」。没有未闭合的同标题告警时，`POST /api/v1/alerts` 新建一条，级别一般。
2. 棚区 S01、摄像头 `CAM-FILTER-02`，标题「西侧过道告警」。同样，已有未闭合的同标题告警则沿用。
3. `GET /api/v1/alerts?cameraCode=CAM-FILTER-02` 的每一条都是这台摄像头，并且含有第 2 步的告警 id。`CAM-FILTER-01` 不在这个结果里。
4. `GET /api/v1/alerts/:id` 能打开第 2 步那条，摄像头仍是 `CAM-FILTER-02`。
5. `GET /api/v1/alerts?shedCode=S01` 不带 `cameraCode` 时，两条告警都在。

终端打印两条告警的 id，以及三个地址：全部列表、按摄像头筛选、告警详情。

浏览器打开 http://127.0.0.1:43123/login ，账号 `admin`，密码 `Admin@123456`。

打开终端打印的告警列表地址（不带 `cameraCode`）。表里「摄像头」列至少有 `CAM-FILTER-01` 和 `CAM-FILTER-02`。

在「摄像头」输入框填 `CAM-FILTER-02`，点「筛选」。列表只剩这台摄像头。标题仍可点。点「西侧过道告警」，详情页摄像头是 `CAM-FILTER-02`。点「返回告警列表」，筛选还在。再点「清除」，两台摄像头都回到列表。

地址栏也可以直接打开终端打印的筛选地址：`/alerts?cameraCode=CAM-FILTER-02`。点「清除」同样回到多摄像头列表。

`make demo-one-ingest`、`make demo-register-and-ingest`、`make demo-register-and-heartbeat`、`make demo-one-alert`、`make demo-ack-one-alert`、`make demo-close-one-alert`、`make demo-threshold-alert` 不改。样例文件里的 `CAM-DEMO-01` 不改。
