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
    // `owner` (Atom-oh) is a personal account, not an org, so `/orgs/{org}/repos`
    // 404s. Use the authenticated user's repos and filter to the owner namespace.
    const repos = await this.octokit.paginate('GET /user/repos', {
      per_page: 100,
      affiliation: 'owner',
    });
    const mapped: DiscoveredRepo[] = repos
      .map((r: { full_name: string; default_branch?: string; topics?: string[]; description?: string | null }) => ({
        full_name: r.full_name,
        default_branch: r.default_branch ?? 'main',
        topics: r.topics ?? [],
        description: r.description ?? null,
      }))
      .filter((r) => r.full_name.startsWith(`${this.opts.org}/`));
    if (this.topicFilter === null) return mapped;
    return mapped.filter((r) => r.topics.includes(this.topicFilter as string));
  }
}
