# 审计页按用户名和时间查询操作审计

先把数据库和前后端跑起来（已经在跑就跳过）。三个终端：

```bash
make up && make migrate
make api
make web
```

API 监听 http://127.0.0.1:41821 。页面是 http://127.0.0.1:43123 。

在仓库根目录执行：

```bash
make demo-audit-action-filter
```

命令用种子超管 `admin` / `Admin@123456` 取登录态。取登录态的 User-Agent 是 `audit-action-filter-demo-token/1`。这一行登录不作为操作审计对照。

然后保证两行操作审计。同一用户名、同一资源已在时，只改这一行的时间，不另建一行。

1. 用户 `audit-action-old`，动作 `harvest.correct`，资源 `recognition:audit-action-old`。明细是棚区 S01、摄像头 `CAM-ACT-OLD`、成熟数 1→2。时间改成当前时刻前 3 小时。这是宽窗口里、窄窗口外的那一行。
2. 用户 `audit-action-new`，动作 `harvest.correct`，资源 `recognition:audit-action-new`。明细是棚区 S02、摄像头 `CAM-ACT-NEW`、成熟数 3→4。时间是当前时刻。宽窗口和窄窗口里都有这一行。

`GET /api/v1/audit-logs` 接受 `username`、`from`、`to`。用户名是整名匹配，空白不传。`from`、`to` 按操作时间比较，含两端。可以只传一端。开始晚于结束，或时间填不开，接口返回 400。页面写「时间筛选无效」，不请求操作审计，也不保留上一张操作审计表。登录日志仍在上方，参数不改。

3. 宽窗口是当前时刻前 4 小时到后 1 分钟。两行都在。宽窗口条数大于窄窗口。
4. 窄窗口是当前时刻前 30 分钟到后 1 分钟。有 `audit-action-new`，没有 `audit-action-old`。
5. 只填用户名 `audit-action-old` 时是 1 条。
6. 同一用户名再套窄窗口，条数是 0。

不发识别，不发心跳，不改告警。不改 `GET /api/v1/login-logs`。不改 `make demo-audit-log`（那条仍是用户 `audit-demo`，User-Agent `audit-log-demo/1`）。不改 `make demo-audit-login-log`（那条仍是用户 `login-log-fail` 与 `admin`，User-Agent `audit-login-log-demo/1`）。

终端打印两行的时间和四个地址：宽窗口、窄窗口、该用户、空筛选。

浏览器打开 http://127.0.0.1:43123/login ，账号 `admin`，密码 `Admin@123456`。

## 页面

打开 http://127.0.0.1:43123/audit 。上方仍是「登录日志」，用户、开始时间、结束时间用 `username`、`from`、`to`。下方是「操作审计」，另有一组用户、开始时间、结束时间。点操作审计的「查询」后，地址栏带上 `auditUsername`、`auditFrom`、`auditTo`，空着的不出现。点操作审计的「清除」去掉这三个参数。登录日志那一组参数还在。

筛着时写出「用户 …」「时间 … 至 …」和「共 N 条」。没有命中时写「没有符合条件的操作审计。」，不写「暂无操作审计。」。一张操作审计都没有、也没在筛时，才写「暂无操作审计。」。时间无效时写「时间筛选无效」。

上方登录日志仍按自己的条件查询。

## 怎么看出两行不一样

登录后打开终端打印的地址。看页面下方「操作审计」，不要看上方登录日志。

1. 打开「宽窗口列表」。操作审计的开始时间和结束时间已填上，登录日志的三个框是空的。页面写出「时间 … 至 …」和「共 N 条」，N 与终端的宽窗口条数相同。表里同时有用户 `audit-action-old`（成熟数 1→2，摄像头 `CAM-ACT-OLD`）和 `audit-action-new`（成熟数 3→4，摄像头 `CAM-ACT-NEW`）。`audit-action-old` 的时间更早。
2. 打开「窄窗口列表」。开始时间比上一张更晚。表里有 `audit-action-new`，没有 `audit-action-old`。条数比第 1 张少。
3. 打开「用户列表」。用户框是 `audit-action-old`，开始时间和结束时间是空的。页面写出「用户 audit-action-old」和「共 1 条」。表里只有这一用户，没有 `audit-action-new`。
4. 打开「空筛选列表」。用户仍是 `audit-action-old`，开始时间和结束时间是窄窗口。页面写出「共 0 条」和「没有符合条件的操作审计。」。操作审计表没有行。往上仍能看到「登录日志」。

也可以在 `/audit` 下方自己填这两组条件，点「查询」。地址栏直接打开终端打印的地址，效果与点「查询」相同。

`make demo-audit-log`、`make demo-audit-login-log` 不改。
