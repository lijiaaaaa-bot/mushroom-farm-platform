# 审计页能看到登录和操作记录

先把数据库和前后端跑起来（已经在跑就跳过）。三个终端：

```bash
make up && make migrate
make api
make web
```

API 监听 http://127.0.0.1:41821 。页面是 http://127.0.0.1:43123 。

## 1. 写成两条能认出的记录

在仓库根目录：

```bash
make demo-audit-log
```

命令用种子超管 `admin` / `Admin@123456` 登录，请求带 User-Agent `audit-log-demo/1`。这次成功登录写入登录日志和操作审计。

已有 `viewer` 时与 `make demo-rbac` 一样带 `resetPassword: true`，重设密码、显示名、角色和棚号 S01，不另建一行。

然后对不存在的用户 `audit-demo` 提交一次错误密码。接口返回 401。登录日志记下失败，操作审计记下 `auth.login_failed`，明细用户是 `audit-demo`。

再用 `viewer` / `Viewer@123456` 登录，核对：

| 检查 | 超管 | 查看 |
|------|------|------|
| `GET /api/v1/login-logs` | 200，第一页有下面两行 | 403 |
| `GET /api/v1/audit-logs` | 200，第一页有下面两行 | 403 |

登录日志第一页：

- 用户 `audit-demo`，结果 `failure`，User-Agent `audit-log-demo/1`
- 用户 `admin`，结果 `success`，User-Agent `audit-log-demo/1`

操作审计第一页：

- 动作 `auth.login_failed`，明细用户 `audit-demo`
- 用户 `admin`，动作 `auth.login`

不发识别，不发心跳，不改告警，不改设备。

## 2. 在页面上对这两段

浏览器打开 http://127.0.0.1:43123/login 。

用 `admin` / `Admin@123456` 登录，打开 http://127.0.0.1:43123/audit 。

上方「登录日志」：

- 用户 `audit-demo`，结果「失败」，User-Agent `audit-log-demo/1`
- 用户 `admin`，结果「成功」，User-Agent `audit-log-demo/1`

下方「操作审计」：

- 动作「登录失败」，明细 `audit-demo`
- 用户 `admin`，动作「登录成功」

退出后用 `viewer` / `Viewer@123456` 登录。侧栏没有「审计」。直接打开 http://127.0.0.1:43123/audit ，页面回到总览 http://127.0.0.1:43123/ 。

`make demo-rbac`、`make demo-alert-status-filter`、`make demo-duty-board` 以及其他已有演示命令都不改。
