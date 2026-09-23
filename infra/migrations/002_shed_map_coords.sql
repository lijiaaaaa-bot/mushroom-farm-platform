-- 棚区平面坐标（百分比 0–100）。列已存在时本文件仍可再执行，不改已有数据。
ALTER TABLE sheds ADD COLUMN IF NOT EXISTS map_x double precision;
ALTER TABLE sheds ADD COLUMN IF NOT EXISTS map_y double precision;
