<script setup lang="ts">
import { ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { errorText } from '../api';
import { login } from '../auth';

const router = useRouter();
const route = useRoute();
const username = ref('admin');
const password = ref('');
const error = ref('');
const loading = ref(false);

async function submit() {
  error.value = '';
  loading.value = true;
  try {
    await login(username.value.trim(), password.value);
    const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : '/';
    await router.push(redirect);
  } catch (cause) {
    error.value = errorText(cause);
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="grid min-h-screen place-items-center px-4">
    <form class="panel w-full max-w-md space-y-4" @submit.prevent="submit">
      <p class="text-xs tracking-[0.2em] text-accent">EDGE AI RESULTS IN</p>
      <h1 class="text-2xl font-semibold">食用菌种植管理平台</h1>
      <p class="text-sm text-mist">管理端只接收已有边缘识别结果，不在这里做图像推理。</p>
      <label class="block text-sm">
        用户名
        <input v-model="username" class="field mt-1" autocomplete="username" />
      </label>
      <label class="block text-sm">
        密码
        <input v-model="password" class="field mt-1" type="password" autocomplete="current-password" />
      </label>
      <p v-if="error" class="text-sm text-danger">{{ error }}</p>
      <button class="btn-primary w-full" :disabled="loading" type="submit">
        {{ loading ? '登录中…' : '进入管理台' }}
      </button>
      <p class="text-xs text-mist">开发种子账号 admin / Admin@123456</p>
    </form>
  </div>
</template>
