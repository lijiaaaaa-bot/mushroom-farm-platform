# 超管在用户页新建账号并重设密码

先把数据库和前后端跑起来（已经在跑就跳过）。三个终端：

```bash
make up && make migrate
make api
make web
```

没有 Docker 时，活的 `make demo-user-create-reset` 连不上 API。登录、新建和重设链路由 `scripts/demo-user-create-reset.spec.mjs` 在 `make test` 里覆盖。本机要看到页面，仍需要上面的 `make up && make migrate` 和 `make api`、`make web`。

API 监听 http://127.0.0.1:41821 。页面是 http://127.0.0.1:43123 。

## 1. 新建一条，再重设另一条

在仓库根目录：

```bash
make demo-user-create-reset
```

命令用种子超管 `admin` / `Admin@123456` 登录。

新建走 `POST /api/v1/users`，不带 `resetPassword`：

| 字段 | 值 |
|------|----|
| 用户名 | `user-create-demo` |
| 密码 | `Create@123456` |
| 显示名 | 新建演示 |
| 角色 | 查看 |
| 棚号 | S01 |

用户名已存在时返回 409「用户名已存在」，不改这一行，也不另建一行。然后 `GET /api/v1/users` 含 `user-create-demo`，响应里没有密码。

再准备 `user-reset-demo`。还没有这个用户名时，用旧密码 `ResetOld@123456`、显示名「重设演示」、角色查看、棚号 S02 新建一行。已经有这个用户名时不另建一行。然后带 `resetPassword: true` 把密码写成 `ResetNew@123456`，显示名、角色、棚号仍是上面这组，并重新启用。

重设之后：

| 检查 | 结果 |
|------|------|
| `GET /api/v1/users` | 仍有 `user-reset-demo`，编号与重设前相同，也仍有 `user-create-demo`。没有密码 |
| `user-reset-demo` / `ResetNew@123456` | 登录成功 |
| `user-reset-demo` / `ResetOld@123456` | 401 |

不改 `admin`、`viewer`、`producer`、`shedlead` 的密码。不发识别，不发心跳，不改告警。

`make demo-user-mgmt` 与 `make demo-rbac` 仍把 `viewer` 写成 `Viewer@123456`，本命令不调用那一次写入。

终端打印登录地址和用户页地址。

## 2. 在页面上对这两行

浏览器打开 http://127.0.0.1:43123/login 。

用 `admin` / `Admin@123456` 登录。打开 http://127.0.0.1:43123/users 。

上方是「新建用户」：用户名、密码、显示名、角色、棚号。点「新建」后，下方列表出现这一行，页面上不留下密码。

对已有行点「重设密码」，填写新密码后提交。这一行还在。列表没有密码明文。

退出后打开登录页：

- `user-reset-demo` / `ResetNew@123456` 能进入管理端
- `user-reset-demo` / `ResetOld@123456` 停在登录页，提示「用户名或密码错误」

`make demo-user-mgmt`、`make demo-rbac` 以及其他已有演示命令都不改。
