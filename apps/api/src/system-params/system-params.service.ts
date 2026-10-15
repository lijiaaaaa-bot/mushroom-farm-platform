import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  SYSTEM_PARAM_DEFAULTS,
  SYSTEM_PARAM_KEYS,
  SYSTEM_PARAM_LABEL,
  formatSystemParamValue,
  type PatchSystemParams,
  type SystemParamChange,
  type SystemParamKey,
  type SystemParams,
  type SystemParamsPatchResult,
} from '@mushroom/contracts';
import { AuthUser } from '../common/auth-user';
import { SystemParam } from '../entities/system-param.entity';

@Injectable()
export class SystemParamsService {
  constructor(
    @InjectRepository(SystemParam)
    private readonly rows: Repository<SystemParam>,
  ) {}

  async current(): Promise<SystemParams> {
    const row = await this.rows.findOne({ where: { id: 1 } });
    if (!row) return this.defaults();
    return this.toPublic(row);
  }

  async patch(
    input: PatchSystemParams,
    actor: AuthUser,
  ): Promise<SystemParamsPatchResult> {
    const before = await this.current();
    const next: Record<SystemParamKey, number> = {
      imageRetentionDays: before.imageRetentionDays,
      timeseriesRetentionDays: before.timeseriesRetentionDays,
      alertUnreadPollSeconds: before.alertUnreadPollSeconds,
    };
    const changes: SystemParamChange[] = [];
    for (const key of SYSTEM_PARAM_KEYS) {
      const value = input[key];
      if (value === undefined || value === before[key]) continue;
      changes.push({
        key,
        label: SYSTEM_PARAM_LABEL[key],
        beforeText: formatSystemParamValue(key, before[key]),
        afterText: formatSystemParamValue(key, value),
      });
      next[key] = value;
    }
    if (!changes.length) throw new BadRequestException('没有改动');
    const saved = await this.rows.save(
      this.rows.create({
        id: 1,
        imageRetentionDays: next.imageRetentionDays,
        timeseriesRetentionDays: next.timeseriesRetentionDays,
        alertUnreadPollSeconds: next.alertUnreadPollSeconds,
        updatedAt: new Date(),
        updatedBy: actor.username,
      }),
    );
    return { ...this.toPublic(saved), changes };
  }

  private defaults(): SystemParams {
    return {
      imageRetentionDays: SYSTEM_PARAM_DEFAULTS.imageRetentionDays,
      timeseriesRetentionDays: SYSTEM_PARAM_DEFAULTS.timeseriesRetentionDays,
      alertUnreadPollSeconds: SYSTEM_PARAM_DEFAULTS.alertUnreadPollSeconds,
      updatedAt: null,
      updatedBy: null,
    };
  }

  private toPublic(row: SystemParam): SystemParams {
    return {
      imageRetentionDays: row.imageRetentionDays,
      timeseriesRetentionDays: row.timeseriesRetentionDays,
      alertUnreadPollSeconds: row.alertUnreadPollSeconds,
      updatedAt: row.updatedAt ? row.updatedAt.toISOString() : null,
      updatedBy: row.updatedBy,
    };
  }
}
