`mild.png`、`severe.png`、`contrast.png`：2026-10-15（上海日期）执行 `make migrate`、`MQTT_ENABLED=false` 的 `make api`、`make web` 后，`make demo-disease-grade-filter` 退出码 0。Chrome 登录 `admin` 打开病害列表。

种子是棚区 S01：`CAM-DG-MILD` 病害数量 1、病害等级 1；`CAM-DG-SEV` 病害数量 2、病害等级 3。命令关闭了这两台摄像头上因此留下的 2 条未闭合告警。

`mild.png` 是 http://127.0.0.1:43123/diseases?diseaseLevel=1 。下拉是「轻度」。表里是 `CAM-DG-MILD`、轻度（1）、数量 1。没有 `CAM-DG-SEV`。

`severe.png` 是 http://127.0.0.1:43123/diseases?diseaseLevel=3 。下拉是「严重」。表里是 `CAM-DG-SEV`、严重（3）、数量 2。没有 `CAM-DG-MILD`。

`contrast.png` 把两张列表并排。左边只有轻度这一行，右边只有严重这一行。

本环境没有 Docker。数据库是本机 Postgres 16。对象存储在 127.0.0.1:9000。Redis 在 127.0.0.1:6379。`MQTT_ENABLED=false`。
