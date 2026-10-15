# 单棚实时蘑菇生长数据可查可见

先把数据库和前后端跑起来（已经在跑就跳过）。三个终端：

```bash
make up && make migrate
make api
make web
```

API 监听 http://127.0.0.1:41821 。页面是 http://127.0.0.1:43123 。

在仓库根目录：

```bash
make demo-shed-live-stats
```

命令读取 `packages/contracts/fixtures/recognition.demo-growth-trend.json`，只作报文底稿。样例文件不改。写入摄像头 `CAM-SLS-01`、棚区 `S01` 的当日一条识别：

| 项 | 值 |
| --- | --- |
| 蘑菇数 | 20 |
| 成熟数 | 8 |
| 待成熟 | 12 |
| 病害数 | 2 |
| 病害等级 | 1 |

待成熟 = 蘑菇数 − 成熟数。蘑菇为 0 时待成熟为 0，结果不为负。识别时间是运行时刻，幂等键是 `demo-shed-live-stats-CAM-SLS-01-<上海日>`。同一天再跑沿用这一行，不另建。样例里的 `CAM-GT-01`、蘑菇数 21、病害数量 0 不改。`recognition.demo-one.json` 里的 `CAM-DEMO-01` 不改。

病害等级 1，低于种子规则「病害等级一般」的 2。病害数量 2，低于「病害数量一般」的 5。成熟占比 8/20，低于「成熟占比一般」的 0.6。温度 22.5℃，湿度 88%，CO₂ 900，基质含水率 70%。若仍留下这台摄像头的未闭合告警，命令末尾关闭，备注「实时生长演示后关闭」。对象存储没起来时，第一次写入失败。

然后读两份当日统计：

- `GET /api/v1/growth-trends/live?shedCode=S01&cameraCode=CAM-SLS-01` 的蘑菇数 20、成熟数 8、待成熟 12、病害数 2。
- `GET /api/v1/growth-trends/live?shedCode=S01&cameraCode=CAM-SLS-NONE` 的 `available` 为 false，四个数是空。

接口读当日日桶 `mushroom_count`、`mature_count`、`disease_count`（当日最新）。不传摄像头时，把该棚各摄像头的最新蘑菇、成熟、病害相加，待成熟在相加之后再算。少于可用点时页面写「该棚暂无实时生长数据。」，四格是「—」。

终端打印这两个地址：

```text
打开: http://127.0.0.1:43123/shed-live-stats?shedCode=S01&cameraCode=CAM-SLS-01
对照: http://127.0.0.1:43123/shed-live-stats?shedCode=S01&cameraCode=CAM-SLS-NONE
```

浏览器打开 http://127.0.0.1:43123/login ，账号 `admin`，密码 `Admin@123456`。侧栏「单棚实时」也进这一页。

## 1. 同一屏读到四个数

打开终端里的「打开」。页顶能读到：

| 位置 | 值 |
| --- | --- |
| 标题 | 单棚实时 |
| 棚区下拉 | 一号菇棚（S01） |
| 文字 | 棚区 S01 · 摄像头 CAM-SLS-01 |
| 旁注 | 蘑菇 20 · 成熟 8 · 待成熟 12 · 病害 2 |
| 蘑菇数 | 20 |
| 成熟数 | 8 |
| 待成熟 | 12 |
| 病害数 | 2 |

四格在同一屏。不要停在「该棚暂无实时生长数据。」

## 2. 对照

打开终端里的「对照」。摄像头是 `CAM-SLS-NONE`。页面写「该棚暂无实时生长数据。」四格是「—」。没有 20、8、12、2。空棚没有当日日桶时，文案相同。

## 验收

- `make demo-shed-live-stats` 在 API 已启动时退出码 0，并打印打开和对照两个地址。终端里的旁注是「蘑菇 20 · 成熟 8 · 待成熟 12 · 病害 2」。
- 打开截图同一屏能读到棚区 S01、摄像头 CAM-SLS-01，四格是蘑菇数 20、成熟数 8、待成熟 12、病害数 2。
- 对照截图文案含「该棚暂无实时生长数据。」，四格是「—」。
- `CAM-SLS-01` 上这次若打开了未闭合告警，已经关闭。

这一页读当日日桶。`/growth-trends` 的曲线、成熟率、日周月不改。`/shed-growth-delta`、`/shed-disease-trend`、`/shed-env-24h`、`/duty-screen`、全园总览 `/` 不改。`GET /api/v1/diseases/peaks` 不改。`make demo-growth-trend`、`make demo-growth-grain`、`make demo-maturity-rate`、`make demo-shed-growth-delta`、`make demo-shed-disease-trend`、`make demo-shed-env-24h` 不改。不改接入观测。不改样例文件。

本机若没有 Docker，或 API 没在 41821 监听，命令不会对接口实发。Mac 上再跑 `make demo-shed-live-stats`，并按上面的地址截图。
