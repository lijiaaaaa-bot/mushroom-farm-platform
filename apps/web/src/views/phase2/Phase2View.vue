<script setup lang="ts">
defineProps<{ title: string; summary: string }>();
</script>

<template>
  <section class="panel max-w-xl space-y-2">
    <h2 class="text-2xl">{{ title }}</h2>
    <p class="text-mist">{{ summary }}</p>
    <p class="text-sm text-mist">通道尚未接入。</p>
  </section>
</template>
