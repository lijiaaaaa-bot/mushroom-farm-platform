# 单棚当日生长增量曲线可查可见

先把数据库和前后端跑起来（已经在跑就跳过）。三个终端：

```bash
make up && make migrate
make api
make web
```

API 监听 http://127.0.0.1:41821 。页面是 http://127.0.0.1:43123 。

在仓库根目录：

```bash
make demo-shed-growth-delta
```

命令读取 `packages/contracts/fixtures/recognition.demo-growth-trend.json`，写入摄像头 `CAM-GD-01`、棚区 `S01` 的四天识别。数量是这次请求自己的，样例文件不改：

| 上海日 | 蘑菇数 | 成熟数 | 蘑菇增量 | 成熟增量 |
| --- | --- | --- | --- | --- |
| 前 5 日 | 10 | 2 | — | — |
| 前 3 日 | 16 | 4 | +6 | +2 |
| 前 1 日 | 24 | 7 | +8 | +3 |
| 当天 | 34 | 11 | +10 | +4 |

相邻蘑菇增量是 6、8、10。前两个是 6 和 8，后一个更高。成熟增量是 2、3、4。识别时间按运行时刻往前推，幂等键是 `demo-shed-growth-delta-CAM-GD-01-<上海日>`。同一天再跑沿用这一行，不另建，样本数不加。样例里的 `CAM-GT-01` 不改。`recognition.demo-one.json` 里的 `CAM-DEMO-01` 不改。

病害数量 0，病害等级 0，温度 22.5℃，湿度 88%，CO₂ 900，基质含水率 70%。成熟占比低于种子规则「成熟占比一般」的 0.6，所以这四天不因成熟占比新开告警。对象存储没起来时，第一次写入失败。

然后读两份日桶，都带棚区 `S01` 和摄像头 `CAM-GD-01`：

- `GET /api/v1/growth-trends?days=7&shedCode=S01&cameraCode=CAM-GD-01` 的天数是 7。这一台摄像头含上面四天。相邻日的蘑菇差是 +6、+8、+10。
- `GET /api/v1/growth-trends?days=30&shedCode=S01&cameraCode=CAM-GD-01` 同样四天都在，差不变。
- `GET /api/v1/growth-trends?days=7&shedCode=S01&cameraCode=CAM-GD-NONE` 的 `sheds` 是空的。

页面不新开接口。增量由这台摄像头的日桶相邻相减得到。棚汇总那一组数不拿来画这条曲线。

终端打印这三行地址：

```text
打开: http://127.0.0.1:43123/shed-growth-delta?days=7&shedCode=S01&cameraCode=CAM-GD-01
三十日: http://127.0.0.1:43123/shed-growth-delta?days=30&shedCode=S01&cameraCode=CAM-GD-01
对照: http://127.0.0.1:43123/shed-growth-delta?days=7&shedCode=S01&cameraCode=CAM-GD-NONE
```

浏览器打开 http://127.0.0.1:43123/login ，账号 `admin`，密码 `Admin@123456`。侧栏「生长增量」也进这一页。

## 1. 同一屏读到相邻增量

打开终端里的「打开」。页顶能读到：

| 位置 | 值 |
| --- | --- |
| 标题 | 单棚当日生长增量 |
| 棚区下拉 | 一号菇棚（S01） |
| 文字 | 棚区 S01 · 7 天 · 摄像头 CAM-GD-01 |
| 按钮 | 「7 天」是当前选中 |
| 旁注 | 蘑菇增量 6 → 8 → 10（升） |

旁注里还有「成熟增量 2 → 3 → 4（升）」。页面向下有两块曲线：蘑菇增量、成熟增量。曲线的点是差，后一个点高于前一个点。不要停在「没有相邻日增量，未绘制曲线。」

再往下是表。三行，日期是后三天。蘑菇增量列是 `+6`、`+8`、`+10`。第二行相对上一增量写「升 2」。表头没有「蘑菇数量」，也没有成熟率、菌盖、温度。

## 2. 三十日仍是这组差

打开终端里的「三十日」，或在同一页点「30 天」。文字变成「棚区 S01 · 30 天」。旁注仍是「蘑菇增量 6 → 8 → 10（升）」。点「7 天」回到上一节。

## 3. 对照

打开终端里的「对照」。摄像头是 `CAM-GD-NONE`。页面写「没有相邻日增量，未绘制曲线。」没有 `+6` 那一行。

## 验收

- `make demo-shed-growth-delta` 在 API 已启动时退出码 0，并打印 7 日、30 日、对照三个地址。
- 7 日截图同一屏能读到棚区 S01、摄像头 CAM-GD-01，旁注含「蘑菇增量 6 → 8 → 10（升）」或至少读出 6 到 8 和「升」。曲线或表是增量，不是 10、16、24、34 这一列绝对数。
- 30 日截图仍是这组差。
- 对照截图没有曲线，文案含「没有相邻日增量」。

这一页不是 `/growth-trends` 的蘑菇数、成熟数、成熟率绝对值，不是 `/growth-compare` 的棚间对照，也不是 `/shed-env-24h` 的温湿度。`make demo-growth-trend`、`make demo-growth-grain`、`make demo-maturity-rate`、`make demo-shed-growth-compare`、`make demo-shed-env-24h` 不改。不改接入观测。不改样例文件。

本机若没有 Docker，或 API 没在 41821 监听，命令不会对接口实发。Mac 上再跑 `make demo-shed-growth-delta`，并按上面的地址截图。
