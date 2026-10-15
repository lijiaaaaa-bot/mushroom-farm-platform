# 超管打开用户页能看到账号和角色

先把数据库和前后端跑起来（已经在跑就跳过）。三个终端：

```bash
make up && make migrate
make api
make web
```

没有 Docker 时，活的 `make demo-user-mgmt` 连不上 API。登录链路由 `scripts/demo-user-mgmt.spec.mjs` 在 `make test` 里覆盖。本机要看到页面，仍需要上面的 `make up && make migrate` 和 `make api`、`make web`。

API 监听 http://127.0.0.1:41821 。页面是 http://127.0.0.1:43123 。

## 1. 写成两条已知账号

在仓库根目录：

```bash
make demo-user-mgmt
```

命令用种子超管 `admin` / `Admin@123456` 登录。查看账号的写入与 `make demo-rbac` 相同：`POST /api/v1/users`，把 `viewer` 写成密码 `Viewer@123456`、角色查看、棚号 `S01`。账号已在时带 `resetPassword: true`，重设密码、显示名、角色和棚号，并重新启用，不另建一行。不改 `admin`、`producer`、`shedlead`。

然后用查看密码再登录一次，核对 `GET /api/v1/users`：

| 检查 | 超管 | 查看 |
|------|------|------|
| `GET /api/v1/users` | 200，至少两行：`admin` 角色超管，`viewer` 角色查看。没有密码 | 403 |

终端打印这两条账号和角色文案。超管侧栏有「用户」。查看侧栏没有「用户」。打开 `/users` 时，角色不匹配会回到总览。

不发识别，不发心跳，不改告警，不改审计。本命令只核对列表里的账号和角色。新建和重设密码见 `make demo-user-create-reset`。

## 2. 在页面上对这两行

浏览器打开 http://127.0.0.1:43123/login 。

用 `admin` / `Admin@123456` 登录。侧栏有「用户」。打开 http://127.0.0.1:43123/users 。

表里至少两行，角色列可读：

- 用户名 `admin`，角色「超管」
- 用户名 `viewer`，角色「查看」

没有密码列。同一页上的新建和重设密码不在本命令里核对。

退出后用 `viewer` / `Viewer@123456` 登录。侧栏没有「用户」。直接打开 http://127.0.0.1:43123/users ，页面回到总览 http://127.0.0.1:43123/ 。

`make demo-rbac`、`make demo-audit-log`、`make demo-alert-status-filter`、`make demo-duty-board` 以及其他已有演示命令都不改。
