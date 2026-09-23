<script setup lang="ts">
defineProps<{ title: string; summary: string }>();
</script>

<template>
  <section class="panel max-w-xl space-y-2">
    <p class="text-xs tracking-[0.2em] text-amber">PHASE 2</p>
    <h2 class="text-2xl">{{ title }}</h2>
    <p class="text-mist">{{ summary }}</p>
    <p class="text-sm text-mist">路由已预留，本阶段不实现业务。</p>
  </section>
</template>
