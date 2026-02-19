import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const status =
      exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const message =
      exception instanceof HttpException
        ? exception.getResponse()
        : exception instanceof Error
          ? exception.message
          : 'Internal server error';

    const body =
      typeof message === 'object' && message !== null && 'message' in message
        ? (message as { message: string | string[] })
        : { message };
    const errorResponse = {
      error: {
        code: status,
        message: Array.isArray(body.message) ? body.message[0] : body.message,
        details: Array.isArray(body.message) ? body.message : undefined,
      },
    };

    this.logger.warn(
      `${request.method} ${request.url} ${status} - ${JSON.stringify(errorResponse.error)}`,
    );
    response.status(status).json(errorResponse);
  }
}
