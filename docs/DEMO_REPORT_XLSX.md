# 报表预览并下载 xlsx

先把数据库和前后端跑起来（已经在跑就跳过）。三个终端：

```bash
make up && make migrate
make api
make web
```

API 监听 http://127.0.0.1:41821 。页面是 http://127.0.0.1:43123 。

在仓库根目录播种并核对：

```bash
make demo-report-xlsx
```

命令读取 `packages/contracts/fixtures/recognition.demo-one.json`，把本次请求的棚区改成 `S02`，摄像头改成 `CAM-RPT-01`，蘑菇数量改成 17，成熟数量改成 9，识别时间改成当前时刻，幂等键改成 `demo-report-xlsx-<毫秒>`，只 POST 一次 `POST /api/v1/ingest/recognition`。样例文件里的 `CAM-DEMO-01` 不改。请求头是 `X-Ingest-Token: dev-ingest-token`。

识别写入当日日桶后，命令用 `admin` / `Admin@123456` 登录，再读两份预览：

- `GET /api/v1/reports/preview?kind=growth&grain=day&shedCode=S02&from=<上海今天>&to=<上海今天>`
- 同一天不带 `shedCode` 的预览

只看 S02 时，预览至少有一行，棚区是 S02，周期是上海今天，蘑菇数量至少 17，成熟数量至少 9，没有其他棚。全部棚的行数不少于只看 S02 的行数。然后 `GET /api/v1/reports/export.xlsx` 带上同一组 S02 参数。响应是 xlsx，文件名 `export.xlsx`，工作表名称是「园区生长」，表里有数据行和 S02。缺行、日期不对或文件不是工作簿时，命令失败。

终端打印两个可打开的页面地址。浏览器打开 http://127.0.0.1:43123/login ，账号 `admin`，密码 `Admin@123456`。然后打开终端里的「预览（S02）」地址，形如：

http://127.0.0.1:43123/reports?kind=growth&grain=day&from=YYYY-MM-DD&to=YYYY-MM-DD&shedCode=S02

地址带 `kind=growth` 时，页面自己请求预览，不用先点「预览」。表标题是「园区生长」。表里至少一行：棚区 S02，蘑菇数量是数字。没有行时页面写「该筛选下没有数据。」，这不算通过。

点「导出」。页面写出「已开始下载 growth.xlsx」，浏览器同时下载这个文件。用表格软件打开，工作表里能看到 S02。空文件时页面写「该报表没有可导出的数据。」，这不算通过。

可选：再打开终端里的「预览（全部棚）」地址（没有 `shedCode`）。若行数比只看 S02 更多，两张表都截下来。这次库里该日只有 S02 时，两张表行数相同，截只看 S02 的那一张即可。

`make demo-one-ingest` 仍发 `CAM-DEMO-01`。本命令不确认、不关闭告警，不改已有演示命令。

## Mac 截图

登录后再截。至少两张：

1. 预览有行。地址栏是终端打印的 S02 预览地址。画面里能读到「园区生长」和至少一行，棚区是 S02，蘑菇数量是数字。
2. 导出有反馈。点「导出」之后，页面上有「已开始下载 growth.xlsx」，或浏览器下载列表里有 `growth.xlsx`。两处都有就留页面这一张。

筛选对比加分，不作为缺图失败：全部棚与只看 S02 的行不一样时，两张预览都留。
