<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { canConfigureSheds, currentUser } from '../auth';
import { errorText, http } from '../api';

interface Shed {
  id: string;
  code: string;
  name: string;
  location: string | null;
  mapX: number | null;
  mapY: number | null;
}

interface EditableShed extends Shed {
  draftX: string | number;
  draftY: string | number;
}

const rows = ref<EditableShed[]>([]);
const error = ref('');
const loading = ref(true);
const canWrite = computed(() => canConfigureSheds(currentUser.value?.role));

function coordText(value: number | null) {
  return value === null || value === undefined ? '' : String(value);
}

function withDraft(shed: Shed): EditableShed {
  return {
    ...shed,
    mapX: shed.mapX ?? null,
    mapY: shed.mapY ?? null,
    draftX: coordText(shed.mapX),
    draftY: coordText(shed.mapY),
  };
}

function displayCoord(value: number | null) {
  return value === null || value === undefined ? '未配置' : String(value);
}

function parseCoord(value: string | number | null): number | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('坐标须为数字');
    return value;
  }
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) throw new Error('坐标须为数字');
  return parsed;
}

async function load() {
  loading.value = true;
  error.value = '';
  try {
    const response = await http.get<Shed[]>('/sheds');
    rows.value = response.data.map(withDraft);
  } catch (cause) {
    error.value = errorText(cause);
  } finally {
    loading.value = false;
  }
}

async function saveRow(row: EditableShed) {
  error.value = '';
  let mapX: number | null;
  let mapY: number | null;
  try {
    mapX = parseCoord(row.draftX);
    mapY = parseCoord(row.draftY);
  } catch (cause) {
    error.value = errorText(cause);
    return;
  }
  try {
    await http.patch(`/sheds/${row.id}`, { mapX, mapY });
    await load();
  } catch (cause) {
    error.value = errorText(cause);
  }
}

onMounted(load);
</script>

<template>
  <section class="panel overflow-x-auto">
    <h2 class="mb-3 text-lg">棚区</h2>
    <p v-if="!canWrite" class="mb-3 text-sm text-mist">当前角色只能查看棚区坐标。</p>
    <p v-if="loading && !rows.length" class="text-mist">加载中…</p>
    <p v-else-if="error && !rows.length" class="text-danger">{{ error }}</p>
    <p v-else-if="!error && !rows.length" class="text-mist">当前账号没有可见棚区。</p>
    <p v-if="error && rows.length" class="mb-3 text-sm text-danger">{{ error }}</p>
    <table v-if="rows.length" class="data-table">
      <thead>
        <tr>
          <th>棚区</th>
          <th>编号</th>
          <th>位置</th>
          <th>平面 X</th>
          <th>平面 Y</th>
          <th v-if="canWrite"></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="row.id">
          <td>{{ row.name }}</td>
          <td class="font-mono">{{ row.code }}</td>
          <td>{{ row.location || '未填位置' }}</td>
          <td>
            <input
              v-if="canWrite"
              v-model="row.draftX"
              class="field w-24"
              type="number"
              min="0"
              max="100"
              step="any"
              :aria-label="`${row.name} 平面 X`"
            />
            <span v-else class="font-mono">{{ displayCoord(row.mapX) }}</span>
          </td>
          <td>
            <input
              v-if="canWrite"
              v-model="row.draftY"
              class="field w-24"
              type="number"
              min="0"
              max="100"
              step="any"
              :aria-label="`${row.name} 平面 Y`"
            />
            <span v-else class="font-mono">{{ displayCoord(row.mapY) }}</span>
          </td>
          <td v-if="canWrite">
            <button class="btn-ghost" type="button" @click="saveRow(row)">保存坐标</button>
          </td>
        </tr>
      </tbody>
    </table>
  </section>
</template>
