# 告警详情打开对象存储里的抓拍

先把数据库和前后端跑起来（已经在跑就跳过）。三个终端：

```bash
make up && make migrate
make api
make web
```

API 监听 http://127.0.0.1:41821 。页面是 http://127.0.0.1:43123 。`make up` 里的对象存储监听 127.0.0.1:9000 ，桶是 `mushroom-snapshots`。

在仓库根目录执行：

```bash
make demo-alert-snapshot-minio
```

命令读取 `packages/contracts/fixtures/recognition.demo-one.json`，把本次请求的摄像头编号改成 `CAM-SNAP-01`，温度改成 30，识别时间改成当前时刻，幂等键改成 `demo-snap-<毫秒>`，只 POST 一次 `POST /api/v1/ingest/recognition`。样例 JPEG 随报文写入对象存储。样例文件里的 `CAM-DEMO-01` 和温度 22.5 不改。

种子规则「温度过高」阈值 28。识别入库后留下棚区 S01、摄像头 `CAM-SNAP-01` 的未闭合告警，并记下抓拍对象键。同一条未闭合告警已在、而且已经有对象键时，沿用这一条，不新建。还没有对象键时，这次写入的键补到这条告警上。

终端打印 `抓拍对象键:` 和 `告警抓拍:`。`告警抓拍` 是 `GET /api/v1/alerts/<id>/snapshot`。读回的字节与样例 JPEG 一致，否则命令失败。对象键形如 `snapshots/S01/<上海日>/CAM-SNAP-01/<毫秒>.jpg`，文件在 MinIO 桶 `mushroom-snapshots`。

浏览器打开 http://127.0.0.1:43123/login ，账号 `admin`，密码 `Admin@123456`。然后打开终端打印的告警详情地址：

http://127.0.0.1:43123/alerts/<告警 id>

详情里有这张抓拍图、对象键，以及「打开抓拍」。列表里这条标题旁边有「抓拍」，点进去是同一页。

`make smoke` 里的一步 `demo-alert-snapshot` 跑同一条命令。

`make demo-one-ingest`、`make demo-one-alert`、`make demo-ack-one-alert`、`make demo-close-one-alert`、`make demo-threshold-alert`、`make demo-alert-camera-filter`、`make demo-alert-status-filter`、`make demo-alert-title-search`、`make demo-alert-handle-note` 不改。这条演示不确认、不关闭其他告警。
