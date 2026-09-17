import { AppError } from '../errors.js';

export type WorkspaceRole = 'owner' | 'editor' | 'viewer';

export interface WorkspaceRepository {
  getMembership(workspaceId: string, userId: string): Promise<{ role: WorkspaceRole } | null>;
  countOwners(workspaceId: string): Promise<number>;
  list(userId: string): Promise<unknown>;
  create(userId: string, name: string): Promise<unknown>;
  get(workspaceId: string): Promise<unknown | null>;
  update(workspaceId: string, name: string): Promise<unknown | null>;
  listMembers(workspaceId: string): Promise<unknown>;
  findProfileByEmail(email: string): Promise<{ id: string } | null>;
  addMember(workspaceId: string, userId: string, role: WorkspaceRole): Promise<unknown>;
  updateMember(workspaceId: string, userId: string, role: WorkspaceRole): Promise<unknown | null>;
  removeMember(workspaceId: string, userId: string): Promise<void>;
}

export class WorkspaceService {
  constructor(private readonly repository: WorkspaceRepository) {}

  list(userId: string) { return this.repository.list(userId); }

  create(userId: string, input: { name: string }) { return this.repository.create(userId, input.name); }

  async get(userId: string, workspaceId: string) {
    await this.requireMembership(workspaceId, userId);
    const workspace = await this.repository.get(workspaceId);
    if (!workspace) throw new AppError(404, 'WORKSPACE_NOT_FOUND', 'Workspace not found.');
    return workspace;
  }

  async update(userId: string, workspaceId: string, input: { name: string }) {
    const membership = await this.requireMembership(workspaceId, userId);
    if (membership.role === 'viewer') throw new AppError(403, 'FORBIDDEN', 'Viewer access is read-only.');
    return this.repository.update(workspaceId, input.name);
  }

  async listMembers(userId: string, workspaceId: string) {
    await this.requireMembership(workspaceId, userId);
    return this.repository.listMembers(workspaceId);
  }

  async addMember(userId: string, workspaceId: string, input: { email: string; role: WorkspaceRole }) {
    await this.requireOwner(workspaceId, userId);
    const profile = await this.repository.findProfileByEmail(input.email.trim().toLowerCase());
    if (!profile) throw new AppError(404, 'ACCOUNT_NOT_FOUND', 'No existing Motify account uses that email.');
    return this.repository.addMember(workspaceId, profile.id, input.role);
  }

  async updateMember(userId: string, workspaceId: string, memberId: string, role: WorkspaceRole) {
    await this.requireOwner(workspaceId, userId);
    const target = await this.repository.getMembership(workspaceId, memberId);
    if (!target) throw new AppError(404, 'MEMBER_NOT_FOUND', 'Workspace member not found.');
    if (target.role === 'owner' && role !== 'owner' && (await this.repository.countOwners(workspaceId)) <= 1) {
      throw new AppError(409, 'LAST_OWNER', 'The last workspace owner cannot be demoted.');
    }
    return this.repository.updateMember(workspaceId, memberId, role);
  }

  async removeMember(workspaceId: string, actorId: string, targetId: string): Promise<void> {
    await this.requireOwner(workspaceId, actorId);
    const target = await this.repository.getMembership(workspaceId, targetId);
    if (!target) {
      throw new AppError(404, 'MEMBER_NOT_FOUND', 'Workspace member not found.');
    }
    if (target.role === 'owner' && (await this.repository.countOwners(workspaceId)) <= 1) {
      throw new AppError(409, 'LAST_OWNER', 'The last workspace owner cannot be removed.');
    }
    await this.repository.removeMember(workspaceId, targetId);
  }

  private async requireMembership(workspaceId: string, userId: string) {
    const membership = await this.repository.getMembership(workspaceId, userId);
    if (!membership) throw new AppError(404, 'WORKSPACE_NOT_FOUND', 'Workspace not found.');
    return membership;
  }

  private async requireOwner(workspaceId: string, userId: string) {
    const membership = await this.repository.getMembership(workspaceId, userId);
    if (membership?.role !== 'owner') throw new AppError(403, 'FORBIDDEN', 'Only workspace owners can manage members.');
    return membership;
  }
}
