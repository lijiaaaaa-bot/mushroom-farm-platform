# 登记 CAM-REG-02 并发一条识别

先把数据库和前后端跑起来（已经在跑就跳过）。三个终端：

```bash
make up && make migrate
make api
make web
```

API 监听 http://127.0.0.1:41821 。页面是 http://127.0.0.1:43123 。

下面三步按顺序做。账号 `admin`，密码 `Admin@123456`。

## 1. 登记这台摄像头

浏览器打开 http://127.0.0.1:43123/login ，登录后打开：

http://127.0.0.1:43123/devices

「登记摄像头」填这四项，然后点「登记」：

- 编号 `CAM-REG-02`
- 棚区 `S01`
- 名称 `西侧过道`
- 备注 `演示登记`

下方「摄像头 / AI 盒 / 传感器」出现这一行：编号 CAM-REG-02，名称西侧过道，类型摄像头，棚区 S01，状态离线，备注演示登记。

这一步就是设备页已有的 `POST /api/v1/devices`。请求体是 `{"code":"CAM-REG-02","name":"西侧过道","type":"camera","shedCode":"S01","note":"演示登记"}`。

## 2. 给 CAM-REG-02 发一条识别

在仓库根目录：

```bash
make demo-register-and-ingest
```

命令会再请求一次 `POST /api/v1/devices`，字段与第 1 步相同。第 1 步已经登记过时，接口返回「设备编码已存在」，终端打印 `登记: 已有，未改档案`，名称和备注保持页面上的内容。跳过第 1 步时，命令用这四项自己登记，终端打印 `登记: 新建`。

接着命令只 POST 一次 `POST /api/v1/ingest/recognition`。报文读取 `packages/contracts/fixtures/recognition.demo-one.json`，本次请求的摄像头编号改为 `CAM-REG-02`，识别时间改为运行命令的时刻，幂等键改为 `demo-reg-02-<毫秒>`。样例文件里的 `cameraCode` 仍是 `CAM-DEMO-01`。

终端打印 `id:` 和 `抓拍对象键:`。对象键路径里含 `CAM-REG-02`。命令再读 `GET /api/v1/ingest/recognitions/<id>/snapshot`，字节必须和样例 JPEG 一致，否则命令失败。

`make demo-one-ingest` 发的是 `CAM-DEMO-01`，页面是 `/recognitions?cameraCode=CAM-DEMO-01`。本命令发的是 `CAM-REG-02`。

## 3. 打开这台摄像头的识别记录

终端有一行 `打开:`。用已登录的浏览器打开它。地址是：

http://127.0.0.1:43123/recognitions?cameraCode=CAM-REG-02

页上有「筛选 CAM-REG-02」。最新一张卡片是 `S01 · CAM-REG-02`，`成熟 5 · 总数 12 · 病害 1`。时间是第 2 步命令运行的时刻。卡片上有抓拍图。

再打开 http://127.0.0.1:43123/devices 。CAM-REG-02 仍在，备注仍是第 1 步写下的那句。命令自己登记时，备注是「演示登记」。
