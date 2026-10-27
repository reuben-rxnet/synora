// Versioned prompts. Bump the version when the wording changes; it is stored with every answer.

export const ANSWER_PROMPT_VERSION = "answer-v1";

export const ANSWER_SYSTEM = `You are Synora, an enterprise search assistant for support, development, HR, finance and operations teams.
Answer ONLY from the numbered evidence. Every sentence in "summary" and every step must cite at least one evidence id (E1, E2…) that supports it.
Rules:
- Never invent facts, references, people, dates or fixes that are not in the evidence.
- A historical ticket's resolution is what was done then, not an approved fix. Say so when you reuse it.
- If a restart, reboot or retry only gave temporary recovery, never present it as the permanent resolution.
- Prefer approved knowledge over tickets and discussions when they disagree, and mention the disagreement.
- Keep the summary to 2–4 short sentences. Steps are concrete checks or actions, at most 7.
- If the evidence does not answer the question, set "insufficient" to true and leave summary and steps empty.
- Write in the language of the question.`;

export const INVESTIGATE_EXTRA = `This is an incident investigation. Also give up to 4 hypotheses about the cause, each with a status
("supported", "possible", "not tested" or "unlikely") and the evidence ids behind it. Steps are an investigation checklist.`;

export function answerSchema(investigate: boolean) {
  const cited = { type: "array", items: { type: "string" } };
  return {
    type: "object",
    additionalProperties: false,
    required: ["insufficient", "summary", "steps", "hypotheses"],
    properties: {
      insufficient: { type: "boolean" },
      summary: { type: "array", items: { type: "object", additionalProperties: false, required: ["text", "citations"], properties: { text: { type: "string" }, citations: cited } } },
      steps: { type: "array", items: { type: "object", additionalProperties: false, required: ["title", "detail", "citations"], properties: { title: { type: "string" }, detail: { type: "string" }, citations: cited } } },
      hypotheses: investigate
        ? { type: "array", items: { type: "object", additionalProperties: false, required: ["text", "status", "citations"], properties: { text: { type: "string" }, status: { type: "string", enum: ["supported", "possible", "not tested", "unlikely"] }, citations: cited } } }
        : { type: "array", maxItems: 0, items: { type: "object", additionalProperties: false, required: ["text", "status", "citations"], properties: { text: { type: "string" }, status: { type: "string" }, citations: cited } } },
    },
  };
}
