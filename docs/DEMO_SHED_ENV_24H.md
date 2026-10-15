# 单棚环境 24 小时趋势可查可见

先把数据库和前后端跑起来（已经在跑就跳过）。三个终端：

```bash
make up && make migrate
make api
make web
```

API 监听 http://127.0.0.1:41821 。页面是 http://127.0.0.1:43123 。

在仓库根目录：

```bash
make demo-shed-env-24h
```

命令读取 `packages/contracts/fixtures/environment.demo-history.json`，只把它当成报文底稿。样例文件不改，里面的 `SENSOR-HIST-01` 和 23.1℃ 保持原样。这次写入的是棚区 `S01`、传感器 `SENSOR-ENV24-01` 的四个小时：

| 距当前小时 | 温度 | 湿度 | CO₂ | 基质含水率 |
| --- | --- | --- | --- | --- |
| 18 小时前 | 22℃ | 78% | 620 | 68% |
| 12 小时前 | 24℃ | 84% | 760 | 72% |
| 6 小时前 | 25℃ | 88% | 880 | 75% |
| 当前小时 | 26℃ | 92% | 980 | 78% |

幂等键是 `demo-shed-env-24h-18`、`demo-shed-env-24h-12`、`demo-shed-env-24h-6`、`demo-shed-env-24h-0`。同一键已在则改观测时间，不另建一行，并重写这台传感器自己的小时桶。棚级小时均值（空的摄像头编号那一行）不重算。温度低于种子规则「温度过高」的 28，湿度在 70 和 98 之间，CO₂ 低于 2000，基质含水率高于 50，所以这四条不新开告警。

然后读 `GET /api/v1/growth-trends/environment?hours=24&shedCode=S01&sensorCode=SENSOR-ENV24-01`。温度是 22、24、25、26，湿度是 78、84、88、92。至少这两个数随小时升高。

终端打印打开地址：

```text
打开: http://127.0.0.1:43123/shed-env-24h?shedCode=S01&sensorCode=SENSOR-ENV24-01
```

浏览器打开 http://127.0.0.1:43123/login ，账号 `admin`，密码 `Admin@123456`。侧栏「环境24小时」进同一页。

## 1. 同一屏四条曲线

页顶能读到：

| 位置 | 值 |
| --- | --- |
| 棚区 | 一号菇棚（S01） |
| 传感器 | SENSOR-ENV24-01 |
| 文字 | 棚区 S01 · 24 小时 · 传感器 SENSOR-ENV24-01 |
| 旁注 | 温度 22℃ → 26℃（升 4） |

往下有四块曲线：温度、湿度、CO₂、基质含水率。温度和湿度肉眼能看出后一点比前一点高。不要停在「近 24 小时没有小时桶，未绘制曲线。」

旁注里同时有湿度 78% → 92%（升 14）、CO₂ 620 → 980（升 360）、基质含水率 68% → 78%（升 10）。

表里至少四行。第一行温度 22℃，最后一行 26℃。温度变化列能读到「升」。

这不是 `/environment` 的历史读数列表，也没有开始时间和结束时间。

## 验收

- `make demo-shed-env-24h` 在 API 已启动时退出码 0，并打印上面的打开地址。
- 截图能读到棚区 S01、传感器 SENSOR-ENV24-01、24 小时，以及至少两条随时间变化的曲线（温度 22℃ 升到 26℃，湿度 78% 升到 92%）。
- 旁注或表能读出「升」，不是只有一列读数。

`make demo-env-filter`、`make demo-telemetry-history`、`make demo-telemetry-latest`、`make demo-telemetry-threshold-alert` 不改。不改 `/growth-trends` 的蘑菇数、成熟数和菌盖直径。不改病害详情。不改接入观测。样例文件不改。

本机若没有 Docker，或 API 没在 41821 监听，命令不会对接口实发。Mac 上再跑 `make demo-shed-env-24h`，并按上面的地址截图。
