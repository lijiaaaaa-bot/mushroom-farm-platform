<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { errorText, http } from '../api';

interface Channels {
  wecomEnabled: boolean;
  dingtalkEnabled: boolean;
}

const loading = ref(true);
const error = ref('');
const channels = ref<Channels | null>(null);

onMounted(async () => {
  try {
    const response = await http.get<Channels>('/alerts/push-channels');
    channels.value = response.data;
  } catch (cause) {
    error.value = errorText(cause);
  } finally {
    loading.value = false;
  }
});

function stateLabel(enabled: boolean) {
  return enabled ? '已启用' : '未启用';
}
</script>

<template>
  <section class="ops-page panel max-w-2xl space-y-3 bg-white">
    <h2 class="text-lg">严重告警推送</h2>
    <p class="text-sm text-mist">
      只推送级别为严重的告警。提示和一般不发送。企微与钉钉可同时配置，各自一条 webhook。
    </p>
    <p v-if="loading" class="text-sm text-mist">加载中…</p>
    <p v-else-if="error" class="text-sm text-danger">{{ error }}</p>
    <ul v-else-if="channels" class="space-y-1 text-sm">
      <li>企微 {{ stateLabel(channels.wecomEnabled) }}</li>
      <li>钉钉 {{ stateLabel(channels.dingtalkEnabled) }}</li>
    </ul>
    <div class="space-y-2 text-sm text-ink">
      <p>在 API 进程环境变量中配置，留空则该通道关闭，启动和告警都不报错。</p>
      <ul class="list-disc space-y-1 pl-5">
        <li><span class="font-mono">WECOM_WEBHOOK_URL</span>：企业微信群机器人 webhook</li>
        <li><span class="font-mono">DINGTALK_WEBHOOK_URL</span>：钉钉自定义机器人 webhook</li>
        <li>
          <span class="font-mono">DINGTALK_WEBHOOK_SECRET</span>：钉钉加签密钥，未设置则不签名
        </li>
      </ul>
      <p>报文以「严重告警」开头。钉钉机器人若要求关键词，可填这一词。</p>
      <p>推送失败只写入 API 日志。告警仍会保存，认领、确认和关闭照常完成。</p>
    </div>
  </section>
</template>
