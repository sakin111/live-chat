import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';
import { Response } from 'express';

@Catch()
export class EnvelopeFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'INTERNAL_ERROR';
    let message = 'Internal server error';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse() as any;

      if (exceptionResponse && exceptionResponse.error && exceptionResponse.error.code) {
         code = exceptionResponse.error.code;
         message = exceptionResponse.error.message;
      } else {
         if (status === HttpStatus.BAD_REQUEST && Array.isArray(exceptionResponse.message)) {
             code = 'VALIDATION_ERROR';
             message = exceptionResponse.message.join(', ');
         } else if (status === HttpStatus.UNAUTHORIZED) {
             code = 'UNAUTHORIZED';
             message = exceptionResponse.message || 'Unauthorized';
         } else if (status === HttpStatus.NOT_FOUND && exceptionResponse.message) {
             code = 'NOT_FOUND';
             message = exceptionResponse.message;
         } else {
             code = exceptionResponse.error ? exceptionResponse.error.toUpperCase().replace(/\s+/g, '_') : 'ERROR';
             message = exceptionResponse.message || 'An error occurred';
         }
      }
    } else {
       console.error(exception);
    }

    response.status(status).json({
      success: false,
      error: {
        code,
        message,
      },
    });
  }
}
