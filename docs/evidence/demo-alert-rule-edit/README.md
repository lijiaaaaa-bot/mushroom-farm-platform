`list-after-create.png`、`list-after-edit.png`、`detail-after-edit.png`：2026-10-14 执行 `make migrate`、`MQTT_ENABLED=false` 的 `make api`、`make web` 后，Chrome 登录 `admin` 打开 http://127.0.0.1:43123/alert-rules 。

新建截图：上方「新建规则」提交「演示规则新建」，指标湿度过低，阈值 40，等级提示，窗口 180 分钟。提示写「已新建」，列表这一行被描出，启用是。

编辑截图：同一行改成阈值 55、等级一般、窗口 90 分钟，点「保存」再点「停用」。提示写「已保存」，启用否。

详情截图：点「打开详情」。名称、指标、棚区全场、阈值 55、等级一般、窗口分钟 90、启用否。

本环境没有 Docker。数据库是本机 Postgres 16。库里种子规则「温度过高」仍是阈值 28。
