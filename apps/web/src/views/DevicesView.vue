<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { DEVICE_TYPE_LABEL, type DeviceType } from '@mushroom/contracts';
import { canImportDevices, canRegisterDevices, currentUser } from '../auth';
import { errorText, http } from '../api';

interface DeviceRow {
  id: string;
  code: string;
  name: string;
  type: DeviceType;
  shedCode: string;
  onlineStatus: string;
  lastSeenAt: string | null;
  lastHeartbeatAt?: string | null;
  note: string | null;
  enabled?: boolean;
  draftNote: string;
  draftStatus: 'online' | 'offline';
}

interface ImportMessage {
  row: number;
  reason: string;
}

interface ImportReport {
  successCount: number;
  failCount: number;
  skippedCount: number;
  errors: ImportMessage[];
  skipped: ImportMessage[];
}

const route = useRoute();
const router = useRouter();
const rows = ref<DeviceRow[]>([]);
const listTotal = ref(0);
const loading = ref(true);
const error = ref('');
const csvText = ref('');
const file = ref<File | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);
const importing = ref(false);
const report = ref<ImportReport | null>(null);
const canImport = computed(() => canImportDevices(currentUser.value?.role));
const canRegister = computed(() => canRegisterDevices(currentUser.value?.role));
const cameraCode = ref('');
const shedCode = ref('S01');
const cameraName = ref('');
const cameraNote = ref('');
const registering = ref(false);
const savingId = ref('');
const formError = ref('');
const createdCamera = ref<{ id: string; code: string } | null>(null);

function onlineQuery(): '' | 'online' | 'offline' {
  const value = route.query.online;
  return value === 'online' || value === 'offline' ? value : '';
}

const onlineFilter = ref<'' | 'online' | 'offline'>(onlineQuery());
const onlineScope = computed(() => onlineFilter.value);

function deviceListPath() {
  const online = onlineFilter.value;
  if (!online) return '/devices?pageSize=100';
  return `/devices?pageSize=100&online=${online}`;
}

function replaceOnlineQuery(value: '' | 'online' | 'offline') {
  if (value === onlineQuery()) return;
  const query: Record<string, string> = {};
  for (const [key, raw] of Object.entries(route.query)) {
    if (key === 'online' || typeof raw !== 'string' || !raw) continue;
    query[key] = raw;
  }
  if (value) query.online = value;
  void router.replace({ path: route.path, query });
}

async function load() {
  loading.value = true;
  error.value = '';
  rows.value = [];
  try {
    const response = await http.get<{
      items: Omit<DeviceRow, 'draftNote' | 'draftStatus'>[];
      total?: number;
    }>(deviceListPath());
    rows.value = response.data.items.map((row) => ({
      ...row,
      note: row.note ?? null,
      draftNote: row.note ?? '',
      draftStatus: row.onlineStatus === 'online' ? 'online' : 'offline',
    }));
    const total = Number(response.data.total);
    listTotal.value = Number.isFinite(total) ? total : rows.value.length;
  } catch (cause) {
    error.value = errorText(cause);
  } finally {
    loading.value = false;
  }
}

function onFile(event: Event) {
  const input = event.target as HTMLInputElement;
  file.value = input.files?.[0] ?? null;
}

function clearFile() {
  file.value = null;
  if (fileInput.value) fileInput.value.value = '';
}

async function submitImport() {
  error.value = '';
  if (!file.value && !csvText.value.trim()) {
    error.value = '请选择 CSV 文件或粘贴内容';
    return;
  }
  importing.value = true;
  try {
    const response = file.value
      ? await http.post<ImportReport>('/devices/import', fileBody(file.value))
      : await http.post<ImportReport>('/devices/import', { csv: csvText.value });
    report.value = response.data;
    csvText.value = '';
    clearFile();
    await load();
  } catch (cause) {
    error.value = errorText(cause);
  } finally {
    importing.value = false;
  }
}

async function registerCamera() {
  formError.value = '';
  registering.value = true;
  const code = cameraCode.value.trim();
  try {
    const response = await http.post<{ id: string }>('/devices', {
      code,
      name: cameraName.value.trim(),
      type: 'camera',
      shedCode: shedCode.value.trim(),
      note: cameraNote.value.trim() || undefined,
    });
    createdCamera.value = response.data?.id ? { id: response.data.id, code } : null;
    cameraCode.value = '';
    cameraName.value = '';
    cameraNote.value = '';
    await load();
  } catch (cause) {
    formError.value = errorText(cause);
  } finally {
    registering.value = false;
  }
}

async function saveEdit(row: DeviceRow) {
  formError.value = '';
  savingId.value = row.id;
  try {
    await http.patch(`/devices/${row.id}`, {
      note: row.draftNote,
      onlineStatus: row.draftStatus,
    });
    await load();
  } catch (cause) {
    formError.value = errorText(cause);
  } finally {
    savingId.value = '';
  }
}

async function setEnabled(row: DeviceRow, enabled: boolean) {
  formError.value = '';
  savingId.value = row.id;
  try {
    await http.patch(`/devices/${row.id}`, { enabled });
    await load();
  } catch (cause) {
    formError.value = errorText(cause);
  } finally {
    savingId.value = '';
  }
}

async function removeDevice(row: DeviceRow) {
  formError.value = '';
  savingId.value = row.id;
  try {
    await http.delete(`/devices/${encodeURIComponent(row.id)}`);
    if (createdCamera.value?.id === row.id) createdCamera.value = null;
    await load();
  } catch (cause) {
    formError.value = errorText(cause);
  } finally {
    savingId.value = '';
  }
}

function enabledText(enabled: boolean | undefined) {
  return enabled === false ? '停用' : '启用';
}

function fileBody(selected: File) {
  const body = new FormData();
  body.append('file', selected);
  return body;
}

function heartbeatText(row: DeviceRow): string {
  const value = row.lastHeartbeatAt || row.lastSeenAt;
  if (!value) return '—';
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function lensCode(row: DeviceRow): string {
  return row.type === 'camera' ? row.code : '—';
}

function detailHref(id: string): string {
  return `/devices/${encodeURIComponent(id)}`;
}

function alertHref(code: string): string {
  return `/alerts?cameraCode=${encodeURIComponent(code)}`;
}

function recognitionHref(code: string): string {
  return `/recognitions?cameraCode=${encodeURIComponent(code)}`;
}

watch(onlineFilter, (value) => {
  void load();
  replaceOnlineQuery(value);
});

watch(
  () => (typeof route.query.online === 'string' ? route.query.online : ''),
  () => {
    const next = onlineQuery();
    if (next !== onlineFilter.value) onlineFilter.value = next;
  },
);

onMounted(load);
</script>

<template>
  <div class="ops-page space-y-4">
    <section class="panel space-y-3">
      <h2 class="text-lg">批量导入</h2>
      <p v-if="canImport" class="text-sm text-mist">
        表头需包含设备编码、棚编码、名称。未填类型时记为摄像头。已存在的设备编码会跳过，不覆盖原档案。失败行号按数据行计算，不含表头。选择文件时以文件为准。
      </p>
      <p v-else class="text-sm text-mist">当前角色不能批量导入设备。</p>
      <form
        v-if="canImport"
        class="grid gap-3"
        data-testid="device-import-form"
        @submit.prevent="submitImport"
      >
        <input
          ref="fileInput"
          class="text-sm"
          type="file"
          accept=".csv,text/csv"
          aria-label="CSV 文件"
          @change="onFile"
        />
        <textarea
          v-model="csvText"
          class="field min-h-28 font-mono"
          aria-label="粘贴 CSV"
          placeholder="或粘贴 CSV"
        />
        <button class="btn-primary w-fit" type="submit" :disabled="importing">
          {{ importing ? '导入中…' : '导入' }}
        </button>
      </form>
      <p v-if="report" data-testid="import-report">
        成功 {{ report.successCount }}，失败 {{ report.failCount }}，跳过 {{ report.skippedCount }}
      </p>
      <ul v-if="report?.errors.length" class="space-y-1 text-sm text-danger">
        <li v-for="item in report.errors" :key="`e-${item.row}-${item.reason}`">
          第 {{ item.row }} 行：{{ item.reason }}
        </li>
      </ul>
      <ul v-if="report?.skipped.length" class="space-y-1 text-sm text-mist">
        <li v-for="item in report.skipped" :key="`s-${item.row}-${item.reason}`">
          第 {{ item.row }} 行：{{ item.reason }}
        </li>
      </ul>
    </section>
    <section class="panel space-y-3">
      <h2 class="text-lg">登记摄像头</h2>
      <p v-if="canRegister" class="text-sm text-mist">
        编号、棚区、名称必填。备注可空。登记后出现在下方列表，镜头码进入详情。新建是离线、启用。这一行可以改备注和状态，保存不写心跳。摄像头可以停用，档案仍在。也可以删除。删除后这一行从列表消失，详情不再打开。告警和识别仍按镜头码留着。
      </p>
      <p v-else class="text-sm text-mist">当前角色不能登记摄像头。</p>
      <form
        v-if="canRegister"
        class="grid gap-3 sm:grid-cols-4"
        data-testid="camera-register-form"
        @submit.prevent="registerCamera"
      >
        <label class="text-sm">编号
          <input v-model="cameraCode" class="field mt-1" aria-label="摄像头编号" required />
        </label>
        <label class="text-sm">棚区
          <input v-model="shedCode" class="field mt-1" aria-label="棚区" required />
        </label>
        <label class="text-sm">名称
          <input v-model="cameraName" class="field mt-1" aria-label="名称" required />
        </label>
        <label class="text-sm">备注
          <input v-model="cameraNote" class="field mt-1" aria-label="登记备注" maxlength="500" />
        </label>
        <button class="btn-primary sm:col-span-4 w-fit" type="submit" :disabled="registering">
          {{ registering ? '登记中…' : '登记' }}
        </button>
      </form>
      <p v-if="createdCamera" class="text-sm" data-testid="camera-created">
        已登记 <span class="font-mono">{{ createdCamera.code }}</span>。下方列表有这一行。
        <a
          class="text-accent"
          :href="detailHref(createdCamera.id)"
          data-testid="camera-created-detail"
        >打开详情</a>
      </p>
      <p v-if="formError" class="text-sm text-danger">{{ formError }}</p>
    </section>
    <section class="panel overflow-x-auto">
      <h2 class="mb-3 text-lg">摄像头 / AI 盒 / 传感器</h2>
      <div class="mb-3 flex flex-wrap gap-3">
        <label class="text-sm">状态
          <select v-model="onlineFilter" class="field mt-1" data-testid="device-online-filter">
            <option value="">全部</option>
            <option value="online">在线</option>
            <option value="offline">离线</option>
          </select>
        </label>
      </div>
      <p v-if="onlineScope && !loading" class="mb-3 text-sm" data-testid="device-online-scope">
        {{ onlineScope === 'online' ? '在线' : '离线' }} {{ listTotal }} 台
      </p>
      <p class="mb-3 text-sm text-mist">
        摄像头这一行的镜头码与编号相同。点镜头码进入这台摄像头的详情。告警列表按这个镜头码筛选，识别记录也按它打开。传感器和 AI 盒的镜头码是「—」。表上方的状态下拉选「在线」或「离线」后，列表只留这一类，地址栏带上 online。选「全部」则不传。没有匹配时写「没有符合条件的设备。」，不留下上一次的表。能改档案时，备注和状态下拉在这一行，提交后列表重新读取。停用只改启用标记，不改在线状态、备注和最近心跳。停用后这一行还在，详情仍可打开。删除会去掉这一行档案。列表和详情都不再有这一台。告警和识别仍按镜头码留着。
      </p>
      <p v-if="loading" class="text-mist">加载中…</p>
      <p v-else-if="error" class="text-danger">{{ error }}</p>
      <p v-else-if="!rows.length" class="text-mist" data-testid="device-list-empty">
        {{ onlineFilter ? '没有符合条件的设备。' : '暂无设备。识别上报会自动建档。' }}
      </p>
      <table v-else class="data-table">
        <thead>
          <tr>
            <th>镜头码</th><th>编号</th><th>名称</th><th>类型</th><th>棚区</th><th>状态</th><th>启用</th><th>备注</th><th>最近心跳</th><th>相关</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="row.id" :data-code="row.code">
            <td class="font-mono" data-field="lens-code">
              <a
                v-if="row.type === 'camera'"
                class="text-accent"
                :href="detailHref(row.id)"
                data-field="detail-link"
              >{{ lensCode(row) }}</a>
              <template v-else>{{ lensCode(row) }}</template>
            </td>
            <td class="font-mono" data-field="code">{{ row.code }}</td>
            <td data-field="name">{{ row.name }}</td>
            <td data-field="type">{{ DEVICE_TYPE_LABEL[row.type] }}</td>
            <td data-field="shed">{{ row.shedCode }}</td>
            <td data-field="status">
              <span
                class="inline-flex rounded-lg bg-canvas px-2 py-0.5"
                :class="row.onlineStatus === 'online' ? 'text-accent' : 'text-mist'"
              >{{ row.onlineStatus === 'online' ? '在线' : '离线' }}</span>
            </td>
            <td data-field="enabled">{{ enabledText(row.enabled) }}</td>
            <td>
              <form
                v-if="canRegister"
                class="flex flex-wrap items-center gap-2"
                :data-testid="`device-edit-${row.code}`"
                @submit.prevent="saveEdit(row)"
              >
                <select
                  v-model="row.draftStatus"
                  class="field w-24"
                  :aria-label="`状态 ${row.code}`"
                >
                  <option value="online">在线</option>
                  <option value="offline">离线</option>
                </select>
                <input
                  v-model="row.draftNote"
                  class="field"
                  :aria-label="`备注 ${row.code}`"
                  maxlength="500"
                />
                <button class="btn-ghost" type="submit" :disabled="savingId === row.id">
                  {{ savingId === row.id ? '保存中…' : '保存' }}
                </button>
              </form>
              <span v-else>{{ row.note || '—' }}</span>
            </td>
            <td class="font-mono text-xs" data-field="heartbeat">{{ heartbeatText(row) }}</td>
            <td data-field="correlate">
              <template v-if="row.type === 'camera'">
                <a class="text-accent" :href="detailHref(row.id)" data-field="detail-entry">详情</a>
                <a class="ml-2 text-accent" :href="alertHref(row.code)" data-field="alert-link">告警</a>
                <a class="ml-2 text-accent" :href="recognitionHref(row.code)" data-field="recognition-link">识别</a>
                <button
                  v-if="canRegister"
                  class="ml-2 text-accent"
                  type="button"
                  :data-testid="`device-enabled-${row.code}`"
                  :disabled="savingId === row.id"
                  @click="setEnabled(row, row.enabled === false)"
                >{{ row.enabled === false ? '启用' : '停用' }}</button>
                <button
                  v-if="canRegister"
                  class="ml-2 text-accent"
                  type="button"
                  :data-testid="`device-delete-${row.code}`"
                  :disabled="savingId === row.id"
                  @click="removeDevice(row)"
                >删除</button>
              </template>
              <button
                v-else-if="canRegister"
                class="text-accent"
                type="button"
                :data-testid="`device-delete-${row.code}`"
                :disabled="savingId === row.id"
                @click="removeDevice(row)"
              >删除</button>
              <span v-else>—</span>
            </td>
          </tr>
        </tbody>
      </table>
    </section>
  </div>
</template>
