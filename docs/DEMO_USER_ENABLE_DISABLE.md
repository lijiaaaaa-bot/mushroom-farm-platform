# 超管在用户页启停账号

先把数据库和前后端跑起来（已经在跑就跳过）。三个终端：

```bash
make up && make migrate
make api
make web
```

没有 Docker 时，活的 `make demo-user-enable-disable` 连不上 API。启停和登录链路由 `scripts/demo-user-enable-disable.spec.mjs` 在 `make test` 里覆盖。本机要看到页面，仍需要上面的 `make up && make migrate` 和 `make api`、`make web`。

API 监听 http://127.0.0.1:41821 。页面是 http://127.0.0.1:43123 。

## 1. 停用一条已有账号

在仓库根目录：

```bash
make demo-user-enable-disable
```

命令用种子超管 `admin` / `Admin@123456` 登录。

保证账号：

| 字段 | 值 |
|------|----|
| 用户名 | `user-enable-demo` |
| 密码 | `Enable@123456` |
| 显示名 | 启停演示 |
| 角色 | 查看 |
| 棚号 | S01 |

还没有这个用户名时，`POST /api/v1/users` 新建，不带 `resetPassword`。用户名已存在时返回 409「用户名已存在」，不改密码、显示名、角色和棚号，也不另建一行。

然后读 `GET /api/v1/users`。这一行的 `enabled` 必须是启用。若上次演示停在停用，命令先 `PATCH /api/v1/users/:id`，请求体只有 `{"enabled":true}`，再读列表。启用时 `user-enable-demo` / `Enable@123456` 能登录。密码对不上时命令失败，不改这一行，也不把已启用的账号停掉。

接着 `PATCH /api/v1/users/:id`，请求体只有 `{"enabled":false}`。再读同一份列表：

| 检查 | 结果 |
|------|------|
| 用户名 | 仍是 `user-enable-demo`，编号与停用前相同 |
| 启用 | 停用前是启用，停用后是停用 |
| 显示名、角色、棚号 | 与停用前相同 |
| 密码 | 列表和响应里都没有 |
| `user-enable-demo` / `Enable@123456` | 401 |

不改 `admin`、`viewer`、`user-create-demo`、`user-reset-demo` 的密码。不发识别，不发心跳，不改告警。不能停用当前登录的超管自己。

`make demo-user-mgmt`、`make demo-user-create-reset` 与 `make demo-rbac` 仍按各自的账号写入，本命令不调用那几次写入。

终端打印登录地址和用户页地址。启停前写「启用」，启停后写「停用」，停用后登录写「401」。

## 2. 在页面上看启用列

浏览器打开 http://127.0.0.1:43123/login 。

用 `admin` / `Admin@123456` 登录。打开 http://127.0.0.1:43123/users 。

找到 `user-enable-demo`。启用列是红色「停用」。这一行有「启用」按钮。当前登录的 `admin` 那一行没有停用按钮。

点 `user-enable-demo` 的「启用」。列表重新读取后，这一行被描出。启用列变成绿色「启用」。页面写「已启用 user-enable-demo。启用列是启用。」

退出后打开登录页：

- `user-enable-demo` / `Enable@123456` 能进入管理端

再用 `admin` / `Admin@123456` 打开 http://127.0.0.1:43123/users 。点同一行的「停用」。启用列变回红色「停用」。页面写「已停用 user-enable-demo。启用列是停用。」

退出后再用 `user-enable-demo` / `Enable@123456` 登录。停在登录页，提示「用户名或密码错误」。

`make demo-user-mgmt`、`make demo-user-create-reset`、`make demo-rbac` 以及其他已有演示命令都不改。
