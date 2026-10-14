export const DISEASE_LEVEL_OPTIONS = [
  { value: '0', label: '无' },
  { value: '1', label: '轻度' },
  { value: '2', label: '中度' },
  { value: '3', label: '严重' },
] as const;

export function diseaseLevelLabel(level: number): string {
  return DISEASE_LEVEL_OPTIONS.find((item) => item.value === String(level))?.label ?? String(level);
}

export function diseaseLevelText(level: number): string {
  const label = diseaseLevelLabel(level);
  return label === String(level) ? String(level) : `${label}（${level}）`;
}

export function shanghaiStamp(value: string | null | undefined): string {
  if (!value) return '—';
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return '—';
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(parsed));
  const read = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${read('year')}-${read('month')}-${read('day')} ${read('hour')}:${read('minute')}`;
}
