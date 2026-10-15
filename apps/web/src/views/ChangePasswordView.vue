<script setup lang="ts">
import { computed, ref } from 'vue';
import { ROLE_LABEL, type Role } from '@mushroom/contracts';
import { errorText, http } from '../api';
import { currentUser } from '../auth';

const current = ref('');
const next = ref('');
const confirm = ref('');
const saving = ref(false);
const done = ref(false);
const actionError = ref('');
const notice = ref('');

const roleLabel = computed(() => {
  const role = currentUser.value?.role;
  return role ? ROLE_LABEL[role as Role] : '';
});

async function submit() {
  actionError.value = '';
  notice.value = '';
  const currentPassword = current.value;
  const newPassword = next.value;
  if (!currentPassword) {
    actionError.value = '请输入当前密码';
    done.value = false;
    return;
  }
  if (newPassword.length < 6) {
    actionError.value = '新密码至少 6 位';
    done.value = false;
    return;
  }
  if (newPassword !== confirm.value) {
    actionError.value = '两次新密码不一致';
    done.value = false;
    return;
  }
  if (newPassword === currentPassword) {
    actionError.value = '新密码不能与当前密码相同';
    done.value = false;
    return;
  }
  saving.value = true;
  try {
    await http.post('/auth/change-password', { currentPassword, newPassword });
    done.value = true;
    notice.value = '密码已修改。';
    current.value = '';
    next.value = '';
    confirm.value = '';
  } catch (cause) {
    done.value = false;
    actionError.value = errorText(cause);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <section class="panel max-w-lg space-y-4">
    <h2 class="text-lg">修改密码</h2>
    <p class="text-sm" data-testid="password-self-account">
      当前账号 {{ currentUser?.username || '—' }}<span v-if="roleLabel"> · {{ roleLabel }}</span>
    </p>
    <p class="text-sm text-mist" data-testid="password-self-contrast">
      只改当前登录的账号。改密之后，旧密码不能登录，新密码可以登录。
    </p>
    <form class="space-y-3" data-testid="password-self-form" @submit.prevent="submit">
      <label class="block text-sm">
        当前密码
        <input
          v-model="current"
          class="field mt-1"
          type="password"
          autocomplete="current-password"
          aria-label="当前密码"
          data-testid="password-self-current"
        />
      </label>
      <label class="block text-sm">
        新密码
        <input
          v-model="next"
          class="field mt-1"
          type="password"
          minlength="6"
          autocomplete="new-password"
          aria-label="新密码"
          data-testid="password-self-new"
        />
      </label>
      <label class="block text-sm">
        确认新密码
        <input
          v-model="confirm"
          class="field mt-1"
          type="password"
          minlength="6"
          autocomplete="new-password"
          aria-label="确认新密码"
          data-testid="password-self-confirm"
        />
      </label>
      <button class="btn-primary" type="submit" data-testid="password-self-submit" :disabled="saving">
        {{ saving ? '提交中…' : '修改密码' }}
      </button>
    </form>
    <p v-if="notice" class="text-sm font-medium" data-testid="password-self-notice">{{ notice }}</p>
    <div v-if="done" data-testid="password-self-result" data-highlight="true">
      <p class="text-sm" data-testid="password-self-old">旧密码：不能登录</p>
      <p class="text-sm text-accent" data-testid="password-self-new-result">新密码：可以登录</p>
    </div>
    <p v-if="actionError" class="text-sm text-danger" data-testid="password-self-error">{{ actionError }}</p>
  </section>
</template>

<style scoped>
div[data-highlight='true'] {
  background: #fff7e6;
  outline: 2px solid #f59e0b;
  outline-offset: 6px;
}
</style>
