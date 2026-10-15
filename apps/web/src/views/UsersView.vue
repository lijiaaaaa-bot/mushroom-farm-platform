<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { ROLE_LABEL, ROLES, type Role } from '@mushroom/contracts';
import { errorText, http } from '../api';

interface UserRow {
  id: string;
  username: string;
  displayName: string;
  role: Role;
  shedCodes: string[];
  enabled: boolean;
}

interface UserWriteBody {
  username: string;
  password: string;
  displayName: string;
  role: Role;
  shedCodes: string[];
  resetPassword?: boolean;
}

const roles = ROLES;
const rows = ref<UserRow[]>([]);
const loadError = ref('');
const actionError = ref('');
const notice = ref('');
const loading = ref(true);
const highlightUsername = ref('');
const resetUsername = ref('');
const form = ref({
  username: '',
  password: '',
  displayName: '',
  role: 'viewer' as Role,
  shedCodes: '',
});
const resetForm = ref({
  password: '',
  displayName: '',
  role: 'viewer' as Role,
  shedCodes: '',
});

function roleText(role: Role) {
  return ROLE_LABEL[role] ?? role;
}

function shedText(codes: string[]) {
  return codes.length ? codes.join('、') : '全场';
}

function parseShedCodes(text: string) {
  return text
    .split(/[、,，\s]+/)
    .map((code) => code.trim())
    .filter(Boolean);
}

async function load() {
  loading.value = true;
  loadError.value = '';
  try {
    const response = await http.get<UserRow[]>('/users');
    rows.value = response.data;
    return true;
  } catch (cause) {
    loadError.value = errorText(cause);
    return false;
  } finally {
    loading.value = false;
  }
}

function clearSecrets() {
  form.value.password = '';
  resetForm.value.password = '';
}

async function createUser() {
  actionError.value = '';
  notice.value = '';
  highlightUsername.value = '';
  const username = form.value.username.trim();
  const body: UserWriteBody = {
    username,
    password: form.value.password,
    displayName: form.value.displayName.trim(),
    role: form.value.role,
    shedCodes: parseShedCodes(form.value.shedCodes),
  };
  try {
    await http.post('/users', body);
    clearSecrets();
    form.value.username = '';
    form.value.displayName = '';
    const ok = await load();
    if (!ok) return;
    const created = rows.value.find((row) => row.username === username);
    if (!created) {
      actionError.value = '新建后列表里没有这个账号。';
      return;
    }
    highlightUsername.value = username;
    notice.value = `已新建 ${username}。下方列表有这一行，没有密码。`;
  } catch (cause) {
    actionError.value = errorText(cause);
  }
}

function openReset(row: UserRow) {
  actionError.value = '';
  if (resetUsername.value === row.username) {
    resetUsername.value = '';
    resetForm.value.password = '';
    return;
  }
  resetUsername.value = row.username;
  resetForm.value = {
    password: '',
    displayName: row.displayName,
    role: row.role,
    shedCodes: row.shedCodes.join('、'),
  };
}

async function submitReset(row: UserRow) {
  actionError.value = '';
  notice.value = '';
  highlightUsername.value = '';
  const body: UserWriteBody = {
    username: row.username,
    password: resetForm.value.password,
    displayName: resetForm.value.displayName.trim(),
    role: resetForm.value.role,
    shedCodes: parseShedCodes(resetForm.value.shedCodes),
    resetPassword: true,
  };
  try {
    await http.post('/users', body);
    clearSecrets();
    resetUsername.value = '';
    const ok = await load();
    if (!ok) return;
    const saved = rows.value.find((item) => item.username === row.username);
    if (!saved) {
      actionError.value = '重设后列表里没有这个账号。';
      return;
    }
    highlightUsername.value = row.username;
    notice.value = `已重设 ${row.username} 的密码。下方列表仍有这一行。`;
  } catch (cause) {
    actionError.value = errorText(cause);
  }
}

onMounted(load);
</script>

<template>
  <div class="space-y-4">
    <form class="panel grid gap-3 md:grid-cols-6" data-testid="user-create-form" @submit.prevent="createUser">
      <h2 class="text-lg md:col-span-6">新建用户</h2>
      <p class="text-sm text-mist md:col-span-6">棚号空着表示全场。多个棚号用顿号分开。用户名已存在时不会另建一行。</p>
      <input v-model="form.username" class="field" aria-label="用户名" placeholder="用户名" minlength="2" required autocomplete="off" />
      <input v-model="form.password" class="field" type="password" aria-label="密码" placeholder="密码" minlength="6" required autocomplete="new-password" />
      <input v-model="form.displayName" class="field" aria-label="显示名" placeholder="显示名" required />
      <select v-model="form.role" class="field" aria-label="角色">
        <option v-for="role in roles" :key="role" :value="role">{{ ROLE_LABEL[role] }}</option>
      </select>
      <input v-model="form.shedCodes" class="field" aria-label="棚号" placeholder="棚号" autocomplete="off" />
      <button class="btn-primary" type="submit" data-testid="user-create">新建</button>
    </form>
    <p v-if="notice" class="text-sm" data-testid="user-notice">{{ notice }}</p>
    <p v-if="actionError" class="text-sm text-danger" data-testid="user-action-error">{{ actionError }}</p>
    <section class="panel overflow-x-auto">
      <h2 class="mb-3 text-lg">用户</h2>
      <p v-if="loading" class="text-mist">加载中…</p>
      <p v-else-if="loadError" class="text-danger">{{ loadError }}</p>
      <p v-else-if="!rows.length" class="text-mist">没有用户。</p>
      <table v-else class="data-table">
        <thead>
          <tr>
            <th>用户名</th>
            <th>显示名</th>
            <th>角色</th>
            <th>棚区</th>
            <th>状态</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <template v-for="row in rows" :key="row.id">
            <tr
              :data-user-id="row.id"
              :data-highlight="row.username === highlightUsername ? 'true' : undefined"
            >
              <td class="font-mono">{{ row.username }}</td>
              <td>{{ row.displayName }}</td>
              <td>{{ roleText(row.role) }}</td>
              <td class="font-mono">{{ shedText(row.shedCodes) }}</td>
              <td>{{ row.enabled ? '启用' : '停用' }}</td>
              <td>
                <button
                  class="btn-primary"
                  type="button"
                  :aria-label="`${row.username} 重设密码`"
                  @click="openReset(row)"
                >重设密码</button>
              </td>
            </tr>
            <tr v-if="resetUsername === row.username">
              <td colspan="6">
                <form class="grid gap-3 py-2 md:grid-cols-5" data-testid="user-reset-form" @submit.prevent="submitReset(row)">
                  <input v-model="resetForm.password" class="field" type="password" aria-label="新密码" placeholder="新密码" minlength="6" required autocomplete="new-password" />
                  <input v-model="resetForm.displayName" class="field" aria-label="重设显示名" placeholder="显示名" required />
                  <select v-model="resetForm.role" class="field" aria-label="重设角色">
                    <option v-for="role in roles" :key="role" :value="role">{{ ROLE_LABEL[role] }}</option>
                  </select>
                  <input v-model="resetForm.shedCodes" class="field" aria-label="重设棚号" placeholder="棚号" autocomplete="off" />
                  <button class="btn-primary" type="submit" data-testid="user-reset-submit">重设密码</button>
                </form>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </section>
  </div>
</template>
