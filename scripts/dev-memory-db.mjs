/**
 * Runs the API against a throwaway in-memory MongoDB.
 *
 * For dev machines with no mongod installed. Data is WIPED on exit — this is a
 * convenience for poking at endpoints, not a substitute for a real database.
 * Once MONGODB_URI points at Atlas or a local mongod, use `npm run dev` instead
 * and delete this file.
 *
 *   npm run dev:memdb
 */
import { MongoMemoryServer } from 'mongodb-memory-server';

const mongo = await MongoMemoryServer.create({ instance: { dbName: 'listaplus' } });

// Set before importing the server: config/env.js reads process.env at import
// time, and dotenv does not overwrite variables that are already set.
process.env.MONGODB_URI = mongo.getUri('listaplus');

if (!process.env.GOOGLE_CLIENT_ID) {
  process.env.GOOGLE_CLIENT_ID = 'placeholder-dev-only.apps.googleusercontent.com';
  console.warn(
    '\n  ⚠  GOOGLE_CLIENT_ID is empty in .env — using a placeholder.\n' +
      '     The server will boot, but POST /auth/google will 401 on every real\n' +
      '     Google ID token. Paste the Web client ID into .env to fix.\n'
  );
}

console.log(
  `  ⚠  In-memory MongoDB — all data is lost when this process exits.\n` +
    `     Attach mongosh/Compass to: ${process.env.MONGODB_URI}\n`
);

process.on('exit', () => mongo.stop());

await import('../src/server.js');
