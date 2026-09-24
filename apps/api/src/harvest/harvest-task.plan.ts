import {
  HarvestShift,
  HarvestTask,
  HarvestTaskStatus,
} from '../entities/harvest-task.entity';

export interface HarvestPick {
  shedCode: string;
  cameraCode: string;
  matureCount: number;
  mushroomCount: number;
}

export interface TaskPlan {
  upserts: HarvestTask[];
  removeIds: string[];
}

export function scheduleAssist(
  tasks: Array<{ shift: string | null; status: string }>,
) {
  return {
    morning: tasks.filter((task) => task.shift === 'morning').length,
    afternoon: tasks.filter((task) => task.shift === 'afternoon').length,
    unassigned: tasks.filter((task) => !task.shift && task.status !== 'done')
      .length,
  };
}

/**
 * 成熟数大于 0 的摄像头进入当日清单。
 * 已有任务只更新数量，保留班次与人员。
 * 不再成熟、且仍是未排的待采任务才从清单去掉。
 */
export function planHarvestTasks(
  existing: HarvestTask[],
  picks: HarvestPick[],
  create: (pick: HarvestPick) => HarvestTask,
): TaskPlan {
  const byKey = new Map(
    existing.map((task) => [`${task.shedCode}|${task.cameraCode}`, task]),
  );
  const keep = new Set<string>();
  const upserts: HarvestTask[] = [];
  for (const pick of picks) {
    if (pick.matureCount <= 0) continue;
    const key = `${pick.shedCode}|${pick.cameraCode}`;
    keep.add(key);
    const prev = byKey.get(key);
    if (prev) {
      prev.matureCount = pick.matureCount;
      prev.mushroomCount = pick.mushroomCount;
      upserts.push(prev);
    } else {
      upserts.push(create(pick));
    }
  }
  const removeIds = existing
    .filter((task) => {
      const key = `${task.shedCode}|${task.cameraCode}`;
      return (
        !keep.has(key) &&
        task.status === 'open' &&
        !task.assignee &&
        !task.shift
      );
    })
    .map((task) => task.id);
  return { upserts, removeIds };
}

export function nextTaskStatus(input: {
  current: HarvestTaskStatus;
  assignee: string | null;
  shift: HarvestShift | null;
  requested?: HarvestTaskStatus;
}): HarvestTaskStatus {
  if (input.requested) return input.requested;
  if (input.current === 'open' && (input.assignee || input.shift)) {
    return 'scheduled';
  }
  return input.current;
}
