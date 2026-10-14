`import-form.png`、`list-after-import.png`、`skip-reimport.png`：2026-10-15（上海日期）执行 `make migrate`、`MQTT_ENABLED=false` 的 `make api`、`make web` 后，`make demo-device-csv-import` 退出码 0。再跑一次仍是退出码 0，打印「已有，未改档案」。Chrome 登录 `admin` 打开 `/devices`。

`import-form.png` 是批量导入。粘贴框里是命令生成的两行：`CAM-CSV-01`、名称「CSV导入镜头」、备注「CSV导入可演示」，以及同编码的「覆盖名称」。文件选择和「导入」按钮在。

`list-after-import.png` 是设备列表里这一行。镜头码 `CAM-CSV-01`，名称「CSV导入镜头」，类型摄像头，棚区 S01，状态离线，备注「CSV导入可演示」。

`skip-reimport.png` 是同一份 CSV 再导入一次。页面写出「成功 0，失败 0，跳过 2」，以及第 1 行、第 2 行「设备编码已存在，已跳过」。列表名称仍是「CSV导入镜头」，备注仍是「CSV导入可演示」。

本环境没有 Docker。数据库是本机 Postgres 16。`MQTT_ENABLED=false`。Redis 未启动，导入不依赖它。
