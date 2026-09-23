import { Controller, Get } from '@nestjs/common';
import { Public } from '../common/decorators';

function slot(module: string, summary: string) {
  return { phase: 2, module, status: 'placeholder', summary };
}

/** 二期槽位：路由在，业务不实现。 */
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
    return slot('wecom', '企微/钉钉推送');
  }
}
