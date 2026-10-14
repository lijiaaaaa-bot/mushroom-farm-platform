`estimate-label.png`、`future-days.png`、`thin-history.png`：2026-10-15（上海日期）执行 `make migrate`、`MQTT_ENABLED=false` 的 `make api`、`make web` 后，`make demo-yield-forecast` 退出码 0。Chrome 登录 `admin` 打开 http://127.0.0.1:43123/harvest 。

种子是 `CAM-YF-01`、棚区 S01：2026-10-09 成熟 4，2026-10-12 成熟 8，2026-10-15 成熟 12。日桶增速历史天数 3，间隔 6 天，每日增速 1.33。

未来成熟数：2026-10-16 估计 13 成熟，2026-10-17 估计 15 成熟，2026-10-18 估计 16 成熟。

30 日线性写「有效历史不足：近 30 个自然日仅有 3 天有成熟识别」，`days` 为空。

本环境没有 Docker。数据库是本机 Postgres 16。对象存储在 127.0.0.1:9000。Redis 未启动，幂等只依赖数据库。`MQTT_ENABLED=false`。
