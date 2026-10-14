<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ROLE_LABEL, type Role } from '@mushroom/contracts';
import { currentUser, logout, readSessionRole } from '../auth';
import AlertInbox from '../components/AlertInbox.vue';
import { visibleNav } from '../nav';

const route = useRoute();
const router = useRouter();
const open = ref(false);
const links = computed(() => visibleNav(currentUser.value?.role ?? readSessionRole()));
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
  <div class="admin-shell flex min-h-screen flex-col bg-canvas text-ink" data-theme="farm-ops-light">
    <header class="admin-topbar flex items-center gap-3 border-b border-line bg-white px-3 py-2 md:px-4">
      <button class="btn-ghost md:hidden" type="button" @click="open = !open">菜单</button>
      <p class="truncate text-sm font-semibold text-ink">食用菌种植管理</p>
      <p class="hidden text-sm text-mist sm:block">{{ route.meta.title }}</p>
      <div class="ml-auto flex items-center gap-2 text-sm">
        <router-link class="btn-ghost" to="/big-screen">基地大屏</router-link>
        <router-link class="btn-ghost" to="/duty-screen">值班看板</router-link>
        <AlertInbox />
        <span class="hidden text-mist lg:inline">{{ currentUser?.displayName }} · {{ roleLabel }}</span>
        <button class="btn-ghost" type="button" @click="leave">退出</button>
      </div>
    </header>
    <div class="min-h-0 flex-1 bg-canvas md:grid md:grid-cols-[188px_1fr]">
      <aside
        class="admin-sidebar border-line bg-sidebar text-ink md:sticky md:top-0 md:block md:max-h-screen md:overflow-y-auto md:border-r"
        :class="open ? 'block border-b' : 'hidden'"
      >
        <nav class="space-y-0.5 p-2">
          <router-link
            v-for="link in links"
            :key="link.to"
            :to="link.to"
            class="flex items-center rounded-md px-2.5 py-1.5 text-[13px] text-ink hover:bg-canvas"
            exact-active-class="!bg-sidebar-active"
            @click="open = false"
          >
            <span>{{ link.label }}</span>
          </router-link>
        </nav>
      </aside>
      <main class="admin-main min-w-0 p-3 md:p-4">
        <router-view />
      </main>
    </div>
  </div>
</template>
