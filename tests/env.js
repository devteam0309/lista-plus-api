// Runs before the modules under test are imported, so config/env.js sees these.
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.GOOGLE_CLIENT_ID = 'test-client-id.apps.googleusercontent.com';
process.env.APP_PACKAGE = 'com.jorres.listaplus';
process.env.GOOGLE_PLAY_SA_KEY = JSON.stringify({
  type: 'service_account',
  client_email: 'test@test.iam.gserviceaccount.com',
  private_key: 'test-key',
});
// Overridden by mongodb-memory-server's URI at connect time; present so the
// required() check in config/env.js passes.
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/listaplus-test';
