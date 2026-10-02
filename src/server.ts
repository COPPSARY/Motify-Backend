import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';

import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { createClient } from '@supabase/supabase-js';
import type { Logger } from 'pino';
import { sql } from 'drizzle-orm';

import { BakongClient, bakongTokenExpiry } from '../packages/bakong/client.js';
import { generateDynamicKhqr } from '../packages/bakong/khqr.js';
import { SandboxBakongGateway } from '../packages/bakong/sandbox.js';
import { SupabaseAuthProvider } from '../packages/auth/supabase-provider.js';
import { TokenVault } from '../packages/auth/token-vault.js';
import { createMotionGraph } from '../packages/ai/graph/motion.graph.js';
import { createModelProvider } from '../packages/ai/providers/factory.js';
import { createDatabase } from '../packages/database/client.js';
import { parseEnvironment } from './config/env.js';
import { createLogger } from './config/logger.js';
import { AuthController, type AuthControllerService } from './controllers/auth.controller.js';
import { ProjectController, type ProjectControllerService } from './controllers/project.controller.js';
import { MotionMessageController, type MotionMessageService } from './controllers/motion-message.controller.js';
import { AssetController, type AssetControllerService } from './controllers/asset.controller.js';
import { AudioController, type AudioControllerService } from './controllers/audio.controller.js';
import { BrandController, type BrandControllerService } from './controllers/brand.controller.js';
import { CreditController, type CreditControllerService } from './controllers/credit.controller.js';
import { WorkspaceController, type WorkspaceControllerService } from './controllers/workspace.controller.js';
import { PaymentController, type PaymentControllerService } from './controllers/payment.controller.js';
import { requireAuthentication, resolveSession } from './middleware/authentication.js';
import { errorHandler, notFound } from './middleware/error-handler.js';
import { createRequestLogger } from './middleware/request-logger.js';
import { DatabaseAccountProvisioner, DatabaseAuthFlowStore, DatabaseSessionStore } from './repositories/auth.repository.js';
import { DatabaseProjectRepository } from './repositories/project.repository.js';
import { DatabaseAssetRepository } from './repositories/asset.repository.js';
import { DatabaseAudioRepository } from './repositories/audio.repository.js';
import { DatabaseBrandRepository } from './repositories/brand.repository.js';
import { DatabaseCreditRepository } from './repositories/credit.repository.js';
import { DatabaseMotionGraphRepository } from './repositories/motion-graph.repository.js';
import { DatabaseWorkspaceRepository } from './repositories/workspace.repository.js';
import { DatabasePaymentRepository } from './repositories/payment.repository.js';
import { createAuthRoutes } from './routes/auth.routes.js';
import { createProjectRoutes, createWorkspaceProjectRoutes } from './routes/project.routes.js';
import { createMotionMessageRoutes } from './routes/motion-message.routes.js';
import { createAssetRoutes, createProjectAssetRoutes, createWorkspaceAssetRoutes } from './routes/asset.routes.js';
import { createAudioRoutes, createProjectAudioRoutes, createWorkspaceAudioRoutes } from './routes/audio.routes.js';
import { createBrandRoutes } from './routes/brand.routes.js';
import { createCreditRoutes } from './routes/credit.routes.js';
import { createWorkspaceRoutes } from './routes/workspace.routes.js';
import { createBillingRoutes, createPaymentRoutes, createWorkspaceBillingRoutes } from './routes/payment.routes.js';
import { AuthService } from './services/auth.service.js';
import { GenerationBilling } from './services/generation-billing.js';
import { GenerationService } from './services/generation.service.js';
import { ProjectService } from './services/project.service.js';
import { AssetService } from './services/asset.service.js';
import { AudioService } from './services/audio.service.js';
import { BrandService } from './services/brand.service.js';
import { CreditService, toCredits } from './services/credit.service.js';
import { SupabaseObjectStorage } from '../packages/object-storage/supabase-storage.js';
import { WorkspaceService } from './services/workspace.service.js';
import { PaymentService } from './services/payment.service.js';
import type { SessionResolver } from './types/http.js';

interface AppOptions {
  services: {
    auth: AuthControllerService;
    sessions: SessionResolver;
    workspaces: WorkspaceControllerService;
    projects: ProjectControllerService;
    motionMessages?: MotionMessageService;
    assets?: AssetControllerService;
    audio?: AudioControllerService;
    brand?: BrandControllerService;
    credits?: CreditControllerService;
    payments?: PaymentControllerService;
  };
  frontendOrigins: string[];
  secureCookies: boolean;
  logger?: Logger;
  nodeEnv?: 'development' | 'test' | 'production';
  readiness?: () => Promise<void>;
}

export function createApp(options: AppOptions) {
  const app = express();
  const frontendOrigin = options.frontendOrigins[0];
  if (!frontendOrigin) throw new Error('At least one frontend origin is required');

  app.disable('x-powered-by');
  app.use(helmet());
  app.use(createRequestLogger(options.logger ?? createLogger({ nodeEnv: 'test', logLevel: 'silent' }), options.nodeEnv ?? 'test'));
  app.use(cors({ origin: options.frontendOrigins, credentials: true }));
  app.use(express.json({ limit: '20mb' }));
  app.use(cookieParser());

  app.get('/health', (_request, response) => response.json({ status: 'ok' }));
  app.get('/ready', async (_request, response) => {
    try {
      await options.readiness?.();
      response.json({ status: 'ready' });
    } catch {
      response.status(503).json({ status: 'not_ready' });
    }
  });

  const authController = new AuthController(
    options.services.auth,
    options.frontendOrigins,
    options.secureCookies,
    options.nodeEnv === 'development',
  );
  const workspaceController = new WorkspaceController(options.services.workspaces);
  const projectController = new ProjectController(options.services.projects);
  const motionMessageController = options.services.motionMessages ? new MotionMessageController(options.services.motionMessages) : null;
  const assetController = options.services.assets ? new AssetController(options.services.assets) : null;
  const audioController = options.services.audio ? new AudioController(options.services.audio) : null;
  const brandController = options.services.brand ? new BrandController(options.services.brand) : null;
  const creditController = options.services.credits ? new CreditController(options.services.credits) : null;
  const paymentController = options.services.payments ? new PaymentController(options.services.payments) : null;

  app.use('/v1', resolveSession(options.services.sessions));
  app.use('/v1/auth', createAuthRoutes(authController));
  if (assetController) {
    app.use('/v1/workspaces/:workspaceId/assets', requireAuthentication, createWorkspaceAssetRoutes(assetController));
    app.use('/v1/projects/:projectId/assets', requireAuthentication, createProjectAssetRoutes(assetController));
    app.use('/v1/assets', requireAuthentication, createAssetRoutes(assetController));
  }
  if (audioController) {
    app.use('/v1/workspaces/:workspaceId/audio', requireAuthentication, createWorkspaceAudioRoutes(audioController));
    app.use('/v1/projects/:projectId/audio', requireAuthentication, createProjectAudioRoutes(audioController));
    app.use('/v1/audio', requireAuthentication, createAudioRoutes(audioController));
  }
  if (brandController) {
    app.use('/v1/brand', requireAuthentication, createBrandRoutes(brandController));
    app.use('/v1/workspaces/:workspaceId/brand', requireAuthentication, createBrandRoutes(brandController));
  }
  if (creditController) app.use('/v1/credits', requireAuthentication, createCreditRoutes(creditController));
  if (paymentController) {
    app.use('/v1/billing', createBillingRoutes(paymentController));
    app.use('/v1/workspaces/:workspaceId/billing', requireAuthentication, createWorkspaceBillingRoutes(paymentController));
    app.use('/v1/payments', requireAuthentication, createPaymentRoutes(paymentController));
  }
  app.use('/v1/workspaces/:workspaceId/projects', requireAuthentication, createWorkspaceProjectRoutes(projectController));
  app.use('/v1/workspaces', requireAuthentication, createWorkspaceRoutes(workspaceController));
  app.use('/v1/projects', requireAuthentication, createProjectRoutes(projectController));
  if (motionMessageController) app.use('/v1/projects', requireAuthentication, createMotionMessageRoutes(motionMessageController));
  app.use(notFound);
  app.use(errorHandler);
  return app;
}

export async function startServer() {
  const environment = parseEnvironment(process.env);
  const logger = createLogger({ nodeEnv: environment.nodeEnv, ...(environment.logLevel ? { logLevel: environment.logLevel } : {}) });
  const { db, pool } = createDatabase(environment.databaseUrl);
  const provider = new SupabaseAuthProvider(environment.supabaseUrl, environment.supabasePublishableKey);
  const vault = new TokenVault(environment.sessionEncryptionKey);
  const accounts = new DatabaseAccountProvisioner(db, environment.signupCreditUnits);
  const sessions = new DatabaseSessionStore(db, vault, provider);
  const flows = new DatabaseAuthFlowStore(db, vault);
  const auth = new AuthService(provider, accounts, sessions, flows, {
    emailVerificationRedirect: `${environment.apiPublicUrl}/v1/auth/verify`,
    oauthCallbackUrl: `${environment.apiPublicUrl}/v1/auth/callback`,
  });
  const workspaces = new WorkspaceService(new DatabaseWorkspaceRepository(db));
  const projects = new ProjectService(new DatabaseProjectRepository(db));
  const objectStorage = new SupabaseObjectStorage(createClient(
    environment.supabaseUrl,
    environment.supabaseServiceRoleKey,
    { auth: { persistSession: false, autoRefreshToken: false } },
  ), environment.supabaseStorageBucket);
  const assetRepository = new DatabaseAssetRepository(db);
  const assetService = new AssetService(assetRepository, objectStorage);
  const audioService = new AudioService(new DatabaseAudioRepository(db), assetRepository, objectStorage);
  const brandService = new BrandService(new DatabaseBrandRepository(db), assetRepository, assetService);
  const creditRepository = new DatabaseCreditRepository(db);
  // Lets the editor show what a request will cost before it is sent. Only
  // meaningful when requests are actually charged for.
  const credits = new CreditService(creditRepository, environment.creditsEnforced ? {
    typical: toCredits(environment.creditHoldUnits),
    min: toCredits(environment.creditMinUnits),
    max: toCredits(environment.creditPricing.maxChargeUnits),
  } : undefined);
  const billing = new GenerationBilling(creditRepository, environment.creditPricing, {
    enforced: environment.creditsEnforced,
    holdUnits: environment.creditHoldUnits,
    minUnits: environment.creditMinUnits,
    // Far longer than any request can run, so a live request is never swept.
    staleAfterMs: 15 * 60 * 1000,
  }, environment.aiModel, logger);
  logger.info({ enforced: environment.creditsEnforced }, environment.creditsEnforced
    ? 'Credits are being charged for generations'
    : 'Credits are metered but not charged (CREDITS_ENFORCED is off)');
  const graphRepository = new DatabaseMotionGraphRepository(db);
  const generations = new GenerationService(
    createMotionGraph({
      provider: createModelProvider(environment),
      repository: graphRepository,
      model: environment.aiModel,
      planningModel: environment.aiPlanningModel,
      ...(environment.nodeEnv === 'development' ? {
        onSkillsSelected: (selection) => {
          logger.info(selection, 'Motify skills selected');
        },
      } : {}),
    }),
    graphRepository,
    assetService,
    audioService,
    billing,
    brandService,
  );
  const payments = createPaymentService(environment, db, logger);
  const app = createApp({
    services: {
      auth, sessions, workspaces, projects, motionMessages: generations, assets: assetService, audio: audioService, brand: brandService, credits,
      ...(payments ? { payments } : {}),
    },
    frontendOrigins: environment.frontendOrigins,
    secureCookies: environment.secureCookies,
    logger,
    nodeEnv: environment.nodeEnv,
    readiness: async () => { await db.execute(sql`select 1`); },
  });
  const server = createServer(app);

  let reconcileTimer: NodeJS.Timeout | undefined;
  if (payments && environment.bakong) {
    let reconciling = false;
    reconcileTimer = setInterval(() => {
      if (reconciling) return;
      reconciling = true;
      payments.reconcilePending()
        .catch((error: unknown) => logger.error({ err: error }, 'Bakong payment reconciliation failed'))
        .finally(() => { reconciling = false; });
    }, environment.bakong.reconcileIntervalSeconds * 1000);
    reconcileTimer.unref();
  }
  // Gives back credits held by a request that never finished, such as when the server restarted mid-generation.
  const sweepHolds = () => billing.releaseStale().catch((error: unknown) => {
    logger.error({ error: error instanceof Error ? error.message : String(error) }, 'Credit hold sweep failed');
  });
  void sweepHolds();
  const holdSweeper = setInterval(() => void sweepHolds(), 5 * 60 * 1000);
  holdSweeper.unref();
  // Plan credits expire at the end of the period they were granted for.
  const expireCredits = () => creditRepository.expireCredits(new Date())
    .then((expired) => { if (expired) logger.info({ expired }, 'Expired plan credits'); })
    .catch((error: unknown) => {
      logger.error({ error: error instanceof Error ? error.message : String(error) }, 'Credit expiry sweep failed');
    });
  void expireCredits();
  const expirySweeper = setInterval(() => void expireCredits(), 5 * 60 * 1000);
  expirySweeper.unref();

  server.listen(environment.apiPort, environment.apiHost, () => {
    logger.info({ port: environment.apiPort }, 'Motify API started');
  });

  let shutdownPromise: Promise<void> | undefined;
  const shutdown = () => shutdownPromise ??= (async () => {
    clearInterval(reconcileTimer);
    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(forceTimer);
        resolve();
      };
      const forceTimer = setTimeout(() => {
        server.closeAllConnections();
        finish();
      }, 10_000);
      forceTimer.unref();
      server.close(finish);
      server.closeIdleConnections();
    });
    clearInterval(holdSweeper);
    clearInterval(expirySweeper);
    await pool.end();
    logger.info('Motify API stopped');
  })();
  process.once('SIGINT', () => void shutdown());
  process.once('SIGTERM', () => void shutdown());
  return server;
}

export function createPaymentService(environment: ReturnType<typeof parseEnvironment>, db: ReturnType<typeof createDatabase>['db'], logger: Logger) {
  const bakong = environment.bakong;
  if (!bakong) {
    logger.info('Bakong payments disabled: set BAKONG_TOKEN and BAKONG_ACCOUNT_ID to enable them');
    return null;
  }
  const sandbox = bakong.mode === 'sandbox' ? new SandboxBakongGateway() : null;
  if (sandbox) {
    logger.warn('Bakong SANDBOX mode: no request reaches Bakong and no money moves; settle checkouts with POST /v1/payments/:id/sandbox');
  }
  const expiry = bakong.token ? bakongTokenExpiry(bakong.token) : null;
  if (expiry) {
    const daysLeft = Math.floor((expiry.getTime() - Date.now()) / 86_400_000);
    if (daysLeft < 14) logger.warn({ expiresAt: expiry.toISOString(), daysLeft }, 'BAKONG_TOKEN expires soon; renew it at api-bakong.nbc.gov.kh');
  }
  const receiver = {
    accountId: bakong.accountId,
    merchantName: bakong.merchantName,
    merchantCity: bakong.merchantCity,
    ...(bakong.merchantId && bakong.acquiringBank ? { merchantId: bakong.merchantId, acquiringBank: bakong.acquiringBank } : {}),
  };
  return new PaymentService(
    new DatabasePaymentRepository(db),
    sandbox ?? new BakongClient({ baseUrl: bakong.apiBaseUrl, token: bakong.token! }),
    {
      plans: environment.billingPlans,
      creditPacks: environment.creditPacks,
      receiverAccountId: bakong.accountId,
      generateKhqr: (payment) => generateDynamicKhqr(receiver, payment),
      qrTtlMs: bakong.qrTtlSeconds * 1000,
      logger,
      ...(sandbox ? { sandbox } : {}),
    },
  );
}

const entryFile = process.argv[1];
if (entryFile && import.meta.url === pathToFileURL(entryFile).href) {
  void startServer();
}
