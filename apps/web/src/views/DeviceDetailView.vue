<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  ALERT_LEVEL_LABEL,
  ALERT_STATUS_LABEL,
  DEVICE_TYPE_LABEL,
  type AlertLevel,
  type AlertStatus,
  type DeviceType,
} from '@mushroom/contracts';
import { canRegisterDevices, currentUser } from '../auth';
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
}

interface AlertRow {
  id: string;
  title: string;
  level: AlertLevel;
  status: AlertStatus;
  cameraCode: string | null;
  createdAt: string;
}

const route = useRoute();
const router = useRouter();
const device = ref<DeviceRow | null>(null);
const alerts = ref<AlertRow[]>([]);
const loading = ref(true);
const error = ref('');
const alertsError = ref('');
const alertsTruncated = ref(false);
const draftNote = ref('');
const draftStatus = ref<'online' | 'offline'>('offline');
const saving = ref(false);
const stopping = ref(false);
const deleting = ref(false);
const gone = ref(false);
const formError = ref('');
const canEdit = computed(() => canRegisterDevices(currentUser.value?.role));

const deviceId = computed(() => {
  const value = route.params.id;
  return typeof value === 'string' ? value : '';
});

function statusText(onlineStatus: string) {
  if (onlineStatus === 'online') return '在线';
  if (onlineStatus === 'offline') return '离线';
  return onlineStatus || '—';
}

function enabledText(enabled: boolean | undefined) {
  return enabled === false ? '停用' : '启用';
}

function clock(value: string | null | undefined) {
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

function lensCode(row: DeviceRow) {
  return row.type === 'camera' ? row.code : '—';
}

function syncDraft(row: DeviceRow) {
  draftNote.value = row.note ?? '';
  draftStatus.value = row.onlineStatus === 'online' ? 'online' : 'offline';
}

async function saveEdit() {
  if (!device.value) return;
  formError.value = '';
  saving.value = true;
  const id = device.value.id;
  try {
    await http.patch(`/devices/${encodeURIComponent(id)}`, {
      note: draftNote.value,
      onlineStatus: draftStatus.value,
    });
    const response = await http.get<DeviceRow>(`/devices/${encodeURIComponent(id)}`);
    device.value = response.data;
    syncDraft(response.data);
  } catch (cause) {
    formError.value = errorText(cause);
  } finally {
    saving.value = false;
  }
}

async function removeDevice() {
  if (!device.value || gone.value) return;
  formError.value = '';
  deleting.value = true;
  const id = device.value.id;
  try {
    await http.delete(`/devices/${encodeURIComponent(id)}`);
    gone.value = true;
    await router.push('/devices');
  } catch (cause) {
    formError.value = errorText(cause);
  } finally {
    deleting.value = false;
  }
}

async function setEnabled(enabled: boolean) {
  if (!device.value) return;
  formError.value = '';
  stopping.value = true;
  const id = device.value.id;
  try {
    await http.patch(`/devices/${encodeURIComponent(id)}`, { enabled });
    const response = await http.get<DeviceRow>(`/devices/${encodeURIComponent(id)}`);
    device.value = response.data;
    syncDraft(response.data);
  } catch (cause) {
    formError.value = errorText(cause);
  } finally {
    stopping.value = false;
  }
}

watch(
  deviceId,
  async (id) => {
    if (gone.value) return;
    device.value = null;
    alerts.value = [];
    error.value = '';
    alertsError.value = '';
    alertsTruncated.value = false;
    if (!id) {
      error.value = '缺少设备编号';
      loading.value = false;
      return;
    }
    loading.value = true;
    try {
      const response = await http.get<DeviceRow>(`/devices/${encodeURIComponent(id)}`);
      device.value = response.data;
      syncDraft(response.data);
    } catch (cause) {
      error.value = errorText(cause);
      loading.value = false;
      return;
    }
    if (device.value.type === 'camera') {
      try {
        const response = await http.get<{ items: AlertRow[]; total: number }>(
          '/alerts',
          { params: { cameraCode: device.value.code, pageSize: 100 } },
        );
        const items = Array.isArray(response.data.items) ? response.data.items : [];
        alerts.value = items;
        const total = Number(response.data.total);
        alertsTruncated.value = Number.isFinite(total) && total > items.length;
      } catch (cause) {
        alertsError.value = errorText(cause);
      }
    }
    loading.value = false;
  },
  { immediate: true },
);
</script>

<template>
  <section class="ops-page panel bg-white">
    <p class="mb-3 text-sm">
      <router-link class="text-accent" to="/devices" data-testid="device-back">返回设备列表</router-link>
    </p>
    <h2 class="text-lg">镜头详情</h2>
    <p v-if="loading" class="text-mist">加载中…</p>
    <p v-else-if="error" class="text-sm text-danger" data-testid="device-detail-error">{{ error }}</p>
    <template v-else-if="device">
      <dl class="mt-3 space-y-2 text-sm" data-testid="device-detail">
        <div>
          <span class="text-mist">镜头码</span>
          <span class="font-mono" data-field="lens-code">{{ lensCode(device) }}</span>
        </div>
        <div>
          <span class="text-mist">编号</span>
          <span class="font-mono" data-field="code">{{ device.code }}</span>
        </div>
        <div>
          <span class="text-mist">名称</span>
          <span data-field="name">{{ device.name }}</span>
        </div>
        <div>
          <span class="text-mist">类型</span>
          <span data-field="type">{{ DEVICE_TYPE_LABEL[device.type] }}</span>
        </div>
        <div>
          <span class="text-mist">棚区</span>
          <span data-field="shed">{{ device.shedCode }}</span>
        </div>
        <div>
          <span class="text-mist">状态</span>
          <span data-field="status">{{ statusText(device.onlineStatus) }}</span>
        </div>
        <div>
          <span class="text-mist">启用</span>
          <span data-field="enabled">{{ enabledText(device.enabled) }}</span>
        </div>
        <div>
          <span class="text-mist">备注</span>
          <span data-field="note">{{ device.note || '—' }}</span>
        </div>
        <div>
          <span class="text-mist">最近心跳</span>
          <span class="font-mono" data-field="heartbeat">{{ clock(device.lastHeartbeatAt || device.lastSeenAt) }}</span>
        </div>
      </dl>
      <form
        v-if="canEdit"
        class="mt-4 grid gap-3 sm:grid-cols-2"
        data-testid="device-edit"
        @submit.prevent="saveEdit"
      >
        <label class="text-sm">状态
          <select v-model="draftStatus" class="field mt-1" aria-label="编辑状态">
            <option value="online">在线</option>
            <option value="offline">离线</option>
          </select>
        </label>
        <label class="text-sm">备注
          <input v-model="draftNote" class="field mt-1" aria-label="编辑备注" maxlength="500" />
        </label>
        <p class="text-sm text-mist sm:col-span-2">
          保存后备注和状态留在这一页。返回设备列表也能看到。最近心跳不在这里改。
        </p>
        <button class="btn-primary w-fit" type="submit" :disabled="saving">
          {{ saving ? '保存中…' : '保存' }}
        </button>
      </form>
        <p v-if="formError" class="mt-2 text-sm text-danger" data-testid="device-edit-error">{{ formError }}</p>
      <p v-if="canEdit && device.type === 'camera'" class="mt-4 text-sm">
        <button
          class="btn-ghost"
          type="button"
          data-testid="device-enabled"
          :disabled="stopping"
          @click="setEnabled(device.enabled === false)"
        >{{ stopping ? '保存中…' : device.enabled === false ? '启用' : '停用' }}</button>
        <span class="ml-2 text-mist">停用后这一页和设备列表仍能打开这台。在线状态、备注和最近心跳不动。</span>
      </p>
      <p v-if="canEdit" class="mt-4 text-sm">
        <button
          class="btn-ghost"
          type="button"
          data-testid="device-delete"
          :disabled="deleting"
          @click="removeDevice"
        >{{ deleting ? '删除中…' : '删除' }}</button>
        <span class="ml-2 text-mist">删除后回到设备列表。这一台不再出现。告警和识别仍按镜头码留着。</span>
      </p>
      <section v-if="device.type === 'camera'" class="mt-4" data-testid="device-alerts">
        <h3 class="mb-2 text-sm">相关告警</h3>
        <p v-if="alertsError" class="text-sm text-danger" data-testid="device-alerts-error">{{ alertsError }}</p>
        <template v-else>
          <p v-if="alertsTruncated" class="mb-2 text-sm text-danger" data-testid="device-alerts-truncated">相关告警未取全</p>
          <p v-if="!alerts.length && !alertsTruncated" class="text-sm text-mist">暂无相关告警</p>
          <table v-if="alerts.length" class="data-table">
            <thead>
              <tr>
                <th>标题</th>
                <th>级别</th>
                <th>状态</th>
                <th>时间</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in alerts" :key="row.id" :data-alert-id="row.id">
                <td>
                  <router-link
                    class="text-accent"
                    :to="`/alerts/${row.id}`"
                    data-field="alert-title"
                  >{{ row.title }}</router-link>
                </td>
                <td data-field="alert-level">{{ ALERT_LEVEL_LABEL[row.level] }}</td>
                <td data-field="alert-status">{{ ALERT_STATUS_LABEL[row.status] }}</td>
                <td class="font-mono text-xs" data-field="alert-time">{{ clock(row.createdAt) }}</td>
              </tr>
            </tbody>
          </table>
        </template>
      </section>
    </template>
  </section>
</template>
