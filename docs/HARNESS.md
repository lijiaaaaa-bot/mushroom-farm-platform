# 上游 Day-0 门禁

本仓消费 [project-harness-day0](https://origin.cursor.com/lijiaaaaa/tmp-3e65e753ea9c25fb)。包标识：`project-harness-day0` v0.1.0。

## 改动去向

门禁、协议、agent 规范、检出结构先改 harness，再同步到本仓。本仓是消费方。禁止只在本仓补故事或改文稿、不回 harness。

其他项目做 Day-0：按 harness 仓库的 `INSTALL.md` 拷贝。

## 本仓现状

`scripts/gates`、夹具和 `make gates` 留在本仓，是与 harness v0.1.0 对齐的拷贝快照，CI 继续跑这些本地脚本。以后升级从 harness 拉取。
