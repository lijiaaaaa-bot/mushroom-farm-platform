import { createHmac } from 'node:crypto';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export const ALERT_WEBHOOK_POST = 'ALERT_WEBHOOK_POST';

export interface SevereAlertNotice {
  id?: string;
  level: string;
  shedCode: string;
  cameraCode?: string | null;
  title: string;
  message: string;
}

export interface AlertWebhookRequest {
  channel: 'wecom' | 'dingtalk';
  url: string;
  body: unknown;
}

export type AlertWebhookPost = (request: AlertWebhookRequest) => Promise<void>;

export interface AlertPushChannels {
  wecomEnabled: boolean;
  dingtalkEnabled: boolean;
}

const guardLog = new Logger('SevereAlertPush');

/** 推送失败只记日志。调用方的告警保存、认领、关闭不因这里拒绝。 */
export async function deliverSevereAlert(
  push: { pushIfSevere(alert: SevereAlertNotice): Promise<void> } | undefined,
  alert: SevereAlertNotice,
): Promise<void> {
  if (!push) return;
  try {
    await push.pushIfSevere(alert);
  } catch (error) {
    guardLog.error(
      `严重告警推送未完成 alert=${alert.id ?? ''} ${safeError(error)}`,
    );
  }
}

export function dingtalkSignedUrl(
  webhookUrl: string,
  secret: string,
  timestamp = Date.now(),
): string {
  const stamp = String(timestamp);
  const sign = encodeURIComponent(
    createHmac('sha256', secret).update(`${stamp}\n${secret}`).digest('base64'),
  );
  const join = webhookUrl.includes('?') ? '&' : '?';
  return `${webhookUrl}${join}timestamp=${stamp}&sign=${sign}`;
}

export async function postAlertWebhook(
  request: AlertWebhookRequest,
): Promise<void> {
  const response = await fetch(request.url, {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify(request.body),
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
}

@Injectable()
export class SevereAlertPushService {
  private readonly logger = new Logger(SevereAlertPushService.name);

  constructor(
    @Optional() private readonly config?: ConfigService,
    @Optional()
    @Inject(ALERT_WEBHOOK_POST)
    private readonly post?: AlertWebhookPost,
  ) {}

  channels(): AlertPushChannels {
    return {
      wecomEnabled: this.webhookUrl('wecom') !== null,
      dingtalkEnabled: this.webhookUrl('dingtalk') !== null,
    };
  }

  async pushIfSevere(alert: SevereAlertNotice): Promise<void> {
    try {
      await this.dispatch(alert);
    } catch (error) {
      this.logger.error(
        `严重告警推送未完成 alert=${alert.id ?? ''} ${safeError(error)}`,
      );
    }
  }

  private async dispatch(alert: SevereAlertNotice): Promise<void> {
    if (alert.level !== 'severe') return;
    const text = noticeText(alert);
    const jobs: Array<Promise<void>> = [];
    const wecom = this.webhookUrl('wecom');
    if (wecom) {
      jobs.push(
        this.send('wecom', alert, wecom, {
          msgtype: 'text',
          text: { content: text },
        }),
      );
    }
    const dingtalk = this.webhookUrl('dingtalk');
    if (dingtalk) {
      const secret = this.setting(
        'dingtalkWebhookSecret',
        'DINGTALK_WEBHOOK_SECRET',
      );
      const url = secret ? dingtalkSignedUrl(dingtalk, secret) : dingtalk;
      jobs.push(
        this.send('dingtalk', alert, url, {
          msgtype: 'text',
          text: { content: text },
        }),
      );
    }
    if (!jobs.length) return;
    await Promise.allSettled(jobs);
  }

  private async send(
    channel: 'wecom' | 'dingtalk',
    alert: SevereAlertNotice,
    url: string,
    body: unknown,
  ): Promise<void> {
    try {
      const post = this.post ?? postAlertWebhook;
      await post({ channel, url, body });
    } catch (error) {
      this.logger.error(
        `严重告警推送失败 channel=${channel} alert=${alert.id ?? ''} ${safeError(error)}`,
      );
    }
  }

  private webhookUrl(channel: 'wecom' | 'dingtalk'): string | null {
    const url =
      channel === 'wecom'
        ? this.setting('wecomWebhookUrl', 'WECOM_WEBHOOK_URL')
        : this.setting('dingtalkWebhookUrl', 'DINGTALK_WEBHOOK_URL');
    if (!url) return null;
    if (!isHttpUrl(url)) {
      this.logger.error(
        `严重告警推送跳过 channel=${channel}：webhook 不是 http(s) 地址`,
      );
      return null;
    }
    return url;
  }

  private setting(configKey: string, envKey: string): string {
    const fromConfig = this.config?.get<string | undefined>(configKey);
    if (typeof fromConfig === 'string') return fromConfig.trim();
    return (process.env[envKey] ?? '').trim();
  }
}

function noticeText(alert: SevereAlertNotice): string {
  const camera = alert.cameraCode
    ? `摄像头 ${alert.cameraCode}`
    : '未指定摄像头';
  return [
    `【严重告警】${alert.title}`,
    `棚区 ${alert.shedCode} ${camera}`,
    alert.message,
    alert.id ? `告警 ${alert.id}` : '',
  ]
    .filter((line) => line.length > 0)
    .join('\n')
    .slice(0, 1800);
}

function isHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

function safeError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw.replace(/https?:\/\/\S+/g, '[url]').slice(0, 300);
}
