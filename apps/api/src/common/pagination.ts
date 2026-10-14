export function parsePage(query: { page?: string; pageSize?: string }): {
  page: number;
  pageSize: number;
  skip: number;
} {
  const page = Math.max(1, Number.parseInt(query.page || '1', 10) || 1);
  const pageSize = Math.min(
    100,
    Math.max(1, Number.parseInt(query.pageSize || '20', 10) || 20),
  );
  return { page, pageSize, skip: (page - 1) * pageSize };
}

export interface ListQuery {
  page?: string;
  pageSize?: string;
  shedCode?: string;
  cameraCode?: string;
  /** 设备主键。列表按该设备的编号匹配告警的摄像头或传感器。 */
  deviceId?: string;
  sensorCode?: string;
  /** 与 sensorCode 相同，按环境读数上的设备编号精确匹配。 */
  deviceCode?: string;
  status?: string;
  level?: string;
  type?: string;
  from?: string;
  to?: string;
  date?: string;
  online?: string;
  q?: string;
  /** `1` or `true` keeps rows with diseaseCount > 0. */
  diseased?: string;
}
