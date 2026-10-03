// Buys a plan with a real Bakong KHQR payment, end to end, without a frontend.
// It runs the same PaymentService the API uses, against the real database and
// the real Bakong Open API, so a pass here means the backend flow works.
//
//   npm run payments:test -- --email you@example.com [--plan starter | --pack credits-30] [--out ./khqr.png]
//
// Scan the QR it prints (or the PNG it writes) with any Cambodian banking app
// and pay. The script polls until Bakong confirms, then prints the activated
// subscription and credits. This charges real money to the account in BAKONG_ACCOUNT_ID.
//
// With BAKONG_MODE=sandbox nothing is charged and no Bakong request is made: the
// script settles the checkout itself with --simulate paid|failed|wrong_amount|expired
// (default paid), through the same code a real payment takes.
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { and, eq, sql } from 'drizzle-orm';
import QRCode from 'qrcode';

import { createDatabase } from '../packages/database/client.js';
import { users, workspaceMembers, workspaces } from '../packages/database/schema.js';
import { parseEnvironment } from '../src/config/env.js';
import { createLogger } from '../src/config/logger.js';
import { createPaymentService } from '../src/server.js';
import { PLAN_IDS, type PlanId } from '../src/services/billing-plans.js';
import type { Purchase } from '../src/services/payment.service.js';

const { values } = parseArgs({
  options: {
    email: { type: 'string' },
    workspace: { type: 'string' },
    plan: { type: 'string', default: 'starter' },
    pack: { type: 'string' },
    simulate: { type: 'string' },
    out: { type: 'string', default: 'khqr-test-payment.png' },
    'poll-seconds': { type: 'string', default: '4' },
  },
});

if (!values.email) {
  console.error('Usage: npm run payments:test -- --email you@example.com [--plan starter | --pack credits-30] [--workspace <id>] [--out ./khqr.png]');
  process.exit(1);
}
if (!values.pack && !(PLAN_IDS as readonly string[]).includes(values.plan)) {
  console.error(`--plan must be one of ${PLAN_IDS.join(', ')}`);
  process.exit(1);
}
const purchase: Purchase = values.pack ? { creditPack: values.pack } : { plan: values.plan as PlanId };
const pollMs = Math.max(3, Number(values['poll-seconds'])) * 1000;
const SIMULATIONS = ['paid', 'failed', 'wrong_amount', 'expired'] as const;
if (values.simulate && !(SIMULATIONS as readonly string[]).includes(values.simulate)) {
  console.error(`--simulate must be one of ${SIMULATIONS.join(', ')}`);
  process.exit(1);
}

const environment = parseEnvironment(process.env);
const logger = createLogger({ nodeEnv: environment.nodeEnv, logLevel: 'warn' });
const { db, pool } = createDatabase(environment.databaseUrl);

let stopped = false;
process.once('SIGINT', () => { stopped = true; });

try {
  const payments = createPaymentService(environment, db, logger);
  if (!payments || !environment.bakong) throw new Error('Bakong is not configured: set BAKONG_TOKEN and BAKONG_ACCOUNT_ID in .env');

  const [user] = await db.select({ id: users.id, email: users.email }).from(users)
    .where(eq(sql`lower(${users.email})`, values.email.toLowerCase())).limit(1);
  if (!user) throw new Error(`No Motify account uses ${values.email}. Sign in once through the editor first.`);

  const [workspace] = await db.select({ id: workspaces.id, name: workspaces.name }).from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(and(
      eq(workspaceMembers.userId, user.id),
      eq(workspaceMembers.role, 'owner'),
      values.workspace ? eq(workspaces.id, values.workspace) : eq(workspaces.kind, 'personal'),
    )).limit(1);
  if (!workspace) throw new Error(`${user.email} owns no ${values.workspace ? `workspace ${values.workspace}` : 'personal workspace'}.`);

  const sandbox = environment.bakong.mode === 'sandbox';
  console.log(`\nMode:       ${sandbox ? 'SANDBOX (simulated, no money moves, no Bakong requests)' : 'LIVE (real money)'}`);
  if (!sandbox && values.simulate) throw new Error('--simulate needs BAKONG_MODE=sandbox');
  console.log(`Bakong API: ${sandbox ? 'not called' : environment.bakong.apiBaseUrl}`);
  console.log(`Receiver:   ${environment.bakong.accountId}`);
  console.log(`Buyer:      ${user.email}, workspace "${workspace.name}" (${workspace.id})`);
  console.log(`Before:     ${JSON.stringify(await payments.getSubscription(user.id, workspace.id))}`);
  if (values.pack) console.log(`Packs:      ${payments.listCreditPacks().map((pack) => `${pack.id} ($${pack.price})`).join(', ')}`);

  const checkout = await payments.createCheckout(user.id, workspace.id, purchase);
  if (!checkout.qr) throw new Error('Checkout returned no QR');
  const out = resolve(values.out);
  await QRCode.toFile(out, checkout.qr, { width: 480, margin: 2 });

  console.log(`\nCheckout ${checkout.id}: ${checkout.amount} ${checkout.currency} for ${checkout.plan ?? checkout.creditPack} (+${checkout.credits} credits), bill ${checkout.billNumber}`);
  console.log(`Expires at ${checkout.expiresAt}. QR saved to ${out}\n`);
  console.log(await QRCode.toString(checkout.qr, { type: 'terminal', small: true }));
  if (sandbox) {
    const outcome = (values.simulate ?? 'paid') as (typeof SIMULATIONS)[number];
    console.log(`Sandbox: simulating "${outcome}" instead of a real payment...\n`);
    await payments.simulatePayment(user.id, checkout.id, outcome);
  } else {
    console.log('Scan and pay with your banking app. Waiting for Bakong... (Ctrl+C to stop; the API sweep will still settle it)\n');
  }

  let last = '';
  while (!stopped) {
    const payment = await payments.getPayment(user.id, checkout.id);
    if (payment.status !== last) {
      console.log(`${new Date().toLocaleTimeString()}  ${payment.status}`);
      last = payment.status;
    }
    if (payment.status === 'PAID') {
      console.log(`\nPaid at ${payment.paidAt}.`);
      if (payment.subscription) console.log(`Subscription: ${JSON.stringify(payment.subscription, null, 2)}`);
      console.log(`Credits added: ${payment.credits}. Balance now: ${payment.creditBalance}`);
      console.log(`\nPASS: KHQR generated, ${sandbox ? 'the simulated payment was settled' : 'Bakong confirmed the payment'}, and the ${payment.kind === 'PLAN' ? 'plan and its credits were' : 'credits were'} added.`);
      break;
    }
    if (payment.status === 'EXPIRED' || payment.status === 'FAILED') {
      console.log(`\nStopped: payment ${payment.status}. Check the API log for the reason, then run again for a new QR.`);
      process.exitCode = 1;
      break;
    }
    await new Promise((done) => setTimeout(done, pollMs));
  }
} catch (error) {
  console.error(`\n${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
