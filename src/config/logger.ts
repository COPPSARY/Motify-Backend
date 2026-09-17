import pino, { type Logger, type LevelWithSilent } from 'pino';

interface LoggerOptions {
  nodeEnv: 'development' | 'test' | 'production';
  logLevel?: LevelWithSilent;
}

export function createLogger({ nodeEnv, logLevel }: LoggerOptions): Logger {
  const options = {
    level: logLevel ?? (nodeEnv === 'production' ? 'info' : 'debug'),
    base: { service: 'motify-api' },
    redact: {
      paths: [
        'req',
        'res',
        'request',
        'response',
        'headers',
        'body',
        '*.headers',
        '*.body',
        '*.authorization',
        '*.cookie',
        '*.set-cookie',
        '*.password',
        '*.passwordHash',
        '*.accessToken',
        '*.refreshToken',
        '*.token',
        '*.tokenHash',
        '*.apiKey',
        '*.supabaseKey',
        '*.pkceVerifier',
        '*.smtpPassword',
        '*.API_KEY',
        '*.SUPABASE_PUBLISHABLE_KEY',
        '*.SMTP_PASSWORD',
      ],
      remove: true,
    },
  };
  const transport = nodeEnv === 'development'
    ? pino.transport({ target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname,service' } })
    : undefined;
  return pino(options, transport);
}

export function serializeLogError(error: unknown, includeStack: boolean) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: sanitizeErrorMessage(error.message),
      ...(includeStack && error.stack ? { stack: error.stack } : {}),
    };
  }
  return { name: 'Error', message: 'Unknown error' };
}

function sanitizeErrorMessage(message: string) {
  return message
    .replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer [REDACTED]')
    .replace(/([?&](?:access_token|refresh_token|token_hash|code|password|api_key|key)=)[^&\s]+/gi, '$1[REDACTED]');
}
