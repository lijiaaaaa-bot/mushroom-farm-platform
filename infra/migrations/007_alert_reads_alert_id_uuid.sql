-- 已上线库的 alert_reads.alert_id 是 varchar，alerts.id 是 uuid。
-- 未读查询 left join 会报 operator does not exist: character varying = uuid。
-- 新库由 002 直接建 uuid，这里直接返回。空值和非法文本删掉后再转换，避免 ALTER 失败。
DO $$
DECLARE
  col_type text;
BEGIN
  SELECT c.udt_name
    INTO col_type
  FROM information_schema.columns AS c
  WHERE c.table_schema = current_schema()
    AND c.table_name = 'alert_reads'
    AND c.column_name = 'alert_id';

  IF col_type IS NULL THEN
    RAISE EXCEPTION 'alert_reads.alert_id is missing';
  END IF;

  IF col_type = 'uuid' THEN
    RETURN;
  END IF;

  DELETE FROM alert_reads
  WHERE alert_id IS NULL
     OR btrim(alert_id) = ''
     OR btrim(alert_id) !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

  DELETE FROM alert_reads AS extra
  USING alert_reads AS keep
  WHERE extra.ctid > keep.ctid
    AND extra.user_id = keep.user_id
    AND lower(btrim(extra.alert_id)) = lower(btrim(keep.alert_id));

  ALTER TABLE alert_reads
    ALTER COLUMN alert_id TYPE uuid USING btrim(alert_id)::uuid;
END $$;
