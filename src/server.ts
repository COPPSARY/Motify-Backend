import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';

import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { createClient } from '@supabase/supabase-js';
import type { Logger } from 'pino';
import { sql } from 'drizzle-orm';

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
import { WorkspaceController, type WorkspaceControllerService } from './controllers/workspace.controller.js';
import { requireAuthentication, resolveSession } from './middleware/authentication.js';
import { errorHandler, notFound } from './middleware/error-handler.js';
import { createRequestLogger } from './middleware/request-logger.js';
import { DatabaseAccountProvisioner, DatabaseAuthFlowStore, DatabaseSessionStore } from './repositories/auth.repository.js';
import { DatabaseProjectRepository } from './repositories/project.repository.js';
import { DatabaseAssetRepository } from './repositories/asset.repository.js';
import { DatabaseAudioRepository } from './repositories/audio.repository.js';
import { DatabaseMotionGraphRepository } from './repositories/motion-graph.repository.js';
import { DatabaseWorkspaceRepository } from './repositories/workspace.repository.js';
import { createAuthRoutes } from './routes/auth.routes.js';
import { createProjectRoutes, createWorkspaceProjectRoutes } from './routes/project.routes.js';
import { createMotionMessageRoutes } from './routes/motion-message.routes.js';
import { createAssetRoutes, createProjectAssetRoutes, createWorkspaceAssetRoutes } from './routes/asset.routes.js';
import { createAudioRoutes, createProjectAudioRoutes, createWorkspaceAudioRoutes } from './routes/audio.routes.js';
import { createWorkspaceRoutes } from './routes/workspace.routes.js';
import { AuthService } from './services/auth.service.js';
import { GenerationService } from './services/generation.service.js';
import { ProjectService } from './services/project.service.js';
import { AssetService } from './services/asset.service.js';
import { AudioService } from './services/audio.service.js';
import { SupabaseObjectStorage } from '../packages/object-storage/supabase-storage.js';
import { WorkspaceService } from './services/workspace.service.js';
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
  const accounts = new DatabaseAccountProvisioner(db);
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
  const graphRepository = new DatabaseMotionGraphRepository(db);
  const generations = new GenerationService(
    createMotionGraph({
      provider: createModelProvider(environment),
      repository: graphRepository,
      model: environment.aiModel,
      ...(environment.nodeEnv === 'development' ? {
        onSkillsSelected: (selection) => {
          logger.info(selection, 'Motify skills selected');
        },
      } : {}),
    }),
    graphRepository,
    assetService,
    audioService,
  );
  const app = createApp({
    services: { auth, sessions, workspaces, projects, motionMessages: generations, assets: assetService, audio: audioService },
    frontendOrigins: environment.frontendOrigins,
    secureCookies: environment.secureCookies,
    logger,
    nodeEnv: environment.nodeEnv,
    readiness: async () => { await db.execute(sql`select 1`); },
  });
  const server = createServer(app);

  server.listen(environment.apiPort, environment.apiHost, () => {
    logger.info({ port: environment.apiPort }, 'Motify API started');
  });

  let shutdownPromise: Promise<void> | undefined;
  const shutdown = () => shutdownPromise ??= (async () => {
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
    await pool.end();
    logger.info('Motify API stopped');
  })();
  process.once('SIGINT', () => void shutdown());
  process.once('SIGTERM', () => void shutdown());
  return server;
}

const entryFile = process.argv[1];
if (entryFile && import.meta.url === pathToFileURL(entryFile).href) {
  void startServer();
}
