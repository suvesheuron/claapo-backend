import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';

@ApiTags('health')
@Controller()
export class AppController {
  @Get()
  @ApiOperation({ summary: 'API root' })
  getRoot() {
    return {
      api: 'CrewCall API',
      version: '1',
      docs: '/docs',
      health: '/v1/health',
    };
  }

  @Get('health')
  @ApiOperation({ summary: 'Health check' })
  getHealth() {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }
}
