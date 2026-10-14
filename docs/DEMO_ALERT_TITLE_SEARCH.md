# 按标题关键词搜索告警

先把数据库和前后端跑起来（已经在跑就跳过）。三个终端：

```bash
make up && make migrate
make api
make web
```

API 监听 http://127.0.0.1:41821 。页面是 http://127.0.0.1:43123 。

在仓库根目录执行：

```bash
make demo-alert-title-search
```

命令用管理员账号调用已有的告警接口，不发识别，不改阈值规则，也不确认或关闭已有告警。

1. 棚区 S01、摄像头 `CAM-TITLE-01`，标题「东侧标题搜索告警」。没有未闭合的同标题告警时，`POST /api/v1/alerts` 新建一条，级别一般。
2. 棚区 S01、摄像头 `CAM-TITLE-02`，标题「西侧过道对照告警」。同样，已有未闭合的同标题告警则沿用。
3. `GET /api/v1/alerts?q=东侧标题` 的每一条标题都含有「东侧标题」，并且含有第 1 步的告警 id。「西侧过道对照告警」不在这个结果里。关键词前后的空白会被去掉。
4. `GET /api/v1/alerts/:id` 能打开第 1 步那条，标题仍是「东侧标题搜索告警」。
5. `GET /api/v1/alerts?shedCode=S01` 不带 `q` 时，两条告警都在。`q` 只有空白时同样两条都在。

终端打印两条告警的 id，以及三个地址：全部列表、按标题搜索、告警详情。

浏览器打开 http://127.0.0.1:43123/login ，账号 `admin`，密码 `Admin@123456`。

打开终端打印的告警列表地址（不带 `q`）。表里至少有「东侧标题搜索告警」和「西侧过道对照告警」。

在「标题」输入框填 `东侧标题`，点「搜索」。列表只剩标题里含这段文字的告警。标题仍可点。点「东侧标题搜索告警」，详情标题不变。点「返回告警列表」，搜索还在。再点「清除搜索」，两条都回到列表。

地址栏也可以直接打开终端打印的搜索地址：`/alerts?q=东侧标题`。点「清除搜索」同样回到两条都在的列表。

`make demo-one-ingest`、`make demo-register-and-ingest`、`make demo-register-and-heartbeat`、`make demo-one-alert`、`make demo-ack-one-alert`、`make demo-close-one-alert`、`make demo-threshold-alert`、`make demo-alert-camera-filter`、`make demo-alert-status-filter` 不改。样例文件里的 `CAM-DEMO-01` 不改。
