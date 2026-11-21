import OpenAI from "openai";
import { Octokit } from "@octokit/rest";
import { makeTools } from "./tools.js";

// IA gratuite : Gemini (Google AI Studio) via l'interface compatible OpenAI.
const MODEL = process.env.MODEL ?? "gemini-flash-latest";
const MAX_STEPS = 12;             // limite de tours : évite les boucles infinies
const MAX_TOKENS_TOTAL = 60_000;  // budget : évite de dépasser le quota gratuit

const [owner, repo] = process.env.GITHUB_REPOSITORY!.split("/");
const pr = Number(process.env.PR_NUMBER);

const client = new OpenAI({
  apiKey: process.env.GEMINI_API_KEY,
  baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
});
const gh = new Octokit({ auth: process.env.GITHUB_TOKEN });
const tools = makeTools(gh, owner, repo, pr);

// Logs JSON : c'est ce que tu montres dans la vidéo pour "voir quand ça déraille".
const log = (event: string, data: object = {}) =>
  console.log(JSON.stringify({ t: new Date().toISOString(), event, ...data }));

const SYSTEM = `Tu es un relecteur de code senior. Tu relis une pull request.
Procédure : liste les fichiers modifiés, lis les diffs importants, lis le fichier complet si le diff manque de contexte.
Cherche : bugs, failles de sécurité, cas limites non gérés, manque de tests. Ignore le style.
Sois concis. Ne commente que ce dont tu es sûr. Si tu n'es pas sûr, verdict "unsure" et dis pourquoi.
Termine TOUJOURS en appelant post_review.`;

const fn = (name: string, description: string, parameters: object) => ({
  type: "function" as const,
  function: { name, description, parameters },
});

const toolDefs = [
  fn("list_changed_files", "Liste les fichiers modifiés par la PR.", { type: "object", properties: {} }),
  fn("get_file_diff", "Diff d'un fichier de la PR.", { type: "object", properties: { path: { type: "string" } }, required: ["path"] }),
  fn("read_file", "Contenu complet d'un fichier (version de la PR).", { type: "object", properties: { path: { type: "string" } }, required: ["path"] }),
  fn("post_review", "Publie la revue finale. Appel obligatoire pour terminer.", {
    type: "object",
    properties: {
      summary: { type: "string" },
      verdict: { type: "string", enum: ["ok", "issues", "unsure"] },
      comments: {
        type: "array",
        items: { type: "object", properties: { path: { type: "string" }, line: { type: "number" }, body: { type: "string" } }, required: ["path", "line", "body"] },
      },
    },
    required: ["summary", "verdict"],
  }),
];

async function escalate(reason: string) {
  log("escalate_to_human", { reason });
  await gh.issues.createComment({
    owner, repo, issue_number: pr,
    body: `🚨 L'agent de revue s'est arrêté : **${reason}**. Une relecture humaine est nécessaire.`,
  });
  process.exit(1);
}

async function main() {
  log("start", { pr, model: MODEL });
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: SYSTEM },
    { role: "user", content: `Relis la PR #${pr}.` },
  ];
  let totalTokens = 0;

  for (let step = 1; step <= MAX_STEPS; step++) {
    const res = await client.chat.completions.create({
      model: MODEL, messages, tools: toolDefs, tool_choice: "auto",
    });
    totalTokens += res.usage?.total_tokens ?? 0;
    const msg = res.choices[0].message;
    log("step", { step, finish: res.choices[0].finish_reason, totalTokens });

    if (totalTokens > MAX_TOKENS_TOTAL) return escalate("budget de tokens dépassé");
    messages.push(msg); // on renvoie le message tel quel (nécessaire pour Gemini)

    const calls = msg.tool_calls ?? [];
    if (calls.length === 0) return escalate("l'agent a terminé sans publier de revue");

    let done = false;
    for (const call of calls) {
      if (call.type !== "function") continue;
      const name = call.function.name;
      let out: string;
      try {
        const input = JSON.parse(call.function.arguments || "{}");
        log("tool_call", { name, input });
        const impl = (tools as Record<string, (i: any) => Promise<string>>)[name];
        out = await impl(input);
        if (name === "post_review") done = true;
      } catch (e) {
        // L'erreur est renvoyée à l'agent : il peut se corriger tout seul.
        log("tool_error", { name, error: String(e) });
        out = `Erreur : ${e}`;
      }
      messages.push({ role: "tool", tool_call_id: call.id, content: out });
    }
    if (done) return log("done", { steps: step, totalTokens });
  }
  await escalate(`limite de ${MAX_STEPS} étapes atteinte`);
}

main().catch((e) => escalate(`erreur inattendue : ${e}`));
