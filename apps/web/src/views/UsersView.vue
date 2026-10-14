<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { ROLE_LABEL, type Role } from '@mushroom/contracts';
import { errorText, http } from '../api';

interface UserRow {
  id: string;
  username: string;
  displayName: string;
  role: Role;
  shedCodes: string[];
  enabled: boolean;
}

const rows = ref<UserRow[]>([]);
const error = ref('');
const loading = ref(true);

function roleText(role: Role) {
  return ROLE_LABEL[role] ?? role;
}

function shedText(codes: string[]) {
  return codes.length ? codes.join('、') : '全场';
}

onMounted(async () => {
  try {
    const response = await http.get<UserRow[]>('/users');
    rows.value = response.data;
  } catch (cause) {
    error.value = errorText(cause);
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <section class="panel overflow-x-auto">
    <h2 class="mb-3 text-lg">用户</h2>
    <p v-if="loading" class="text-mist">加载中…</p>
    <p v-else-if="error" class="text-danger">{{ error }}</p>
    <p v-else-if="!rows.length" class="text-mist">没有用户。</p>
    <table v-else class="data-table">
      <thead>
        <tr>
          <th>用户名</th>
          <th>显示名</th>
          <th>角色</th>
          <th>棚区</th>
          <th>状态</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="row.id">
          <td class="font-mono">{{ row.username }}</td>
          <td>{{ row.displayName }}</td>
          <td>{{ roleText(row.role) }}</td>
          <td class="font-mono">{{ shedText(row.shedCodes) }}</td>
          <td>{{ row.enabled ? '启用' : '停用' }}</td>
        </tr>
      </tbody>
    </table>
  </section>
</template>
