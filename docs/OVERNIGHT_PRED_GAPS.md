# 过夜完成谓词：原始需求缺口

分支：`overnight/orig-gaps-batch-harvest-reports-lifecycle`  
对照：原始需求（四）批次潮次、（六）采摘任务与 2–3 日产量、（七）Excel 报表、（一）抓拍热冷。Issue #77 #78 #79 #80。

下列命令退出码 0 才算该条通过。时长不算完成。

1. 全量测试  
   `make test`

2. 文档门禁  
   `make gates`

3. 对象生命周期：未配置打印未下发；已配置但端点不可达或读回不匹配则非零退出；桩客户端读回规则后才算已下发。  
   `node --test scripts/object-lifecycle.spec.mjs`

4. 批次潮次 API：出菇、快速生长、成熟阶段，回放曲线只含本棚棚级日桶；他棚 403；查看员不能新建。  
   `npm --prefix apps/api test -- --testPathPattern=batch.http.spec --watchman=false`

5. 采摘任务与日桶增速：生成当日成熟清单、排班保留、棚隔离；未来 3 日数字来自日桶首尾增速，单日桶不给数字。  
   `npm --prefix apps/api test -- --testPathPattern='harvest.tasks.spec|bucket-forecast.spec' --watchman=false`

6. 报表预览与导出：园区生长周汇总、分棚产量、病害、环境、设备在线、告警闭环；同一筛选的 xlsx 含预览中的棚与数量。  
   `npm --prefix apps/api test -- --testPathPattern=reports.preview.spec --watchman=false`

7. 管理端页面：批次回放、采摘任务与桶增速、报表预览与打印。  
   `npm --prefix apps/web exec vitest run src/views/BatchesView.spec.ts src/views/HarvestView.spec.ts src/views/ReportsPreview.spec.ts`
