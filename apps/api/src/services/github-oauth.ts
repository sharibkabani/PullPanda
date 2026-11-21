/** User-to-server GitHub calls used by the dashboard login. Injectable so tests never hit GitHub. */
export interface GitHubOAuth {
  authorizeUrl(state: string, redirectUri: string): string;
  exchangeCode(code: string, redirectUri: string): Promise<string>;
  getUser(token: string): Promise<{ id: number; login: string; name: string | null; email: string | null; avatar_url: string }>;
  listInstallations(token: string): Promise<
    { id: number; account: { id: number; login: string; type: string }; suspended_at: string | null }[]
  >;
  listInstallationRepos(token: string, installationId: number): Promise<{ id: number; full_name: string; private: boolean }[]>;
}

async function gh<T>(token: string, path: string): Promise<T> {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "PullPanda",
    },
  });
  if (!res.ok) throw new Error(`GitHub ${path} failed: ${res.status}`);
  return res.json() as Promise<T>;
}

export function createGitHubOAuth(clientId: string, clientSecret: string): GitHubOAuth {
  return {
    authorizeUrl(state, redirectUri) {
      const q = new URLSearchParams({ client_id: clientId, state, redirect_uri: redirectUri });
      return `https://github.com/login/oauth/authorize?${q}`;
    },
    async exchangeCode(code, redirectUri) {
      const res = await fetch("https://github.com/login/oauth/access_token", {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code, redirect_uri: redirectUri }),
      });
      const data = (await res.json()) as { access_token?: string; error_description?: string };
      if (!data.access_token) throw new Error(data.error_description ?? "OAuth exchange failed");
      return data.access_token;
    },
    getUser: (token) => gh(token, "/user"),
    async listInstallations(token) {
      const data = await gh<{ installations: Awaited<ReturnType<GitHubOAuth["listInstallations"]>> }>(token, "/user/installations?per_page=100");
      return data.installations;
    },
    async listInstallationRepos(token, installationId) {
      const repos: { id: number; full_name: string; private: boolean }[] = [];
      for (let page = 1; page <= 10; page++) {
        const data = await gh<{ repositories: typeof repos }>(token, `/user/installations/${installationId}/repositories?per_page=100&page=${page}`);
        repos.push(...data.repositories);
        if (data.repositories.length < 100) break;
      }
      return repos;
    },
  };
}
