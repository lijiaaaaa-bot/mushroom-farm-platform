<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ROLE_LABEL, type Role } from '@mushroom/contracts';
import { currentUser, logout } from '../auth';

const route = useRoute();
const router = useRouter();
const open = ref(false);
const links = [
  { to: '/', label: '总览' },
  { to: '/big-screen', label: '菇棚监测' },
  { to: '/devices', label: '设备' },
  { to: '/recognitions', label: '识别记录' },
  { to: '/alerts', label: '告警' },
  { to: '/alert-rules', label: '阈值规则' },
  { to: '/harvest', label: '采摘' },
  { to: '/reports', label: '报表' },
  { to: '/sheds', label: '棚区' },
  { to: '/audit', label: '审计' },
];
const phase2 = [
  { to: '/phase2/big-screen', label: '大屏' },
  { to: '/phase2/trends', label: '趋势' },
  { to: '/phase2/yield', label: '产量预估' },
  { to: '/phase2/wecom', label: '企微' },
];
const roleLabel = computed(() => {
  const role = currentUser.value?.role;
  return role ? ROLE_LABEL[role as Role] : '';
});

function leave() {
  logout();
  void router.push('/login');
}
</script>

<template>
  <div class="min-h-screen md:grid md:grid-cols-[240px_1fr]">
    <aside
      class="border-b border-line bg-ink/80 md:border-b-0 md:border-r"
      :class="open ? 'block' : 'hidden md:block'"
    >
      <div class="px-5 py-6">
        <p class="text-xs tracking-[0.2em] text-accent">MUSHROOM OPS</p>
        <h1 class="mt-1 text-lg font-semibold">食用菌种植管理</h1>
      </div>
      <nav class="space-y-1 px-3 pb-6">
        <router-link
          v-for="link in links"
          :key="link.to"
          :to="link.to"
          class="block rounded-lg px-3 py-2 text-sm text-mist hover:bg-panel hover:text-white"
          exact-active-class="!bg-panel !text-accent"
          @click="open = false"
        >
          {{ link.label }}
        </router-link>
        <p class="px-3 pt-4 text-xs text-mist/70">二期槽位</p>
        <router-link
          v-for="link in phase2"
          :key="link.to"
          :to="link.to"
          class="block rounded-lg px-3 py-2 text-sm text-mist hover:bg-panel hover:text-white"
          @click="open = false"
        >
          {{ link.label }}
        </router-link>
      </nav>
    </aside>
    <div>
      <header class="flex items-center justify-between border-b border-line px-4 py-3 md:px-6">
        <button class="btn-ghost md:hidden" type="button" @click="open = !open">菜单</button>
        <p class="text-sm text-mist">{{ route.meta.title }}</p>
        <div class="flex items-center gap-3 text-sm">
          <span>{{ currentUser?.displayName }} · {{ roleLabel }}</span>
          <button class="btn-ghost" type="button" @click="leave">退出</button>
        </div>
      </header>
      <main class="p-4 md:p-6">
        <router-view />
      </main>
    </div>
  </div>
</template>
