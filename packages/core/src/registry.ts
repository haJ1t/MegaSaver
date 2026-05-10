import type { MemoryEntryId, ProjectId, SessionId } from "@megasaver/shared";
import { CoreRegistryError } from "./errors.js";
import { type MemoryEntry, memoryEntrySchema } from "./memory-entry.js";
import { type Project, projectSchema } from "./project.js";
import {
  type Session,
  type SessionUpdatePatch,
  sessionSchema,
  sessionUpdatePatchSchema,
} from "./session.js";
import { type TokenSaverSettings, tokenSaverSettingsSchema } from "./token-saver.js";

export interface CoreRegistry {
  createProject(project: Project): Project;
  getProject(id: ProjectId): Project | null;
  listProjects(): Project[];
  createSession(session: Session): Session;
  getSession(id: SessionId): Session | null;
  listSessions(projectId: ProjectId): Session[];
  endSession(id: SessionId, opts: { endedAt: string }): Session;
  updateSession(id: SessionId, patch: SessionUpdatePatch): Session;
  // AA1 BB1: write the entire TokenSaverSettings blob onto a session.
  // The CLI / GUI compute the blob (mode, budget, timestamps) and hand
  // it over atomically — this method does not merge per-field patches.
  updateTokenSaver(id: SessionId, settings: TokenSaverSettings): Session;
  createMemoryEntry(entry: MemoryEntry): MemoryEntry;
  getMemoryEntry(id: MemoryEntryId): MemoryEntry | null;
  listMemoryEntries(projectId: ProjectId): MemoryEntry[];
}

export function createInMemoryCoreRegistry(): CoreRegistry {
  const projects = new Map<ProjectId, Project>();
  const sessions = new Map<SessionId, Session>();
  const memoryEntries = new Map<MemoryEntryId, MemoryEntry>();

  const requireProject = (projectId: ProjectId): void => {
    if (!projects.has(projectId)) {
      throw new CoreRegistryError("project_not_found", `Project does not exist: ${projectId}`);
    }
  };

  return {
    createProject(project) {
      const parsed = projectSchema.parse(project);
      if (projects.has(parsed.id)) {
        throw new CoreRegistryError(
          "project_already_exists",
          `Project already exists: ${parsed.id}`,
        );
      }

      projects.set(parsed.id, parsed);
      return projectSchema.parse(parsed);
    },

    getProject(id) {
      const project = projects.get(id);
      return project ? projectSchema.parse(project) : null;
    },

    listProjects() {
      return Array.from(projects.values(), (project) => projectSchema.parse(project));
    },

    createSession(session) {
      const parsed = sessionSchema.parse(session);
      if (sessions.has(parsed.id)) {
        throw new CoreRegistryError(
          "session_already_exists",
          `Session already exists: ${parsed.id}`,
        );
      }

      requireProject(parsed.projectId);
      sessions.set(parsed.id, parsed);
      return sessionSchema.parse(parsed);
    },

    getSession(id) {
      const session = sessions.get(id);
      return session ? sessionSchema.parse(session) : null;
    },

    listSessions(projectId) {
      requireProject(projectId);
      return Array.from(sessions.values())
        .filter((session) => session.projectId === projectId)
        .map((session) => sessionSchema.parse(session));
    },

    endSession(id, opts) {
      // No requireProject check: a session existing in the registry implies its project
      // existed at create-time, and the registry does not delete projects.
      const existing = sessions.get(id);
      if (!existing) {
        throw new CoreRegistryError("session_not_found", `Session does not exist: ${id}`);
      }
      if (existing.endedAt !== null) {
        throw new CoreRegistryError("session_already_ended", `Session already ended: ${id}`);
      }
      const updated = sessionSchema.parse({ ...existing, endedAt: opts.endedAt });
      sessions.set(id, updated);
      return updated;
    },

    updateSession(id, patch) {
      const parsedPatch = sessionUpdatePatchSchema.parse(patch);
      const existing = sessions.get(id);
      if (!existing) {
        throw new CoreRegistryError("session_not_found", `Session does not exist: ${id}`);
      }
      if (existing.endedAt !== null) {
        throw new CoreRegistryError("session_already_ended", `Session already ended: ${id}`);
      }
      const updated = sessionSchema.parse({ ...existing, ...parsedPatch });
      sessions.set(id, updated);
      return updated;
    },

    updateTokenSaver(id, settings) {
      const parsedSettings = tokenSaverSettingsSchema.parse(settings);
      const existing = sessions.get(id);
      if (!existing) {
        throw new CoreRegistryError("session_not_found", `Session does not exist: ${id}`);
      }
      if (existing.endedAt !== null) {
        throw new CoreRegistryError("session_already_ended", `Session already ended: ${id}`);
      }
      const updated = sessionSchema.parse({ ...existing, tokenSaver: parsedSettings });
      sessions.set(id, updated);
      return updated;
    },

    createMemoryEntry(entry) {
      const parsed = memoryEntrySchema.parse(entry);
      if (memoryEntries.has(parsed.id)) {
        throw new CoreRegistryError(
          "memory_entry_already_exists",
          `Memory entry already exists: ${parsed.id}`,
        );
      }

      requireProject(parsed.projectId);

      if (parsed.scope === "session" && parsed.sessionId !== null) {
        const session = sessions.get(parsed.sessionId);
        if (!session) {
          throw new CoreRegistryError(
            "session_not_found",
            `Session does not exist: ${parsed.sessionId}`,
          );
        }

        if (session.projectId !== parsed.projectId) {
          throw new CoreRegistryError(
            "session_project_mismatch",
            `Session ${parsed.sessionId} does not belong to project ${parsed.projectId}`,
          );
        }
      }

      memoryEntries.set(parsed.id, parsed);
      return memoryEntrySchema.parse(parsed);
    },

    getMemoryEntry(id) {
      const entry = memoryEntries.get(id);
      return entry ? memoryEntrySchema.parse(entry) : null;
    },

    listMemoryEntries(projectId) {
      requireProject(projectId);
      return Array.from(memoryEntries.values())
        .filter((entry) => entry.projectId === projectId)
        .map((entry) => memoryEntrySchema.parse(entry));
    },
  };
}
