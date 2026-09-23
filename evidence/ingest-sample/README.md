# 接入冒烟证据样本

这是 `make smoke` 成功后，从 `evidence/ingest-last-run/` 原样拷贝的一次运行结果。时间见 `summary.json` 的 `startedAt` / `finishedAt`（2026-09-23T07:07:14.170Z 至 2026-09-23T07:07:24.196Z）。

- 发送方：`scripts/edge-simulator.mjs`（真实 MQTT 客户端连 `mqtt://127.0.0.1:1883`，以及 HTTP POST）。
- 报文：`packages/contracts/fixtures/` 里的契约黄金报文。`withRuntimeClock` 只改了 `recognizedAt`。
- 每个 `steps/*.body.json` 是当时发出的原始 UTF-8，不是重新排版后的 JSON。
- `summary.json` 里 MQTT 步骤有 `topic`、`puback`、`clientId`；接受的识别有 `proof.recognitionId` 和 `proof.source`；未知字段有 `proof.table = ingest_rejects`。
- 不是客户现场抓包。

CI job `ingest-smoke` 每次再跑 `make smoke`，把当次的 `evidence/ingest-last-run/` 上传为 artifact `ingest-smoke-evidence`。本目录只是可以在 PR 里直接打开的那一次样本。
