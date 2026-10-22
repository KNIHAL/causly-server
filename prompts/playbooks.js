// Playbooks: ready-made multi-step workflows. Each one only uses tools that exist.
import { z } from "zod";

export const PIPELINE_REVIEW_PROMPT = `Review my sales pipeline and tell me what to do next.

1. Load the pipeline and reminders toolsets with load_toolset if they are not loaded yet.
2. Call pipeline_report. Summarize the open deals by stage, what is stale, and which follow-ups are due or overdue.
3. For each stale deal and each overdue follow-up, call pipeline_get, read the latest activity, and suggest one concrete next action. Draft any message, but do not send it. Wait for my approval.
4. After I confirm something was done, record it with pipeline_log_activity (with a follow-up if one is needed) and move the stage with pipeline_update if it changed.
5. Finish with the three things most worth doing today.`;

export const prospectingPrompt = (focus) => `Find prospects for: ${focus || "the kind of work I do (ask me first if that is unclear)"}.

1. Load the leads, research, pipeline and reminders toolsets with load_toolset.
2. Look for companies that need this: lead_hn_hiring and lead_remote_jobs with relevant keywords, plus web_search if it is available.
3. For the most promising ones, call lead_company_contacts to find a public business contact. Skip anyone without one.
4. Show me a short list: company, why they fit, contact, and a one-line opener. Do not add or contact anyone yet.
5. After I pick, add them with pipeline_add_lead (set source and source_url, and follow_up_in_days: 3). Draft outreach emails, but do not send anything without my approval.`;

export function registerPlaybooks(server) {
  server.registerPrompt(
    "pipeline-review",
    {
      title: "Review the pipeline",
      description: "Look at open deals, stale deals and due follow-ups, and decide what to do next.",
    },
    () => ({ messages: [{ role: "user", content: { type: "text", text: PIPELINE_REVIEW_PROMPT } }] })
  );

  server.registerPrompt(
    "prospecting",
    {
      title: "Find prospects",
      description: "Find companies that need your services, get a public contact, and add the best ones to the pipeline.",
      argsSchema: { focus: z.string().optional().describe("What you sell or the kind of client, e.g. 'react contract work for startups'") },
    },
    ({ focus }) => ({ messages: [{ role: "user", content: { type: "text", text: prospectingPrompt(focus) } }] })
  );
}
