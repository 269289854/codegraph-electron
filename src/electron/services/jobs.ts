import { BrowserWindow } from 'electron';
import type { JobKind, JobLog, JobSnapshot } from '../../shared/types.js';

type RunContext = {
  job: JobSnapshot;
  appendLog: (stream: JobLog['stream'], text: string) => void;
};

type JobRequest = {
  kind: JobKind;
  projectPath?: string;
  run: (context: RunContext) => Promise<unknown>;
};

class JobRunner {
  private jobs = new Map<string, JobSnapshot>();
  private activeProjectJobs = new Set<string>();

  async run(request: JobRequest): Promise<JobSnapshot> {
    const job = this.createJob(request.kind, request.projectPath);
    return this.execute(job, request.run);
  }

  async runProjectJob(projectPath: string, request: Omit<JobRequest, 'projectPath'>): Promise<JobSnapshot> {
    if (this.activeProjectJobs.has(projectPath)) {
      throw new Error('A CodeGraph task is already running for this project.');
    }
    this.activeProjectJobs.add(projectPath);
    try {
      return await this.run({ ...request, projectPath });
    } finally {
      this.activeProjectJobs.delete(projectPath);
    }
  }

  private createJob(kind: JobKind, projectPath?: string): JobSnapshot {
    const job: JobSnapshot = {
      id: `${kind}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      kind,
      projectPath,
      state: 'running',
      startedAt: Date.now(),
      logs: [],
    };
    this.jobs.set(job.id, job);
    this.broadcastJob(job);
    return job;
  }

  private async execute(job: JobSnapshot, run: (context: RunContext) => Promise<unknown>): Promise<JobSnapshot> {
    const appendLog = (stream: JobLog['stream'], text: string): void => {
      const log = { jobId: job.id, stream, text, createdAt: Date.now() };
      job.logs.push(log);
      BrowserWindow.getAllWindows().forEach((window) => window.webContents.send('job:log', log));
    };

    try {
      await run({ job, appendLog });
      job.state = 'succeeded';
      job.exitCode = 0;
    } catch (error) {
      job.state = 'failed';
      job.exitCode = 1;
      job.error = error instanceof Error ? error.message : String(error);
      appendLog('stderr', job.error);
    } finally {
      job.finishedAt = Date.now();
      this.broadcastJob(job);
    }

    return { ...job, logs: [...job.logs] };
  }

  private broadcastJob(job: JobSnapshot): void {
    BrowserWindow.getAllWindows().forEach((window) => window.webContents.send('job:updated', job));
  }
}

export const jobRunner = new JobRunner();
