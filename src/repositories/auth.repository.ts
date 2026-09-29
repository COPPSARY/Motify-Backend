import { createHash, randomBytes } from 'node:crypto';

import { and, eq, gt, isNull, lt, sql } from 'drizzle-orm';

import type { AuthProvider } from '../../packages/auth/types.js';
import { TokenVault } from '../../packages/auth/token-vault.js';
import type { Database } from '../../packages/database/client.js';
import {
  authSessions, creditAccounts, creditLedger, oauthAttempts, users, workspaceMembers, workspaces,
} from '../../packages/database/schema.js';
import type { AccountProvisioner, AuthFlowStore, SessionCreator } from '../services/auth.service.js';

function hash(value: string) {
  return createHash('sha256').update(value).digest('base64url');
}

function slugPart(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 40) || 'workspace';
}

/** Credits a new account starts with, in hundredths of a credit (50 credits). */
export const DEFAULT_SIGNUP_CREDIT_UNITS = 5000;

export class DatabaseAccountProvisioner implements AccountProvisioner {
  constructor(
    private readonly db: Database,
    private readonly signupCreditUnits: number = DEFAULT_SIGNUP_CREDIT_UNITS,
  ) {}

  async existsByEmail(email: string) {
    const [user] = await this.db.select({ id: users.id }).from(users)
      .where(sql`lower(${users.email}) = ${email.toLowerCase()}`)
      .limit(1);
    return Boolean(user);
  }

  async provision(identity: Parameters<AccountProvisioner['provision']>[0]) {
    await this.db.transaction(async (transaction) => {
      await transaction.insert(users).values({
        id: identity.id,
        email: identity.email,
        displayName: identity.displayName,
        avatarUrl: identity.avatarUrl,
      }).onConflictDoUpdate({
        target: users.id,
        set: { email: identity.email, displayName: identity.displayName, avatarUrl: identity.avatarUrl, updatedAt: new Date() },
      });

      let [personal] = await transaction.select({ id: workspaces.id }).from(workspaces)
        .where(and(eq(workspaces.ownerId, identity.id), eq(workspaces.kind, 'personal'))).limit(1);
      if (!personal) {
        [personal] = await transaction.insert(workspaces).values({
          name: `${identity.displayName}'s Workspace`,
          slug: `${slugPart(identity.displayName)}-${identity.id.slice(0, 8)}`,
          kind: 'personal',
          ownerId: identity.id,
        }).returning({ id: workspaces.id });
      }
      if (!personal) throw new Error('Unable to provision personal workspace');
      await transaction.insert(workspaceMembers).values({
        workspaceId: personal.id,
        userId: identity.id,
        role: 'owner',
      }).onConflictDoNothing();

      // Provisioning runs on every login, so the grant is made exactly once by
      // the ledger's unique index, not by guessing whether the user is new. The
      // trigger on the ledger adds the amount to the balance only for a row
      // that was really inserted.
      await transaction.insert(creditAccounts).values({ userId: identity.id }).onConflictDoNothing();
      if (this.signupCreditUnits > 0) {
        await transaction.insert(creditLedger).values({
          userId: identity.id,
          kind: 'SIGNUP_GRANT',
          amount: this.signupCreditUnits,
          referenceType: 'signup',
          note: 'Welcome credits',
        }).onConflictDoNothing();
      }
    });
  }
}

export class DatabaseSessionStore implements SessionCreator {
  constructor(
    private readonly db: Database,
    private readonly vault: TokenVault,
    private readonly provider: AuthProvider,
  ) {}

  async create(userId: string, accessToken: string, refreshToken: string, providerExpiresAt: Date) {
    const sessionToken = randomBytes(32).toString('base64url');
    const csrfToken = randomBytes(32).toString('base64url');
    await this.db.insert(authSessions).values({
      tokenHash: hash(sessionToken),
      userId,
      csrfToken,
      accessTokenEncrypted: this.vault.encrypt(accessToken),
      refreshTokenEncrypted: this.vault.encrypt(refreshToken),
      providerExpiresAt,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });
    return { sessionToken, csrfToken };
  }

  async resolve(sessionToken: string) {
    const [row] = await this.db.select({
      userId: users.id,
      email: users.email,
      displayName: users.displayName,
      avatarUrl: users.avatarUrl,
      csrfToken: authSessions.csrfToken,
    }).from(authSessions).innerJoin(users, eq(users.id, authSessions.userId)).where(and(
      eq(authSessions.tokenHash, hash(sessionToken)),
      isNull(authSessions.revokedAt),
      gt(authSessions.expiresAt, new Date()),
    )).limit(1);
    if (!row) return null;
    await this.db.update(authSessions).set({ lastSeenAt: new Date() }).where(eq(authSessions.tokenHash, hash(sessionToken)));
    return {
      user: {
        id: row.userId,
        email: row.email,
        emailVerified: true,
        displayName: row.displayName,
        avatarUrl: row.avatarUrl,
      },
      csrfToken: row.csrfToken,
    };
  }

  async revoke(sessionToken: string) {
    const tokenHash = hash(sessionToken);
    const [session] = await this.db.update(authSessions).set({ revokedAt: new Date() })
      .where(and(eq(authSessions.tokenHash, tokenHash), isNull(authSessions.revokedAt)))
      .returning({ accessTokenEncrypted: authSessions.accessTokenEncrypted });
    if (session) {
      await this.provider.revokeSession(this.vault.decrypt(session.accessTokenEncrypted)).catch(() => undefined);
    }
  }
}

export class DatabaseAuthFlowStore implements AuthFlowStore {
  constructor(private readonly db: Database, private readonly vault: TokenVault) {}

  async create(attemptToken: string, verifierState: string) {
    await this.db.delete(oauthAttempts).where(lt(oauthAttempts.expiresAt, new Date()));
    await this.db.insert(oauthAttempts).values({
      stateHash: hash(attemptToken),
      verifierStateEncrypted: this.vault.encrypt(verifierState),
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    });
  }

  async consume(attemptToken: string) {
    const [attempt] = await this.db.delete(oauthAttempts).where(and(
      eq(oauthAttempts.stateHash, hash(attemptToken)),
      gt(oauthAttempts.expiresAt, new Date()),
    )).returning({ verifierStateEncrypted: oauthAttempts.verifierStateEncrypted });
    return attempt ? this.vault.decrypt(attempt.verifierStateEncrypted) : null;
  }
}
