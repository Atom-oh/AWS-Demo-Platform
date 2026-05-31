import type { FastifyInstance } from 'fastify';
import type { Project, StateClient } from '@demo-platform/shared';
import { NotFoundError } from '@demo-platform/shared';

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

  // Repos are always `owner/name` (exactly two segments per the Project schema),
  // so we use explicit path params rather than a broad trailing wildcard.
  app.get('/api/projects/:owner/:name', async (req) => {
    const { owner, name } = req.params as { owner: string; name: string };
    const repo = `${decodeURIComponent(owner)}/${decodeURIComponent(name)}`;
    const project = deps.projects[repo];
    if (!project) throw new NotFoundError(`project not found: ${repo}`);
    const state = await deps.stateClient.read(repo);
    return { project, state };
  });
}
