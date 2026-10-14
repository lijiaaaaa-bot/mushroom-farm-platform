# 确认或关闭时填写处理说明

先把数据库和前后端跑起来（已经在跑就跳过）。三个终端：

```bash
make up && make migrate
make api
make web
```

API 监听 http://127.0.0.1:41821 。页面是 http://127.0.0.1:43123 。

在仓库根目录执行：

```bash
make demo-alert-handle-note
```

命令用管理员账号调用已有的告警确认接口。不发识别，不改阈值规则，也不确认或关闭其他告警。

1. 棚区 S01、摄像头 `CAM-NOTE-01`，标题「处理说明告警」。没有待确认的同标题告警时，`POST /api/v1/alerts` 新建一条，级别一般。已有待确认的这一条则沿用。
2. `POST /api/v1/alerts/:id/ack`，处理说明是「现场已开窗通风」。
3. `GET /api/v1/alerts/:id` 读到状态已确认，`ackNote` 是「现场已开窗通风」。
4. 再 `GET` 一次，处理说明仍是这一句。

终端打印告警 id、处理说明，以及告警详情地址。

浏览器打开 http://127.0.0.1:43123/login ，账号 `admin`，密码 `Admin@123456`。棚区负责人 `shedlead` / `Shed@123456` 也可以给自己棚里的告警填写处理说明。查看账号没有输入框和按钮。

打开终端打印的详情地址。状态是「已确认」。处理说明是「现场已开窗通风」。刷新这个地址，处理说明还在。

要自己再走一遍：先准备一条待确认告警（例如 `make demo-one-alert`），打开 `/alerts/<告警 id>`。

在「处理说明」里写一句非空文字，点「确认」。页面重新读取后，状态是「已确认」，处理说明是刚才写的那句。刷新后仍是这句。

也可以不点确认，改点「关闭」。处理说明同样不能是空白。关闭后状态是「已关闭」，关闭原因是「正常关闭」，处理说明是刚才写的那句。刷新后仍是这句。已关闭后输入框和两个按钮不再出现。

列表上的「处理说明」默认是「已确认」。点某一行的「确认」或「关闭」时，会把这里的非空文字交给同一个接口。空白时这两个按钮不能点。详情页仍显示这次写入的处理说明。

`make demo-one-ingest`、`make demo-register-and-ingest`、`make demo-register-and-heartbeat`、`make demo-one-alert`、`make demo-ack-one-alert`、`make demo-close-one-alert`、`make demo-threshold-alert`、`make demo-alert-camera-filter`、`make demo-alert-status-filter`、`make demo-alert-title-search` 不改。样例文件里的 `CAM-DEMO-01` 不改。
