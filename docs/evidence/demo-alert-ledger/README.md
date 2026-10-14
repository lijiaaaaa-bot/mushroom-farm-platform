`preview-open.png`、`preview-closed.png`、`export-download.png`：上海日期 2026-10-15，执行 `make migrate`、`MQTT_ENABLED=false` 的 `make api`、`make web` 后，`make demo-alert-ledger` 退出码 0。Chrome 登录 `admin` 打开报表页。

待确认：地址 `status=open`。状态下拉是待确认。表里一行，棚区 S01，摄像头 `CAM-ALED-OPEN`，标题「台账待确认告警」，状态待确认，关闭原因是「—」。没有「台账已关闭告警」。

已关闭：地址 `status=closed`。状态下拉是已关闭。表里一行，棚区 S01，摄像头 `CAM-ALED-CLOSED`，标题「台账已关闭告警」，状态已关闭，关闭原因正常关闭，关闭人 admin。没有「台账待确认告警」。

导出：在已关闭这张预览上点「导出」。页面写「已开始下载 alerts.xlsx」，表里仍是已关闭那一行。

本环境没有 Docker。数据库是本机 Postgres 16。Redis 未启动，幂等只依赖数据库。`MQTT_ENABLED=false`。对象存储未启动。不发识别。
