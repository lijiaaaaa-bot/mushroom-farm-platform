import { Controller, Get } from '@nestjs/common';
import { Public } from '../common/decorators';

function slot(module: string, summary: string) {
  return { phase: 2, module, status: 'placeholder', summary };
}

/** 二期槽位。企微/钉钉严重告警推送见环境变量，不在此占位。 */
@Controller('phase2')
export class Phase2Controller {
  @Public()
  @Get('big-screen')
  bigScreen() {
    return slot('big-screen', '基地/单棚大屏');
  }

  @Public()
  @Get('trends')
  trends() {
    return slot('trends', '生长趋势复盘与抓拍对比');
  }

  @Public()
  @Get('wecom')
  wecom() {
    return {
      phase: 2,
      module: 'wecom',
      status: 'env',
      summary:
        '严重告警推送。设置 WECOM_WEBHOOK_URL 与/或 DINGTALK_WEBHOOK_URL；未设置则关闭。',
    };
  }
}
