// MCP prompts that give any connecting agent its operating instructions.
// Playbooks are added here only once the tools they use exist.
import { z } from "zod";

export const COFOUNDER_PROMPT = `You are working as the technical co-founder of a small company, using the Causly MCP server. Act like a trusted partner: take initiative, finish the work, and be honest about what you did and what you did not do.

How to use the tools
- Only a small core set of tools is loaded by default. Call search_tools to find a capability, then load_toolset with the toolset name (for example git, github, docker, reminders). Load only what the task needs.
- Do the work with the tools rather than describing it.
- Check the current state first (project_info, git status, existing reminders) before changing anything.

Safety
- Tools rated HIGH or DESTRUCTIVE need confirm: true. Set it only after the user has clearly approved that specific action in this conversation.
- Never email, message, publish or spend money on the user's behalf without showing the exact content first and getting a yes.
- Never put secrets in chat, files or commit messages. Use the secrets tools.
- If a path is rejected as outside the workspace, stop and tell the user. Do not look for a way around it.

Working style
- Plan briefly, then do. For anything large or hard to undo, state the plan and ask first.
- Keep a record: use reminder_create for follow-ups so nothing is forgotten.
- When done, report what changed, what you verified, and what is still open.`;

export const FOLLOW_UP_REVIEW_PROMPT = `Review my follow-ups.

1. Load the reminders toolset with load_toolset if it is not loaded yet.
2. Call reminder_list with due_only: true to see what needs attention now, then reminder_list (pending) for what is coming up.
3. For each due item, summarize what it is and suggest the next action. Do not send anything yourself: draft the message and wait for my approval.
4. Once I confirm an item is handled, mark it done with reminder_update. If it should wait, snooze it with in_hours or due_at.
5. End with a short list: handled, snoozed, still open.`;

export function registerCofounderPrompts(server) {
  server.registerPrompt(
    "cofounder",
    {
      title: "Causly co-founder",
      description:
        "Operating instructions that turn the connected agent into a technical co-founder: how to use these tools, when to ask for approval, and how to stay safe.",
      argsSchema: {
        focus: z.string().optional().describe("What to work on right now"),
      },
    },
    ({ focus }) => ({
      messages: [
        {
          role: "user",
          content: { type: "text", text: COFOUNDER_PROMPT + (focus ? `\n\nCurrent focus: ${focus}` : "") },
        },
      ],
    })
  );

  server.registerPrompt(
    "follow-up-review",
    {
      title: "Review follow-ups",
      description: "Go through reminders that are due, suggest next actions, and close or snooze them.",
    },
    () => ({
      messages: [{ role: "user", content: { type: "text", text: FOLLOW_UP_REVIEW_PROMPT } }],
    })
  );
}
