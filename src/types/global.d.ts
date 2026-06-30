import type {
  GraphSnapshot,
  GraphSnapshotOptions,
  InstallStatus,
  JobSnapshot,
  ProjectInfo,
  ProjectStatus,
} from '../shared/types';

export {};

declare global {
  interface Window {
    codegraphClient: {
      detectInstall: () => Promise<InstallStatus>;
      installCodeGraph: () => Promise<JobSnapshot>;
      selectProject: () => Promise<ProjectInfo | null>;
      getRecentProjects: () => Promise<ProjectInfo[]>;
      getProjectStatus: (projectPath: string) => Promise<ProjectStatus>;
      buildGraph: (projectPath: string) => Promise<JobSnapshot>;
      rebuildGraph: (projectPath: string) => Promise<JobSnapshot>;
      deleteGraph: (projectPath: string) => Promise<JobSnapshot>;
      getGraphSnapshot: (projectPath: string, options: GraphSnapshotOptions) => Promise<GraphSnapshot>;
      onJobUpdated: (callback: (job: JobSnapshot) => void) => () => void;
      onJobLog: (callback: (log: { jobId: string; stream: string; text: string; createdAt: number }) => void) => () => void;
    };
  }
}
