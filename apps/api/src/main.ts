import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/http-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useWebSocketAdapter(new IoAdapter(app));
  const config = app.get(ConfigService);
  const corsOriginsRaw = config.get<string[]>('corsOrigins') ?? ['http://localhost:3000'];
  const allowWildcard = corsOriginsRaw.some((o) => o.trim() === '*');
  const explicitOrigins = corsOriginsRaw
    .map((o) => o.trim().replace(/\/$/, ''))
    .filter((o) => o.length > 0 && o !== '*');
  // * → reflect request Origin (works with credentials) in any NODE_ENV.
  const allowAnyOrigin = allowWildcard;
  app.enableCors({
    origin: allowAnyOrigin
      ? true
      : explicitOrigins.length > 0
        ? explicitOrigins
        : ['http://localhost:3000'],
    credentials: true,
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'X-Requested-With'],
  });
  app.setGlobalPrefix('v1');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());

  const swaggerConfig = new DocumentBuilder()
    .setTitle('CrewCall API')
    .setDescription('CrewCall Backend API')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, document);

  const port = config.get<number>('port') ?? 3000;
  await app.listen(port);
  console.log(`CrewCall API running at http://localhost:${port}/v1, Swagger at http://localhost:${port}/docs, WebSocket chat at ws://localhost:${port}/chat`);
}

bootstrap().catch((err) => {
  console.error(err);
  process.exit(1);
});
