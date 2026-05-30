import { Octokit } from '@octokit/rest';

export interface DiscoveredRepo {
  full_name: string;
  default_branch: string;
  topics: string[];
  description: string | null;
}

export interface GithubClientOpts {
  pat: string;
  org: string;
  topicFilter?: string | null;
  octokit?: Octokit;
}

const DEFAULT_TOPIC = 'demo-platform';

export class GithubClient {
  private readonly octokit: Octokit;
  private readonly topicFilter: string | null;

  constructor(private readonly opts: GithubClientOpts) {
    this.octokit = opts.octokit ?? new Octokit({ auth: opts.pat });
    this.topicFilter = opts.topicFilter === undefined ? DEFAULT_TOPIC : opts.topicFilter;
  }

  async listDemoRepos(): Promise<DiscoveredRepo[]> {
    const repos = await this.octokit.paginate('GET /orgs/{org}/repos', {
      org: this.opts.org,
      per_page: 100,
    });
    const mapped: DiscoveredRepo[] = repos.map((r: { full_name: string; default_branch?: string; topics?: string[]; description?: string | null }) => ({
      full_name: r.full_name,
      default_branch: r.default_branch ?? 'main',
      topics: r.topics ?? [],
      description: r.description ?? null,
    }));
    if (this.topicFilter === null) return mapped;
    return mapped.filter((r) => r.topics.includes(this.topicFilter as string));
  }
}
