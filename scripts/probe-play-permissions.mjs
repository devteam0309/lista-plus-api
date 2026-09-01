/**
 * Diagnoses whether the Play service account can actually verify purchases,
 * without making a real purchase.
 *
 * Usage:
 *   npm run probe:play                  # uses GOOGLE_PLAY_SA_KEY from the env
 *   node scripts/probe-play-permissions.mjs ./path/to/key.json
 *
 * Accepts the same value shape as the server: raw JSON or a path to the key
 * file. Read-only, and it prints status codes only — never the credential.
 *
 * The trick is asking about a purchase token that cannot exist. Being told the
 * TOKEN is bad proves the CALL was authorised, which is what we want to know.
 * Play answers 400/404/410 for a bad token — the same codes
 * playBilling.service.js treats as "token not recognised" — and 401/403 when
 * the service account lacks permission, before it ever looks at the token.
 */
import fs from 'node:fs';
import { google } from 'googleapis';

const SCOPES = ['https://www.googleapis.com/auth/androidpublisher'];
const PACKAGE = process.env.APP_PACKAGE ?? 'com.jorres.listaplus';
const PRODUCT = (process.env.PREMIUM_PRODUCT_IDS ?? 'listaplus_premium_lifetime')
  .split(',')[0].trim();

/** 400/404/410 mean the call was allowed and only the fake token was refused. */
const authorised = (status) => [400, 404, 410].includes(status);

function loadCredentials() {
  const raw = (process.argv[2] ?? process.env.GOOGLE_PLAY_SA_KEY ?? '').trim();
  if (!raw) {
    console.error('No key. Pass a path as an argument or set GOOGLE_PLAY_SA_KEY.');
    process.exit(2);
  }
  const json = raw.startsWith('{') ? raw : fs.readFileSync(raw, 'utf8');
  return JSON.parse(json);
}

async function attempt(label, fn) {
  try {
    const res = await fn();
    console.log(`  ${label.padEnd(30)} HTTP ${res.status}  OK`);
    return { status: res.status, data: res.data };
  } catch (err) {
    const status = err?.response?.status ?? err?.code ?? 0;
    const msg = err?.response?.data?.error?.message ?? err?.message ?? '';
    console.log(`  ${label.padEnd(30)} HTTP ${status}  ${String(msg).slice(0, 80)}`);
    return { status, data: null };
  }
}

const credentials = loadCredentials();
console.log(`service account: ${credentials.client_email}`);
console.log(`package        : ${PACKAGE}\n`);

const auth = new google.auth.GoogleAuth({ credentials, scopes: SCOPES });
const play = google.androidpublisher({ version: 'v3', auth });

// Current products API: proves app-level access, and lists what Play can see.
const products = await attempt('monetization.onetimeproducts', () =>
  play.monetization.onetimeproducts.list({ packageName: PACKAGE }));

// Needs "View financial data" specifically, which app access alone does not give.
const purchase = await attempt('purchases.products.get', () =>
  play.purchases.products.get({
    packageName: PACKAGE,
    productId: PRODUCT,
    token: 'probe-token-that-cannot-exist',
  }));

const ids = (products.data?.oneTimeProducts ?? [])
  .map((p) => p.productId ?? p.sku)
  .filter(Boolean);
if (ids.length) {
  console.log(`\n  products visible: ${ids.join(', ')}`);
  console.log(`  "${PRODUCT}" present: ${ids.includes(PRODUCT)}`);
}

const appOk = products.status === 200;
const financialOk = authorised(purchase.status);

console.log('\n  VERDICT');
console.log(`  app access     : ${appOk ? 'OK' : 'MISSING'}`);
console.log(`  financial data : ${financialOk ? 'OK' : 'MISSING'}`);

if (appOk && financialOk) {
  console.log('  -> fully configured; a real purchase token would verify');
} else if (!appOk) {
  console.log('  -> invite the service account under Play Console >');
  console.log('     Users and permissions, and grant it access to this app');
} else {
  console.log('  -> tick "View financial data, orders, and cancellation survey');
  console.log('     responses" on the ACCOUNT PERMISSIONS tab (it is not under');
  console.log('     App permissions, where only Admin / View app information appear)');
}

process.exit(appOk && financialOk ? 0 : 1);
