import { AppError } from '../errors.js';
import type { WorkspaceRole } from './workspace.service.js';

export interface ProjectRecord {
  id: string; workspaceId: string; name: string; slug: string; width: number; height: number; fps: number; duration: number;
  scenes: Record<string, unknown>[]; compositionHtml: string; timelineJs: string; revision: number; createdBy: string;
  createdAt: Date; updatedAt: Date; archivedAt: Date | null;
}
export interface CreateProjectInput { name: string; width: number; height: number; fps: number; duration: number; scenes?: Record<string, unknown>[]; compositionHtml?: string; timelineJs?: string; }
export interface UpdateProjectInput extends Partial<Omit<CreateProjectInput, 'name'>> { revision: number; name?: string; }
export interface ProjectRepository {
  getWorkspaceMembership(workspaceId: string, userId: string): Promise<{ role: WorkspaceRole } | null>;
  getProjectAccess(projectId: string, userId: string): Promise<{ project: ProjectRecord; role: WorkspaceRole } | null>;
  list(workspaceId: string): Promise<ProjectRecord[]>; create(workspaceId: string, userId: string, input: CreateProjectInput): Promise<ProjectRecord>;
  update(projectId: string, input: UpdateProjectInput): Promise<ProjectRecord | null>; archive(projectId: string, revision: number): Promise<boolean>;
}
export class ProjectService {
  constructor(
    private readonly repository: ProjectRepository,
  ) {}
  async list(userId: string, workspaceId: string) { await this.requireWorkspaceMembership(workspaceId, userId); return this.repository.list(workspaceId); }
  async create(userId: string, workspaceId: string, input: CreateProjectInput) {
    const membership = await this.requireWorkspaceMembership(workspaceId, userId); this.requireWriteAccess(membership.role);
    return this.repository.create(workspaceId, userId, { ...input, scenes: input.scenes ?? [], compositionHtml: input.compositionHtml ?? '<template><style></style></template>', timelineJs: input.timelineJs ?? 'export function buildTimeline() { return []; }' });
  }
  async get(userId: string, projectId: string) { return (await this.requireProjectAccess(projectId, userId)).project; }
  async update(userId: string, projectId: string, input: UpdateProjectInput) { const access = await this.requireProjectAccess(projectId, userId); this.requireWriteAccess(access.role); const project = await this.repository.update(projectId, input); if (!project) throw await this.revisionConflict(projectId, userId, access.project.revision); return project; }
  async remove(userId: string, projectId: string, revision: number) {
    const access = await this.requireProjectAccess(projectId, userId); this.requireWriteAccess(access.role);
    if (!(await this.repository.archive(projectId, revision))) throw await this.revisionConflict(projectId, userId, access.project.revision);
  }
  private async requireWorkspaceMembership(workspaceId: string, userId: string) { const membership = await this.repository.getWorkspaceMembership(workspaceId, userId); if (!membership) throw new AppError(404, 'WORKSPACE_NOT_FOUND', 'Workspace not found.'); return membership; }
  private async requireProjectAccess(projectId: string, userId: string) { const access = await this.repository.getProjectAccess(projectId, userId); if (!access) throw new AppError(404, 'PROJECT_NOT_FOUND', 'Project not found.'); return access; }
  private requireWriteAccess(role: WorkspaceRole) { if (role === 'viewer') throw new AppError(403, 'FORBIDDEN', 'Viewer access is read-only.'); }
  private async revisionConflict(projectId: string, userId: string, fallbackRevision: number) { const current = await this.repository.getProjectAccess(projectId, userId); return new AppError(409, 'REVISION_CONFLICT', 'The project changed since it was loaded.', { currentRevision: current?.project.revision ?? fallbackRevision }); }
}
