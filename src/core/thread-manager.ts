import type { ThreadCreationInput, ThreadState } from "../schemas/models.ts";
import { WorkspaceRepo } from "../storage/workspace-repo.ts";

export class ThreadManager {
  private readonly repo: WorkspaceRepo;

  constructor(repo: WorkspaceRepo) {
    this.repo = repo;
  }

  async createThread(input: ThreadCreationInput, now: string): Promise<ThreadState> {
    return this.repo.createThread(input, now);
  }

  async updateWorkingState(thread: ThreadState): Promise<ThreadState> {
    await this.repo.writeThreadState(thread);
    return thread;
  }
}
