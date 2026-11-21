import { Octokit } from "@octokit/rest";

const MAX_CHARS = 15_000; // garde-fou : on tronque les sorties d'outils

const cut = (s: string) =>
  s.length > MAX_CHARS ? s.slice(0, MAX_CHARS) + "\n…[tronqué]" : s;

export function makeTools(gh: Octokit, owner: string, repo: string, pr: number) {
  return {
    async list_changed_files() {
      const { data } = await gh.pulls.listFiles({ owner, repo, pull_number: pr, per_page: 100 });
      return JSON.stringify(
        data.map((f) => ({ path: f.filename, status: f.status, additions: f.additions, deletions: f.deletions }))
      );
    },

    async get_file_diff({ path }: { path: string }) {
      const { data } = await gh.pulls.listFiles({ owner, repo, pull_number: pr, per_page: 100 });
      const f = data.find((x) => x.filename === path);
      return f?.patch ? cut(f.patch) : "Pas de diff disponible (fichier binaire ou trop gros).";
    },

    async read_file({ path }: { path: string }) {
      const { data: prData } = await gh.pulls.get({ owner, repo, pull_number: pr });
      const res = await gh.repos.getContent({ owner, repo, path, ref: prData.head.sha });
      if (Array.isArray(res.data) || !("content" in res.data)) return "Ce n'est pas un fichier.";
      return cut(Buffer.from(res.data.content, "base64").toString("utf8"));
    },

    // Seule action d'écriture. Jamais "APPROVE", jamais de merge : l'humain décide.
    async post_review(input: {
      summary: string;
      verdict: "ok" | "issues" | "unsure";
      comments?: { path: string; line: number; body: string }[];
    }) {
      const icon = { ok: "✅", issues: "⚠️", unsure: "🤔" }[input.verdict];
      const body = `${icon} **Revue automatique (agent IA)**\n\n${input.summary}\n\n_Un humain doit valider avant le merge._`;
      try {
        await gh.pulls.createReview({
          owner, repo, pull_number: pr, event: "COMMENT", body,
          comments: (input.comments ?? []).map((c) => ({ path: c.path, line: c.line, body: c.body })),
        });
      } catch {
        // Un commentaire inline pointe souvent hors du diff : on retombe sur le résumé seul.
        await gh.pulls.createReview({ owner, repo, pull_number: pr, event: "COMMENT", body });
      }
      return "Revue publiée.";
    },
  };
}
