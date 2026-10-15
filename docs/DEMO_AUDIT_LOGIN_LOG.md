# 审计页按用户名和时间查询登录日志

先把数据库和前后端跑起来（已经在跑就跳过）。三个终端：

```bash
make up && make migrate
make api
make web
```

API 监听 http://127.0.0.1:41821 。页面是 http://127.0.0.1:43123 。

在仓库根目录执行：

```bash
make demo-audit-login-log
```

命令用种子超管 `admin` / `Admin@123456` 取登录态。取登录态的 User-Agent 是 `audit-login-log-demo-token/1`，这一行不作为对照。

然后保证两行登录日志，User-Agent 都是 `audit-login-log-demo/1`。同一用户名、同一结果、同一 User-Agent 已在时，只改这一行的时间，不另建一行。

1. 用户 `login-log-fail` 用错误密码登录，接口返回 401。结果是失败。时间改成当前时刻前 3 小时。这是宽窗口里、窄窗口外的那一行。
2. 用户 `admin` 用种子密码再登录一次。结果是成功。时间是当前时刻。宽窗口和窄窗口里都有这一行。

`GET /api/v1/login-logs` 已有参数 `username`、`from`、`to`。用户名是整名匹配，空白不传。`from`、`to` 按登录时间比较，含两端。可以只传一端。开始晚于结束，或时间填不开，页面写「时间筛选无效」，不请求登录日志，也不保留上一张登录表。操作审计仍在下方。

3. 宽窗口是当前时刻前 4 小时到后 1 分钟。两行都在，失败是 `login-log-fail`，成功是 `admin`。宽窗口条数大于窄窗口。
4. 窄窗口是当前时刻前 30 分钟到后 1 分钟。有 `admin` 成功，没有 `login-log-fail`。
5. 只填用户名 `login-log-fail` 时是 1 条，结果失败。
6. 同一用户名再套窄窗口，条数是 0。

下方操作审计仍读 `GET /api/v1/audit-logs`。有「登录失败」，明细 `login-log-fail`（动作 `auth.login_failed`），以及用户 `admin` 的「登录成功」（动作 `auth.login`）。

不发识别，不发心跳，不改告警，不改 `GET /api/v1/login-logs` 和 `GET /api/v1/audit-logs` 的参数。不改 `make demo-audit-log`（那条仍是用户 `audit-demo`，User-Agent `audit-log-demo/1`）。

终端打印两行的时间和四个地址：宽窗口、窄窗口、失败用户、空筛选。

浏览器打开 http://127.0.0.1:43123/login ，账号 `admin`，密码 `Admin@123456`。

## 页面

打开 http://127.0.0.1:43123/audit 。上方是「登录日志」，有用户、开始时间、结束时间。点「查询」后地址栏带上 `username`、`from`、`to`，空着的不出现。点「清除」回到 `/audit`，这三个参数都不传。

筛着时写出「用户 …」「时间 … 至 …」和「共 N 条」。没有命中时写「没有符合条件的登录日志。」，不写「暂无登录日志。」。一张登录日志都没有、也没在筛时，才写「暂无登录日志。」。时间无效时写「时间筛选无效」。

下方仍是「操作审计」。

## 截图

拍四张，都要登录后的审计页。

1. 打开终端打印的「宽窗口列表」。开始时间和结束时间已填上。页面写出「时间 … 至 …」和「共 N 条」，N 与终端的宽窗口条数相同。表里同时有用户 `login-log-fail`（失败）和 `admin`（成功），User-Agent 是 `audit-login-log-demo/1`。`login-log-fail` 的时间更早。
2. 打开终端打印的「窄窗口列表」。开始时间比上一张更晚。表里有 `admin` 成功，没有 `login-log-fail`。条数比第 1 张少。
3. 打开终端打印的「失败用户列表」。用户框是 `login-log-fail`，开始时间和结束时间是空的。页面写出「用户 login-log-fail」和「共 1 条」。表里只有失败，没有 `admin`。
4. 打开终端打印的「空筛选列表」。用户仍是 `login-log-fail`，开始时间和结束时间是窄窗口。页面写出「共 0 条」和「没有符合条件的登录日志。」。登录表没有行。往下仍能看到「操作审计」。

也可以在 `/audit` 自己填这两组条件，点「查询」。地址栏直接打开终端打印的地址，效果与点「查询」相同。

`make demo-audit-log`、`make demo-rbac`、`make demo-user-mgmt` 不改。
