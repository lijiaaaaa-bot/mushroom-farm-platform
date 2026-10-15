import { FindOperator } from 'typeorm';
import { MinioStorageService } from '../storage';
import { SystemParamsService } from '../system-params';
import { RetentionService } from './retention.service';

function cutoffOf(value: unknown): number {
  expect(value).toBeInstanceOf(FindOperator);
  const date = (value as FindOperator<Date>).value as Date;
  return date.getTime();
}

describe('retention reads system params', () => {
  it('purges images and series with the stored day counts', async () => {
    const found: unknown[] = [];
    const deleted: unknown[] = [];
    const environmentDeleted: unknown[] = [];
    const records = {
      find: async (options: { where: { recognizedAt: unknown } }) => {
        found.push(options.where.recognizedAt);
        return [];
      },
      delete: async (options: { recognizedAt: unknown }) => {
        deleted.push(options.recognizedAt);
        return { affected: 0 };
      },
      save: async () => [],
    };
    const readings = {
      delete: async (options: { observedAt: unknown }) => {
        environmentDeleted.push(options.observedAt);
        return { affected: 0 };
      },
    };
    const params = {
      current: async () => ({
        imageRetentionDays: 10,
        timeseriesRetentionDays: 40,
        alertUnreadPollSeconds: 15,
        updatedAt: null,
        updatedBy: null,
      }),
    };
    const service = new RetentionService(
      records as never,
      readings as never,
      { remove: async () => undefined } as unknown as MinioStorageService,
      params as SystemParamsService,
    );

    const started = Date.now();
    await service.purgeOnce();
    const day = 24 * 60 * 60 * 1000;
    expect(Math.abs(cutoffOf(found[0]) - (started - 10 * day))).toBeLessThan(
      5_000,
    );
    expect(Math.abs(cutoffOf(deleted[0]) - (started - 40 * day))).toBeLessThan(
      5_000,
    );
    expect(
      Math.abs(cutoffOf(environmentDeleted[0]) - (started - 40 * day)),
    ).toBeLessThan(5_000);
  });
});
