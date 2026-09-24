-- Reads use metric_buckets_hour / metric_buckets_day. Writers no longer
-- merge into daily_aggregates, so the table is unused.
DROP TABLE IF EXISTS daily_aggregates;
