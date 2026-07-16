import dotenv from 'dotenv';

dotenv.config();

const isTest = process.env.NODE_ENV === 'test';

/**
 * Fail fast on missing secrets rather than 500-ing on the first request.
 * Tests supply their own throwaway values.
 */
function required(name, fallbackForTest) {
  const value = process.env[name];
  if (value) return value;
  if (isTest && fallbackForTest !== undefined) return fallbackForTest;
  throw new Error(`Missing required environment variable: ${name}. See .env.example.`);
}

export const config = {
  env: process.env.NODE_ENV ?? 'development',
  isProd: process.env.NODE_ENV === 'production',
  isTest,
  port: Number(process.env.PORT ?? 3000),
  logLevel: process.env.LOG_LEVEL ?? 'info',

  mongodbUri: required('MONGODB_URI', 'mongodb://127.0.0.1:27017/listaplus-test'),

  // Escape hatch for hosts where Node's DNS library (c-ares) cannot read the
  // system resolver config and falls back to 127.0.0.1, which breaks the SRV
  // lookup that mongodb+srv:// depends on. Leave empty everywhere DNS works.
  dnsServers: (process.env.DNS_SERVERS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  jwtSecret: required('JWT_SECRET', 'test-secret'),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '30d',
  googleClientId: required('GOOGLE_CLIENT_ID', 'test-google-client-id'),

  appPackage: process.env.APP_PACKAGE ?? 'com.jorres.listaplus',
  googlePlaySaKey: process.env.GOOGLE_PLAY_SA_KEY ?? '',

  corsOrigins: (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),
};
