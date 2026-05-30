import type { FastifyInstance } from 'fastify';
import type { Project, StateClient } from '@demo-platform/shared';

export interface ProjectsRouteDeps {
  projects: Record<string, Project>;
  stateClient: StateClient;
}

export async function registerProjects(
  app: FastifyInstance,
  deps: ProjectsRouteDeps,
): Promise<void> {
  app.get('/api/projects', async () => {
    return Object.entries(deps.projects).map(([repo, p]) => ({
      repo,
      name: p.name,
      account: p.account,
    }));
  });

  app.get('/api/projects/*', async (req, reply) => {
    const u = req.url;
    const m = /^\/api\/projects\/(.+)$/.exec(u);
    const repo = decodeURIComponent(m?.[1] ?? '');
    const project = deps.projects[repo];
    if (!project) {
      void reply.code(404).send({ error: `project not found: ${repo}` });
      return;
    }
    const state = await deps.stateClient.read(repo);
    return { project, state };
  });
}
