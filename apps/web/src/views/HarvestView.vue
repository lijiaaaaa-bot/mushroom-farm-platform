<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { canCorrectHarvest, currentUser } from '../auth';
import { errorText, http } from '../api';

interface Item {
  id: string;
  shedCode: string;
  cameraCode: string;
  matureCount: number;
  mushroomCount: number;
  recognizedAt: string;
}

interface EditableItem extends Item {
  draftMature: number;
  draftMushroom: number;
}

interface Daily {
  date: string;
  summary: { matureCount: number; mushroomCount: number; harvestableCameras: number };
  items: EditableItem[];
}

interface YieldDay {
  date: string;
  offsetDays: number;
  matureCount: number;
}

interface YieldEstimate {
  label: string;
  sufficient: boolean;
  requiredDays: number;
  historyDays: number;
  method: string;
  message: string | null;
  days: YieldDay[];
}

interface BucketForecast {
  label: string;
  sufficient: boolean;
  method: string;
  message: string | null;
  speedPerDay: number | null;
  days: YieldDay[];
}

interface HarvestTaskRow {
  id: string;
  shedCode: string;
  cameraCode: string;
  matureCount: number;
  mushroomCount: number;
  status: string;
  assignee: string | null;
  shift: string | null;
  note: string | null;
  draftAssignee: string;
  draftShift: string;
  draftStatus: string;
}

interface TaskList {
  date: string;
  schedule: { morning: number; afternoon: number; unassigned: number };
  sheds: Array<{ shedCode: string; matureCount: number; cameraCount: number }>;
  items: HarvestTaskRow[];
}

const date = ref(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date()));
const data = ref<Daily | null>(null);
const error = ref('');
const loading = ref(false);
const savingId = ref('');
const estimate = ref<YieldEstimate | null>(null);
const yieldError = ref('');
const yieldLoading = ref(false);
const forecast = ref<BucketForecast | null>(null);
const forecastError = ref('');
const tasks = ref<TaskList | null>(null);
const taskError = ref('');
const canCorrect = computed(() => canCorrectHarvest(currentUser.value?.role));

const STATUS_LABEL: Record<string, string> = {
  open: '待采',
  scheduled: '已排',
  done: '完成',
};

function withTaskDraft(item: Omit<HarvestTaskRow, 'draftAssignee' | 'draftShift' | 'draftStatus'>): HarvestTaskRow {
  return {
    ...item,
    draftAssignee: item.assignee ?? '',
    draftShift: item.shift ?? '',
    draftStatus: item.status,
  };
}

function asForecast(data: unknown): BucketForecast | null {
  if (!data || typeof data !== 'object' || !('sufficient' in data)) return null;
  return data as BucketForecast;
}

function asTasks(data: unknown): TaskList | null {
  if (!data || typeof data !== 'object' || !('schedule' in data)) return null;
  const payload = data as Omit<TaskList, 'items'> & { items?: Array<Omit<HarvestTaskRow, 'draftAssignee' | 'draftShift' | 'draftStatus'>> };
  return {
    ...payload,
    items: (payload.items ?? []).map(withTaskDraft),
  };
}

function withDraft(item: Item): EditableItem {
  return {
    ...item,
    draftMature: item.matureCount,
    draftMushroom: item.mushroomCount,
  };
}

async function loadEstimate() {
  yieldLoading.value = true;
  yieldError.value = '';
  try {
    const response = await http.get<YieldEstimate>('/harvest/yield-estimate');
    estimate.value = response.data;
  } catch (cause) {
    estimate.value = null;
    yieldError.value = errorText(cause);
  } finally {
    yieldLoading.value = false;
  }
}

async function loadForecast() {
  forecastError.value = '';
  try {
    const response = await http.get<unknown>('/harvest/bucket-forecast');
    forecast.value = asForecast(response.data);
  } catch (cause) {
    forecast.value = null;
    forecastError.value = errorText(cause);
  }
}

async function loadTasks() {
  taskError.value = '';
  try {
    const response = await http.get<unknown>('/harvest/tasks', { params: { date: date.value } });
    tasks.value = asTasks(response.data);
  } catch (cause) {
    tasks.value = null;
    taskError.value = errorText(cause);
  }
}

async function generateTasks() {
  taskError.value = '';
  try {
    const response = await http.post<unknown>('/harvest/tasks/generate', null, { params: { date: date.value } });
    tasks.value = asTasks(response.data);
  } catch (cause) {
    taskError.value = errorText(cause);
  }
}

async function saveTask(item: HarvestTaskRow) {
  taskError.value = '';
  try {
    await http.patch(`/harvest/tasks/${item.id}`, {
      assignee: item.draftAssignee,
      shift: item.draftShift,
      status: item.draftStatus,
    });
    await loadTasks();
  } catch (cause) {
    taskError.value = errorText(cause);
  }
}

async function reloadDay() {
  await load();
  await loadTasks();
}

async function load() {
  loading.value = true;
  error.value = '';
  try {
    const response = await http.get<{
      date: string;
      summary: Daily['summary'];
      items: Item[];
    }>('/harvest/daily', { params: { date: date.value } });
    data.value = {
      ...response.data,
      items: response.data.items.map(withDraft),
    };
  } catch (cause) {
    data.value = null;
    error.value = errorText(cause);
  } finally {
    loading.value = false;
  }
}

async function saveRow(item: EditableItem) {
  const matureCount = Number(item.draftMature);
  const mushroomCount = Number(item.draftMushroom);
  if (!Number.isInteger(matureCount) || matureCount < 0 || !Number.isInteger(mushroomCount) || mushroomCount < 0) {
    error.value = '成熟数与蘑菇数须为非负整数';
    return;
  }
  const body: { matureCount?: number; mushroomCount?: number } = {};
  if (matureCount !== item.matureCount) body.matureCount = matureCount;
  if (mushroomCount !== item.mushroomCount) body.mushroomCount = mushroomCount;
  if (body.matureCount === undefined && body.mushroomCount === undefined) return;

  error.value = '';
  savingId.value = item.id;
  try {
    await http.patch(`/harvest/daily/${item.id}`, body);
    await load();
    await loadEstimate();
  } catch (cause) {
    error.value = errorText(cause);
  } finally {
    savingId.value = '';
  }
}

onMounted(() => {
  void load();
  void loadEstimate();
  void loadForecast();
  void loadTasks();
});
</script>

<template>
  <section class="ops-page space-y-4">
    <section class="panel space-y-3" data-testid="yield-estimate">
      <h2 class="text-lg">近 2–3 日产量</h2>
      <p v-if="yieldLoading" class="text-mist">加载中…</p>
      <p v-else-if="yieldError" class="text-danger">{{ yieldError }}</p>
      <template v-else-if="estimate">
        <p class="text-sm">
          <span class="rounded bg-amber/15 px-2 py-0.5 font-semibold text-amber">{{ estimate.label }}</span>
        </p>
        <p v-if="!estimate.sufficient" class="text-sm text-mist">{{ estimate.message }}</p>
        <template v-else>
          <p class="text-sm text-mist">{{ estimate.method }}。依据近 {{ estimate.historyDays }} 日，满 {{ estimate.requiredDays }} 日。</p>
          <ul class="grid gap-3 sm:grid-cols-3">
            <li v-for="day in estimate.days" :key="day.date" class="rounded-lg border border-line px-3 py-2" data-testid="yield-day">
              <p class="text-sm text-mist">{{ day.date }}</p>
              <p class="font-mono text-2xl">{{ estimate.label }} {{ day.matureCount }}</p>
            </li>
          </ul>
        </template>
      </template>
    </section>
    <section class="panel space-y-3" data-testid="bucket-forecast">
      <h2 class="text-lg">近 2–3 日产量（日桶增速）</h2>
      <p v-if="forecastError" class="text-danger">{{ forecastError }}</p>
      <template v-else-if="forecast">
        <p class="text-sm">
          <span class="rounded bg-amber/15 px-2 py-0.5 font-semibold text-amber">{{ forecast.label }}</span>
        </p>
        <p v-if="!forecast.sufficient" class="text-sm text-mist">{{ forecast.message }}</p>
        <template v-else>
          <p class="text-sm text-mist">{{ forecast.method }}。每日增速 {{ forecast.speedPerDay }}。</p>
          <ul class="grid gap-3 sm:grid-cols-3">
            <li v-for="day in forecast.days" :key="day.date" class="rounded-lg border border-line px-3 py-2" data-testid="bucket-forecast-day">
              <p class="text-sm text-mist">{{ day.date }}</p>
              <p class="font-mono text-2xl">{{ forecast.label }} {{ day.matureCount }}</p>
            </li>
          </ul>
        </template>
      </template>
    </section>
    <section class="panel space-y-3" data-testid="harvest-tasks">
      <div class="flex flex-wrap items-center gap-3">
        <h2 class="text-lg">每日采摘任务清单</h2>
        <button v-if="canCorrect" class="btn-primary" type="button" @click="generateTasks">生成当日清单</button>
      </div>
      <p v-if="taskError" class="text-sm text-danger">{{ taskError }}</p>
      <template v-if="tasks">
        <p class="text-sm text-mist">
          排班辅助：上午 {{ tasks.schedule.morning }} 条，下午 {{ tasks.schedule.afternoon }} 条，未排 {{ tasks.schedule.unassigned }} 条。
        </p>
        <p v-if="!tasks.items.length" class="text-sm text-mist">当日无采摘任务。</p>
        <table v-else class="data-table">
          <thead>
            <tr>
              <th>棚区</th>
              <th>摄像头</th>
              <th>成熟</th>
              <th>人员</th>
              <th>班次</th>
              <th>状态</th>
              <th v-if="canCorrect"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in tasks.items" :key="item.id">
              <td>{{ item.shedCode }}</td>
              <td class="font-mono">{{ item.cameraCode }}</td>
              <td>{{ item.matureCount }}</td>
              <td>
                <input v-if="canCorrect" v-model="item.draftAssignee" class="field w-28" :aria-label="`${item.cameraCode} 采摘人员`" />
                <span v-else>{{ item.assignee || '—' }}</span>
              </td>
              <td>
                <select v-if="canCorrect" v-model="item.draftShift" class="field" :aria-label="`${item.cameraCode} 班次`">
                  <option value="">未排</option>
                  <option value="morning">上午</option>
                  <option value="afternoon">下午</option>
                </select>
                <span v-else>{{ item.shift === 'morning' ? '上午' : item.shift === 'afternoon' ? '下午' : '未排' }}</span>
              </td>
              <td>
                <select v-if="canCorrect" v-model="item.draftStatus" class="field">
                  <option value="open">待采</option>
                  <option value="scheduled">已排</option>
                  <option value="done">完成</option>
                </select>
                <span v-else>{{ STATUS_LABEL[item.status] || item.status }}</span>
              </td>
              <td v-if="canCorrect">
                <button class="btn-ghost" type="button" @click="saveTask(item)">保存排班</button>
              </td>
            </tr>
          </tbody>
        </table>
      </template>
    </section>
    <form class="flex flex-wrap items-end gap-3" @submit.prevent="reloadDay">
      <label class="text-sm">日期
        <input v-model="date" class="field mt-1" type="date" />
      </label>
      <button class="btn-primary" type="submit">查询</button>
    </form>
    <p v-if="loading" class="text-mist">加载中…</p>
    <p v-else-if="error && !data" class="text-danger">{{ error }}</p>
    <template v-else-if="data">
      <p v-if="!canCorrect" class="text-sm text-mist">当前角色不能修正采摘清单。</p>
      <p v-if="error" class="text-sm text-danger">{{ error }}</p>
      <div class="grid gap-3 sm:grid-cols-3">
        <article class="panel"><p class="text-mist">可采摄像头</p><p class="font-mono text-3xl">{{ data.summary.harvestableCameras }}</p></article>
        <article class="panel"><p class="text-mist">成熟数量</p><p class="font-mono text-3xl text-amber">{{ data.summary.matureCount }}</p></article>
        <article class="panel"><p class="text-mist">蘑菇数量</p><p class="font-mono text-3xl">{{ data.summary.mushroomCount }}</p></article>
      </div>
      <div class="panel overflow-x-auto">
        <p v-if="!data.items.length" class="text-mist">当日无识别记录。</p>
        <table v-else class="data-table">
          <thead>
            <tr>
              <th>棚区</th>
              <th>摄像头</th>
              <th>成熟</th>
              <th>总数</th>
              <th>最近识别</th>
              <th v-if="canCorrect"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in data.items" :key="item.id">
              <td>{{ item.shedCode }}</td>
              <td class="font-mono">{{ item.cameraCode }}</td>
              <td>
                <input
                  v-if="canCorrect"
                  v-model.number="item.draftMature"
                  class="field w-24"
                  type="number"
                  min="0"
                  step="1"
                  :aria-label="`${item.cameraCode} 成熟数`"
                />
                <span v-else>{{ item.matureCount }}</span>
              </td>
              <td>
                <input
                  v-if="canCorrect"
                  v-model.number="item.draftMushroom"
                  class="field w-24"
                  type="number"
                  min="0"
                  step="1"
                  :aria-label="`${item.cameraCode} 蘑菇数`"
                />
                <span v-else>{{ item.mushroomCount }}</span>
              </td>
              <td class="font-mono text-xs">{{ new Date(item.recognizedAt).toLocaleString('zh-CN') }}</td>
              <td v-if="canCorrect">
                <button
                  class="btn-ghost"
                  type="button"
                  :disabled="savingId === item.id"
                  @click="saveRow(item)"
                >保存</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </section>
</template>
