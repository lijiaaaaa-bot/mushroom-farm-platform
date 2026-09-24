import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { Repository } from 'typeorm';
import { shanghaiDate, shanghaiDayRange } from '@mushroom/contracts';
import { AuthUser } from '../common/auth-user';
import { ShedScope } from '../common/shed-scope';
import {
  FLUSH_PHASES,
  FlushBatch,
  FlushPhase,
  FlushPhaseEvent,
} from '../entities/flush-batch.entity';
import { MetricBucketDay } from '../entities/metric-bucket.entity';
import {
  METRIC_CAP_DIAMETER_MEAN,
  METRIC_MATURE_COUNT,
  METRIC_MUSHROOM_COUNT,
} from '../growth';
import { curveFromDayBuckets } from './flush-curve';

const CURVE_METRICS = [
  METRIC_MUSHROOM_COUNT,
  METRIC_MATURE_COUNT,
  METRIC_CAP_DIAMETER_MEAN,
];

@Injectable()
export class BatchService {
  constructor(
    @InjectRepository(FlushBatch)
    private readonly batches: Repository<FlushBatch>,
    @InjectRepository(FlushPhaseEvent)
    private readonly events: Repository<FlushPhaseEvent>,
    @InjectRepository(MetricBucketDay)
    private readonly dayBuckets: Repository<MetricBucketDay>,
  ) {}

  async create(
    user: AuthUser,
    input: {
      shedCode: string;
      batchCode: string;
      startedAt?: string;
      note?: string;
    },
  ) {
    const shedCode = input.shedCode.trim();
    const batchCode = input.batchCode.trim();
    if (!shedCode || !batchCode) {
      throw new BadRequestException('棚区与批次编号不能为空');
    }
    ShedScope.fromUser(user).assert(shedCode);
    const startedAt = parseWhen(input.startedAt, '开始时间无效');
    const duplicate = await this.batches.findOne({
      where: { shedCode, batchCode },
    });
    if (duplicate) throw new ConflictException('该棚已有相同批次编号');
    const now = new Date();
    const batch = await this.batches.save(
      this.batches.create({
        id: randomUUID(),
        shedCode,
        batchCode,
        startedAt,
        phase: 'flush',
        closedAt: null,
        note: blank(input.note),
        createdAt: now,
        updatedAt: now,
      }),
    );
    const event = await this.events.save(
      this.events.create({
        id: randomUUID(),
        batchId: batch.id,
        phase: 'flush',
        occurredAt: startedAt,
        note: blank(input.note),
        recordedBy: user.username,
        createdAt: now,
      }),
    );
    return { batch: toBatch(batch), event: toEvent(event) };
  }

  async list(user: AuthUser, shedCode?: string) {
    const scope = ShedScope.fromUser(user);
    const filter = shedCode?.trim() || '';
    if (filter) scope.assert(filter);
    const rows = await this.batches.find({ order: { startedAt: 'DESC' } });
    const items = rows
      .filter((row) => scope.allows(row.shedCode))
      .filter((row) => !filter || row.shedCode === filter)
      .map(toBatch);
    return { items };
  }

  async get(user: AuthUser, id: string) {
    const batch = await this.requireBatch(user, id);
    const events = await this.eventsFor(batch.id);
    return { batch: toBatch(batch), events: events.map(toEvent) };
  }

  async recordPhase(
    user: AuthUser,
    id: string,
    input: { phase: string; occurredAt?: string; note?: string },
  ) {
    const phase = parsePhase(input.phase);
    const batch = await this.requireBatch(user, id);
    if (batch.closedAt)
      throw new BadRequestException('批次已结束，不能再记阶段');
    const occurredAt = parseWhen(input.occurredAt, '阶段时间无效');
    if (occurredAt.getTime() < new Date(batch.startedAt).getTime()) {
      throw new BadRequestException('阶段时间不能早于批次开始');
    }
    const now = new Date();
    const event = await this.events.save(
      this.events.create({
        id: randomUUID(),
        batchId: batch.id,
        phase,
        occurredAt,
        note: blank(input.note),
        recordedBy: user.username,
        createdAt: now,
      }),
    );
    batch.phase = phase;
    batch.updatedAt = now;
    await this.batches.save(batch);
    return { batch: toBatch(batch), event: toEvent(event) };
  }

  async close(user: AuthUser, id: string, closedAt?: string) {
    const batch = await this.requireBatch(user, id);
    const when = parseWhen(closedAt, '结束时间无效');
    if (when.getTime() < new Date(batch.startedAt).getTime()) {
      throw new BadRequestException('结束时间不能早于批次开始');
    }
    batch.closedAt = when;
    batch.updatedAt = new Date();
    await this.batches.save(batch);
    return { batch: toBatch(batch) };
  }

  async replay(user: AuthUser, id: string) {
    const batch = await this.requireBatch(user, id);
    const events = await this.eventsFor(batch.id);
    const end = batch.closedAt ? new Date(batch.closedAt) : new Date();
    const start = shanghaiDayRange(
      shanghaiDate(new Date(batch.startedAt)),
    ).start;
    const endExclusive = shanghaiDayRange(shanghaiDate(end)).end;
    const rows = await this.dayBuckets
      .createQueryBuilder('b')
      .where('b.bucketStart >= :start AND b.bucketStart < :end', {
        start,
        end: endExclusive,
      })
      .andWhere('b.shedCode = :shedCode', { shedCode: batch.shedCode })
      .andWhere('b.cameraCode = :camera', { camera: '' })
      .andWhere('b.metric IN (:...metrics)', { metrics: CURVE_METRICS })
      .getMany();
    return {
      batch: toBatch(batch),
      phases: events.map(toEvent),
      curve: curveFromDayBuckets(
        rows.filter(
          (row) =>
            row.shedCode === batch.shedCode &&
            row.cameraCode === '' &&
            (CURVE_METRICS as readonly string[]).includes(row.metric),
        ),
      ),
    };
  }

  private async requireBatch(user: AuthUser, id: string) {
    const batch = await this.batches.findOne({ where: { id } });
    if (!batch) throw new NotFoundException('批次不存在');
    ShedScope.fromUser(user).assert(batch.shedCode);
    return batch;
  }

  private async eventsFor(batchId: string) {
    const rows = await this.events.find({ where: { batchId } });
    return rows.sort(
      (a, b) =>
        new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime(),
    );
  }
}

function parsePhase(value: string): FlushPhase {
  if ((FLUSH_PHASES as readonly string[]).includes(value)) {
    return value as FlushPhase;
  }
  throw new BadRequestException('阶段只支持出菇、快速生长、成熟');
}

function parseWhen(value: string | undefined, message: string): Date {
  if (!value) return new Date();
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return shanghaiDayRange(value).start;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new BadRequestException(message);
  return date;
}

function blank(value: string | undefined): string | null {
  const text = value?.trim();
  return text ? text : null;
}

function toBatch(batch: FlushBatch) {
  return {
    id: batch.id,
    shedCode: batch.shedCode,
    batchCode: batch.batchCode,
    startedAt: new Date(batch.startedAt).toISOString(),
    phase: batch.phase,
    closedAt: batch.closedAt ? new Date(batch.closedAt).toISOString() : null,
    note: batch.note,
  };
}

function toEvent(event: FlushPhaseEvent) {
  return {
    id: event.id,
    batchId: event.batchId,
    phase: event.phase,
    occurredAt: new Date(event.occurredAt).toISOString(),
    note: event.note,
    recordedBy: event.recordedBy,
  };
}
