`after-generate.png`、`after-assign.png`：2026-10-15（上海日期）执行 `make migrate`、`MQTT_ENABLED=false` 的 `make api`、`make web` 后，Chrome 登录 `admin` 打开 http://127.0.0.1:43123/harvest?date=2026-10-15 。

生成截图：`CAM-HT-01` 成熟数 5，`CAM-HT-02` 成熟数 9。人员空，班次未排，状态待采。排班辅助：上午 0 条，下午 0 条，未排 2 条。

排班截图：`CAM-HT-01` 王早、上午、已排；`CAM-HT-02` 李午、下午、已排。排班辅助：上午 1 条，下午 1 条，未排 0 条。

本环境没有 Docker。数据库是本机 Postgres 16。对象存储在 127.0.0.1:9000。Redis 未启动，幂等只依赖数据库。`MQTT_ENABLED=false`。
