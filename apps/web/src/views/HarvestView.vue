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

const date = ref(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date()));
const data = ref<Daily | null>(null);
const error = ref('');
const loading = ref(false);
const savingId = ref('');
const canCorrect = computed(() => canCorrectHarvest(currentUser.value?.role));

function withDraft(item: Item): EditableItem {
  return {
    ...item,
    draftMature: item.matureCount,
    draftMushroom: item.mushroomCount,
  };
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
  } catch (cause) {
    error.value = errorText(cause);
  } finally {
    savingId.value = '';
  }
}

onMounted(load);
</script>

<template>
  <section class="ops-page space-y-4">
    <form class="flex flex-wrap items-end gap-3" @submit.prevent="load">
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
