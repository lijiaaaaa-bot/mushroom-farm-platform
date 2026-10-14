# 改阈值后，超限识别出现在告警列表

先把数据库和前后端跑起来（已经在跑就跳过）。三个终端：

```bash
make up && make migrate
make api
make web
```

API 监听 http://127.0.0.1:41821 。页面是 http://127.0.0.1:43123 。

在仓库根目录执行：

```bash
make demo-threshold-alert
```

命令用管理员账号调用已有的阈值规则接口，不改种子规则「二氧化碳过高」（阈值仍是 2000，级别严重）。

1. 读取 `GET /api/v1/alert-rules`。没有名为「演示二氧化碳过高」的规则时，`POST /api/v1/alert-rules` 新建一条：指标 CO₂过高，阈值 1500，级别一般，棚区 S01，窗口 720 分钟，启用。
2. `PATCH /api/v1/alert-rules/:id`，把这条规则的阈值写成 1500。这时 CO₂ 1200 不会超过阈值。
3. 若摄像头 `CAM-THRESH-01` 上还有这条规则的未闭合告警，先 `POST /api/v1/alerts/:id/close`，备注「改阈值前关闭旧告警」。不关闭其他摄像头，也不关闭 `CAM-ALERT-01` 的温度过高告警。
4. 再 `PATCH` 一次，阈值写成 1000，并保持启用。然后再读规则列表，确认这条是 1000、启用，且种子规则仍是 2000。
5. 读取 `packages/contracts/fixtures/recognition.demo-one.json`，把本次请求的摄像头改成 `CAM-THRESH-01`，CO₂ 改成 1200，识别时间改成当前时刻，幂等键改成 `demo-thresh-<毫秒>`，只 POST 一次 `POST /api/v1/ingest/recognition`。样例文件里的 `CAM-DEMO-01`、温度 22.5、CO₂ 900 不改。温度、湿度、病害数量仍用样例原值。
6. 再读 `GET /api/v1/alerts?shedCode=S01&status=open`。列表里要有一条新告警：标题「CO₂过高告警」，说明含棚区 S01、摄像头 CAM-THRESH-01、1200 和阈值 1000，级别一般，状态待确认。缺这些字段时命令失败。

1200 高于 1000，所以这条规则会告警。1200 不高于种子规则的 2000，所以不会另建一条严重的二氧化碳告警。已有演示报文的 CO₂ 是 900，不超过 1000，不会因为这条演示规则多出告警。

终端打印 `阈值: 1500 → 1000` 和 `告警 id:`。

浏览器打开 http://127.0.0.1:43123/login ，账号 `admin`，密码 `Admin@123456`。

打开 http://127.0.0.1:43123/alert-rules 。表里有一行名称「演示二氧化碳过高」，指标是 CO₂过高，阈值输入框是 1000，等级是一般，启用是「是」。种子行「二氧化碳过高」仍是 2000。

再打开终端打印的告警列表地址（带 `shedCode=S01` 和 `alertId`）。这一行高亮。标题是「CO₂过高告警」，标题下面的说明是「棚区 S01 摄像头 CAM-THRESH-01 CO₂过高 1200，阈值 1000」。级别列是「一般」，状态列是「待确认」。

`make demo-one-alert` 仍发 `CAM-ALERT-01`、温度 30，仍对照种子阈值 28。`make demo-one-ingest`、`make demo-register-and-ingest`、`make demo-register-and-heartbeat`、`make demo-ack-one-alert`、`make demo-close-one-alert` 不改。
