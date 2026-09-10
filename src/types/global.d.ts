import type {
  GraphSnapshot,
  GraphSnapshotOptions,
  CodexIntegrationStatus,
  InstallStatus,
  JobSnapshot,
  OpencodeIntegrationStatus,
  ProjectInfo,
  ProjectStatus,
  UpdateStatus,
} from '../shared/types';

export {};

declare global {
  interface Window {
    codegraphClient: {
      detectInstall: () => Promise<InstallStatus>;
      installCodeGraph: () => Promise<JobSnapshot>;
      checkForUpdate: () => Promise<UpdateStatus>;
      updateCodeGraph: () => Promise<JobSnapshot>;
      detectCodexIntegration: () => Promise<CodexIntegrationStatus>;
      injectCodex: () => Promise<JobSnapshot>;
      detectOpencodeIntegration: () => Promise<OpencodeIntegrationStatus>;
      injectOpencode: () => Promise<JobSnapshot>;
      selectProject: () => Promise<ProjectInfo | null>;
      getRecentProjects: () => Promise<ProjectInfo[]>;
      removeProject: (projectPath: string) => Promise<ProjectInfo[]>;
      getProjectStatus: (projectPath: string) => Promise<ProjectStatus>;
      buildGraph: (projectPath: string) => Promise<JobSnapshot>;
      rebuildGraph: (projectPath: string) => Promise<JobSnapshot>;
      deleteGraph: (projectPath: string) => Promise<JobSnapshot>;
      getGraphSnapshot: (projectPath: string, options: GraphSnapshotOptions) => Promise<GraphSnapshot>;
      getRuntimeLogPath: () => Promise<string>;
      onJobUpdated: (callback: (job: JobSnapshot) => void) => () => void;
      onJobLog: (callback: (log: { jobId: string; stream: string; text: string; createdAt: number }) => void) => () => void;
    };
  }
}
