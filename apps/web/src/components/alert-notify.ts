import { ALERT_LEVEL_LABEL, type AlertLevel } from '@mushroom/contracts';

/** 顶栏未读轮询间隔。不用 SSE/WebSocket。 */
export const UNREAD_POLL_MS = 15_000;

export interface UnreadAlertItem {
  id: string;
  level: AlertLevel;
  shedCode: string;
  createdAt: string;
  title: string;
  message: string;
}

export function formatAlertTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const pick = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '';
  return `${pick('month')}-${pick('day')} ${pick('hour')}:${pick('minute')}`;
}

/** 仅在已授权时弹浏览器通知。拒绝、缺失或构造失败都吞掉。 */
export function notifyFreshAlerts(items: UnreadAlertItem[]): void {
  try {
    if (typeof Notification === 'undefined') return;
    if (Notification.permission !== 'granted') return;
    for (const item of items) {
      const level = ALERT_LEVEL_LABEL[item.level] ?? item.level;
      new Notification(`${level} · ${item.shedCode}`, {
        body: item.title || item.message,
      });
    }
  } catch {
    // 权限被拒或浏览器拦截时只保留站内列表
  }
}

export async function requestAlertNotificationPermission(): Promise<void> {
  try {
    if (typeof Notification === 'undefined') return;
    await Notification.requestPermission();
  } catch {
    // 用户拒绝或浏览器抛错时不向上抛
  }
}
