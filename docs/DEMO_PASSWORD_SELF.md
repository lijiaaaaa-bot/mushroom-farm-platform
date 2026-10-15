# 登录后改自己的密码

先把数据库和前后端跑起来（已经在跑就跳过）。三个终端：

```bash
make up && make migrate
make api
make web
```

没有 Docker 时，活的 `make demo-password-self` 连不上 API。登录和改密链路由 `scripts/demo-password-self.spec.mjs` 在 `make test` 里覆盖。本机要看到页面，仍需要上面的 `make up && make migrate` 和 `make api`、`make web`。

API 监听 http://127.0.0.1:41821 。页面是 http://127.0.0.1:43123 。

## 1. 把自己的旧密码改成新密码

在仓库根目录：

```bash
make demo-password-self
```

命令用种子超管 `admin` / `Admin@123456` 准备夹具账号，再由这个账号自己改密码。

| 字段 | 值 |
|------|----|
| 用户名 | `pwd-self-demo` |
| 显示名 | 改密演示 |
| 角色 | 查看 |
| 棚号 | S01 |
| 旧密码 | `PwdOld@123456` |
| 新密码 | `PwdNew@123456` |

还没有这个用户名时，`POST /api/v1/users` 新建，不带 `resetPassword`，密码是旧密码。已经有这个用户名时，带 `resetPassword: true` 把密码写回旧密码，显示名、角色、棚号仍是上面这组，不另建一行。这一步只用现有的超管重设，不新增重设能力。

然后用 `pwd-self-demo` / `PwdOld@123456` 登录，`POST /api/v1/auth/change-password`：

```json
{ "currentPassword": "PwdOld@123456", "newPassword": "PwdNew@123456" }
```

改的是当前令牌上的账号。请求里没有用户名，也没有别人的编号。

| 检查 | 结果 |
|------|------|
| `POST /api/v1/auth/change-password` | 200。响应是用户名和 `changed: true`，没有密码 |
| `pwd-self-demo` / `PwdOld@123456` | 401，文案「用户名或密码错误」 |
| `pwd-self-demo` / `PwdNew@123456` | 登录成功。`POST /auth/login` 成功状态是 201 |
| `GET /api/v1/users` | 仍是原来那一行，没有密码 |

不改 `admin`、`viewer`、`producer`、`shedlead`、`user-create-demo`、`user-reset-demo`、`user-enable-demo`。不发识别，不发心跳，不改告警，不改接入观测。已经发出的登录令牌在过期前仍可用；要核对的是重新登录。

终端打印旧密码、新密码、改密 200、旧密码登录 401、新密码登录 201，以及下面三个地址。

## 2. 在页面上改，并看到登录前后

四个角色登录后，侧栏都有「修改密码」。地址不按角色收口。

浏览器打开 http://127.0.0.1:43123/login 。

命令跑完后，用 `pwd-self-demo` / `PwdNew@123456` 登录。打开 http://127.0.0.1:43123/account/password 。

页上写着当前账号 `pwd-self-demo · 查看`。表单是当前密码、新密码、确认新密码，输入框不是明文。文案写着「只改当前登录的账号。改密之后，旧密码不能登录，新密码可以登录。」

若要在这一页再提交一次：当前密码填 `PwdNew@123456`，新密码和确认新密码填另一组至少 6 位的密码，点「修改密码」。成功后这一块被描出，写出「旧密码：不能登录」和「新密码：可以登录」，页面上不留下密码。当前密码填错时，红字是「当前密码不正确」，人还停在这一页。这一步会把夹具密码改离 `PwdNew@123456`。只拍页面、不提交，密码仍是新密码。

## 3. 截图

命令跑完、且没有在页面上再改一次时，拍这三处：

- 修改密码页 http://127.0.0.1:43123/account/password  
  用 `pwd-self-demo` / `PwdNew@123456` 登录后打开。侧栏有「修改密码」。页上有当前账号、当前密码、新密码、确认新密码，以及「旧密码不能登录，新密码可以登录」。
- 旧密码登录失败 http://127.0.0.1:43123/login  
  退出后，用户名 `pwd-self-demo`，密码 `PwdOld@123456`。停在登录页，红字「用户名或密码错误」。
- 新密码登录成功 http://127.0.0.1:43123/login  
  同一页改用 `pwd-self-demo` / `PwdNew@123456`。进入 http://127.0.0.1:43123/ 。顶栏是「改密演示 · 查看」。

`make demo-user-mgmt`、`make demo-user-create-reset`、`make demo-user-enable-disable`、`make demo-rbac` 以及其他已有演示命令都不改。超管在 `/users` 上重设别人的密码仍是原来的「重设密码」。
