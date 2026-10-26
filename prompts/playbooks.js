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

export const processMeetingPrompt = (source) => `Turn a meeting into notes, action items and follow-ups. Source: ${source || "a recording or transcript I will point you to (ask me which if it is unclear)"}.

1. Load the meetings toolset with load_toolset (also pipeline, calendar and reminders if they are set up).
2. Recording: tell me the audio will be uploaded to Groq, and call meeting_transcribe with confirm: true only after I agree. Transcript file or pasted text: skip to step 3 and pass it to meeting_save yourself.
3. Read the transcript. Whisper does not name speakers, so work out who said what from context and ask me if it is unclear.
4. Work out the context: if one of the calendar_matches is clearly this meeting use its event_id; if the guests match a pipeline deal (pipeline_list) use its deal_id.
5. Call meeting_save with the meeting_id: a short summary, the decisions, and action items with owner and due_date (YYYY-MM-DD) wherever they were stated. Never invent a due date.
6. Show me the summary and action items. Draft any follow-up email, but do not send anything without my approval.`;

export const meetingPrepPrompt = (who) => `Prepare me for a meeting${who ? ` with ${who}` : ""}.

1. Load the meetings toolset with load_toolset (also calendar and pipeline if they are set up).
2. Find the meeting: calendar_list_events for the event id, or use the emails or company I give you.
3. Call meeting_prep with the event_id, attendees or query.
4. Give me a one-page brief: who they are, where the deal stands, what was agreed last time, what is still open on both sides, and three questions worth asking. Flag anything overdue.`;

export function registerPlaybooks(server) {
  server.registerPrompt(
    "process-meeting",
    {
      title: "Process a meeting",
      description: "Transcribe a recording or read a transcript, then save notes, action items with reminders, and link the deal.",
      argsSchema: { source: z.string().optional().describe("Recording or transcript file path, or 'the pasted text'") },
    },
    ({ source }) => ({ messages: [{ role: "user", content: { type: "text", text: processMeetingPrompt(source) } }] })
  );

  server.registerPrompt(
    "meeting-prep",
    {
      title: "Prep for a meeting",
      description: "Brief on the calendar event, pipeline deal, past meetings and open action items before a call.",
      argsSchema: { who: z.string().optional().describe("Person, company or event, e.g. 'Asha at Acme'") },
    },
    ({ who }) => ({ messages: [{ role: "user", content: { type: "text", text: meetingPrepPrompt(who) } }] })
  );

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
