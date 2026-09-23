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
