# 发一条温度过高告警

先把数据库和前后端跑起来（已经在跑就跳过）。三个终端：

```bash
make up && make migrate
make api
make web
```

API 监听 http://127.0.0.1:41821 。页面是 http://127.0.0.1:43123 。API 启动时会写入种子规则「温度过高」：指标温度过高，阈值 28，级别严重。这条规则已启用。

在仓库根目录发一条：

```bash
make demo-one-alert
```

命令读取 `packages/contracts/fixtures/recognition.demo-one.json`，把本次请求的摄像头编号改成 `CAM-ALERT-01`，温度改成 30，识别时间改成当前时刻，幂等键改成 `demo-alert-<毫秒>`，只 POST 一次 `POST /api/v1/ingest/recognition`。样例文件里的 `CAM-DEMO-01` 和温度 22.5 不改。请求头是 `X-Ingest-Token: dev-ingest-token`。

30 高于阈值 28，识别入库后产生一条告警。终端打印 `告警 id:`。同一摄像头已经有未闭合的温度过高告警时，引擎不再新建，终端打印 `告警: 沿用未闭合`，并仍给出这条的 id。

命令还会读 `GET /api/v1/alerts/:id`。详情里要有标题「温度过高告警」、说明、棚区 S01、摄像头 CAM-ALERT-01、级别严重、当前值和阈值。缺这些字段时命令失败。

浏览器打开 http://127.0.0.1:43123/login ，账号 `admin`，密码 `Admin@123456`。然后打开：

http://127.0.0.1:43123/alerts

列表里有一条标题是「温度过高告警」。点这个标题，打开：

http://127.0.0.1:43123/alerts/<告警 id>

详情页能读到这些字段：标题、说明、级别（严重）、状态（待确认，沿用已确认的则是已确认）、棚区 S01、摄像头 CAM-ALERT-01、发生时间（上海时间）、指标「温度过高」、当前值 30℃、阈值 28℃。说明正文是「棚区 S01 摄像头 CAM-ALERT-01 温度过高 30，阈值 28」。点「返回告警列表」回到 `/alerts`。

`make demo-one-ingest` 仍发 `CAM-DEMO-01`，温度仍是样例里的 22.5，不会因为这次演示改样例文件。
