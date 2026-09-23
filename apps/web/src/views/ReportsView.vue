<script setup lang="ts">
import { ref } from 'vue';
import { errorText, http } from '../api';

const error = ref('');
const emptyNote = ref('');
const files = [
  ['growth.xlsx', '生长'],
  ['disease.xlsx', '病害'],
  ['env.xlsx', '环境'],
  ['devices.xlsx', '设备'],
  ['alerts.xlsx', '告警'],
] as const;

async function download(path: string) {
  error.value = '';
  emptyNote.value = '';
  try {
    const response = await http.get<Blob>(`/reports/${path}`, { responseType: 'blob' });
    const blob = response.data;
    if (!blob || blob.size === 0) {
      emptyNote.value = '该报表没有可导出的数据。';
      return;
    }
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = path;
    link.click();
    URL.revokeObjectURL(url);
  } catch (cause) {
    error.value = errorText(cause);
  }
}
</script>

<template>
  <section class="panel space-y-3">
    <h2 class="text-lg">Excel 报表</h2>
    <p class="text-sm text-mist">生长、病害、环境默认导出近 7 日识别记录；设备与告警导出当前可见范围。</p>
    <div class="flex flex-wrap gap-2">
      <button v-for="[file, label] in files" :key="file" class="btn-primary" type="button" @click="download(file)">
        下载{{ label }}
      </button>
    </div>
    <p v-if="emptyNote" class="text-sm text-mist">{{ emptyNote }}</p>
    <p v-if="error" class="text-sm text-danger">{{ error }}</p>
  </section>
</template>
