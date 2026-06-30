import { describe, expect, it } from 'vitest';
import { JobRunner } from '../src/electron/services/jobs.js';

describe('JobRunner', () => {
  it('prevents concurrent jobs for the same project', async () => {
    const runner = new JobRunner(() => undefined);
    let release!: () => void;
    const blocker = new Promise<void>((resolve) => {
      release = resolve;
    });

    const first = runner.runProjectJob('D:/repo', {
      kind: 'build',
      run: async () => blocker,
    });

    await expect(
      runner.runProjectJob('D:/repo', {
        kind: 'rebuild',
        run: async () => undefined,
      }),
    ).rejects.toThrow('already running');

    release();
    await expect(first).resolves.toMatchObject({ state: 'succeeded' });
  });

  it('allows concurrent jobs for different projects', async () => {
    const runner = new JobRunner(() => undefined);
    const results = await Promise.all([
      runner.runProjectJob('D:/repo-a', { kind: 'build', run: async () => undefined }),
      runner.runProjectJob('D:/repo-b', { kind: 'build', run: async () => undefined }),
    ]);

    expect(results.map((job) => job.state)).toEqual(['succeeded', 'succeeded']);
  });
});
