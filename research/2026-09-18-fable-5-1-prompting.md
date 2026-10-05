Research checked on **September 18, 2026**. Both requested model identifiers are documented. Below, I distinguish model-specific recommendations from my proposed harness design; Anthropic explicitly cautions against assuming guidance measured on one model transfers unchanged to another. [Model overview](https://platform.claude.com/docs/en/models/overview), [Prompting best practices](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices)

**1. Fable 5.1: documented traits and countermeasures**

The following are the practical behavioral changes in its dedicated prompting guide.

| Documented behavior | Recommended response |
|---|---|
| Sparse progress narration | Request brief updates and a self-contained final recap. [Source](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-fable-5-1#ask-for-user-facing-progress-updates) |
| Dense prose | Request plain language; remove “mannered prose.” [Source](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-fable-5-1#writing-density) |
| Too little formatting | Remove blanket formatting prohibitions; permit useful structure. [Source](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-fable-5-1#formatting-in-chat) |
| Premature stopping or unnecessary permission requests | Explicitly require completion of already-authorized work. [Source](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-fable-5-1#finish-the-whole-task) |
| Autonomy prompting can suppress useful questions | Evaluate ambiguity handling; specify confirmation boundaries. [Source](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-fable-5-1#finish-the-whole-task) |
| Extra changes and excessive permanent tests | Bound scope and match repository testing conventions. [Source](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-fable-5-1#keep-changes-and-tests-to-what-the-task-asks-for) |
| Sequential independent tool calls | Append a batching reminder after tool results. [Source](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-fable-5-1#batch-independent-tool-calls-in-agent-loops) |
| Reduced searching at low effort | Require verification of unfamiliar or rapidly changing names. [Source](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-fable-5-1#search-triggering-at-low-effort) |
| Whole-file rewrites | Prefer targeted edits when equivalent. [Source](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-fable-5-1#prefer-targeted-edits-over-whole-file-rewrites) |
| Lost compaction details | Preserve constraints, decisions, status, unresolved work, and exact references. [Source](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-fable-5-1#tell-the-model-what-to-preserve-in-compaction-summaries) |
| Unmarked source wording | Supply a correct quotation-and-paraphrase example. [Source](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-fable-5-1#quoting-retrieved-sources) |
| Orchestrator waiting unnecessarily | Make spawning asynchronous; provide a separate waiting tool. [Source](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-fable-5-1#let-the-lead-agent-keep-working-while-subagents-run) |

**Instruction sensitivity is partly inherited guidance.** The Fable 5 page says “a brief instruction rather than enumerating each behavior by name” can steer behavior. It recommends explaining intent, grounding progress claims in tool evidence, and defining boundaries between assessment and implementation. These are Fable-family recommendations, rather than newly demonstrated Fable 5.1 differences. [Fable 5 prompting](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-fable-5)

**Thinking needs configuration, not merely stronger wording.** Fable 5.1 uses adaptive thinking exclusively; disabling thinking or supplying a manual `budget_tokens` configuration produces an error. Start with `high` effort and evaluate alternatives. Anthropic’s thinking guidance recommends adjusting effort before adding prompt-based steering; effort is a soft control, while `max_tokens` limits thinking and visible output together. Leave room for both. [Fable 5.1 migration](https://platform.claude.com/docs/en/models/fable-5-1/migration-guide), [Steering thinking](https://platform.claude.com/docs/en/build-with-claude/thinking-steering-and-cost)

**Apparent silence can be a rendering problem.** Fable’s intermediate narration arrives in thinking blocks, whereas Opus 5 returns it in text blocks. With the default omitted display, Fable’s narration is unreadable. Request `thinking.display: "updates"` with the applicable beta, or `"summarized"`, and render nonempty blocks. Prompt changes alone cannot repair a client that discards those updates. [Migration: differences from Opus 5](https://platform.claude.com/docs/en/models/fable-5-1/migration-guide)

**2. What the orchestrator system prompt should contain**

My recommended design is a small, explicit operating contract plus separately supplied task context. Anthropic recommends distinct sections, clear language, and sufficient detail without brittle procedural scripts; it does **not** prescribe one mandatory section order or universal prompt length. The ordering below is my synthesis. [Effective context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)

| Suggested order | Contents and placement |
|---|---|
| **1. Product and role** | Identify the coding harness, the orchestrator’s responsibility, and who consumes its output. Anthropic places product context at the center of a custom system prompt. [Claude 5 context engineering](https://claude.com/blog/the-new-rules-of-context-engineering-for-claude-5-generation-models) |
| **2. Authority and boundaries** | State the actual permission model, when implementation is authorized, and which actions require escalation. A custom Agent SDK prompt must supply the relevant safety and tool guidance itself. [Modifying system prompts](https://code.claude.com/docs/en/agent-sdk/modifying-system-prompts) |
| **3. Completion and communication** | Define completion, meaningful progress updates, and the final deliverable; distinguish human-facing reporting from messages to builders. Make the output contract explicit. [Prompting best practices](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices) |
| **4. Delegation contract** | Describe which work belongs to builders, what context accompanies a delegation, and what must return. Fresh subagents do not automatically receive the parent’s conversation or system prompt. [Agent SDK subagents](https://code.claude.com/docs/en/agent-sdk/subagents) |
| **5. Repository conventions** | Supply unusual commands, architectural constraints, environment quirks, and repository etiquette through project context; avoid a general programming tutorial. [Claude Code best practices](https://code.claude.com/docs/en/best-practices) |
| **6. State continuity** | Explain the real compaction and persistence mechanisms, including where durable task state lives. Keep summarization requirements in the compaction configuration where possible. [Compaction](https://platform.claude.com/docs/en/build-with-claude/compaction) |

Tool-specific instructions belong primarily in **tool definitions**: purpose, use conditions, parameters, limitations, and returned information. Keep orchestration policy in the system prompt. Anthropic’s tool documentation emphasizes descriptive interfaces and useful responses; its newer context-engineering article recommends removing duplicated tool instructions from the main prompt. [Define tools](https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools), [Claude 5 context engineering](https://claude.com/blog/the-new-rules-of-context-engineering-for-claude-5-generation-models)

**Stable prefix versus per-turn tail**

Use this conceptual arrangement:

| Location | Recommended content |
|---|---|
| Stable `tools` | Tool schemas and descriptions. |
| Stable top-level `system` | Product identity, durable behavior, permissions, delegation and reporting contracts. |
| Stable reusable context | Project instructions or references that genuinely remain unchanged. |
| Appended conversation | User requests, results, decisions, builder reports, and newly relevant context. |
| Appended system message | New operator-level constraints or state changes. |
| Turn-scoped system message | A temporary batching or communication reminder. |

This arrangement follows the documented cache hierarchy: `tools`, then `system`, then `messages`. Cache hits require matching prefixes; enable caching explicitly and put a breakpoint at the reusable boundary, or use automatic caching. The minimum cacheable prompt for both requested models is 512 tokens, but padding a prompt merely to reach that minimum is not my recommendation. [Prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)

For the temporary tail, the documented mechanism is:

```json
{
  "role": "system",
  "clear_at": "next_user_message",
  "content": "Request independent reads together when their inputs are already known."
}
```

`clear_at` requires `mid-conversation-system-clear-at-2026-08-21`. Append the message after the user message containing tool results; retain earlier copies unchanged. Clearing is performed by the API, not by deleting history. Ordinary mid-conversation system messages do not require that beta. Keep raw retrieved text and tool output in tool results rather than elevating them to system authority. [Mid-conversation system messages](https://platform.claude.com/docs/en/build-with-claude/mid-conversation-system-messages)

This is also a correctness requirement for Fable 5.1: editing its earlier system prompt, tools, or messages can invalidate subsequent thinking blocks. Prefer server-side compaction; if compacting on the client, avoid replaying thinking blocks bound to the replaced history. Do not implement the tail by rebuilding the top-level system prompt each turn. [Fable 5.1 migration](https://platform.claude.com/docs/en/models/fable-5-1/migration-guide)

**What to leave out, and the exceptions**

- **Blanket capitalized urgency.** I found no Fable 5.1-specific rule banning capital letters or the words `ALWAYS` and `NEVER`. General guidance favors clear instructions with reasons; Claude Code documentation permits emphasizing one persistently missed instruction while warning that emphasizing many defeats the purpose. Use strong language for a genuine invariant, not every preference. [Prompting best practices](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices), [Claude Code best practices](https://code.claude.com/docs/en/best-practices)

- **Long forbidden-phrase lists.** Prefer an affirmative description of the desired writing. The Fable-family guidance supports short behavioral instructions instead of enumerating every unwanted habit. This is a recommendation to simplify style control, not a claim that exact lexical restrictions never work. [Fable 5 prompting](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-fable-5)

- **Repeated retention scaffolding and duplicated manuals.** Anthropic’s July 2026 account describes removing repeated tool instructions and moving specialized guidance to dynamically loaded resources. Preserve real task state, but do not keep repeating the entire operating manual to compensate for older models. [Claude 5 context engineering](https://claude.com/blog/the-new-rules-of-context-engineering-for-claude-5-generation-models)

- **Examples that accidentally dictate strategy.** The newer guidance warns that tool examples can constrain exploration; general prompting guidance still endorses diverse examples for output consistency. My interpretation: prefer expressive schemas for tools, and add narrowly targeted examples when an observed failure warrants them. Do not treat either document as a universal prohibition or requirement. [Claude 5 context engineering](https://claude.com/blog/the-new-rules-of-context-engineering-for-claude-5-generation-models), [Prompting best practices](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices)

- **Promises about harness capabilities that are untrue.** Tell the model about actual compaction and persistence behavior. A compaction prompt should preserve continuation state; supplying custom compaction instructions replaces the default rather than supplementing it. [Compaction](https://platform.claude.com/docs/en/build-with-claude/compaction)

- **Requests to reproduce private reasoning.** The Fable-family documentation warns that instructions to echo internal reasoning can trigger refusal behavior. Request conclusions, evidence, and decisions instead. [Fable 5 prompting](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-fable-5)

**What the 2026 third-party evidence adds**

LangChain’s July 29 **Deep Agents v0.7** report supports simplifying inherited scaffolding: it reports 65% fewer base input tokens with comparable performance and made task-list middleware optional. However, its listed evaluation models did not include Fable 5.1 or Opus 5. Treat it as evidence for testing prompt simplification, not proof of either requested model’s behavior. [Deep Agents v0.7](https://www.langchain.com/blog/deep-agents-v0-7)

LangChain’s February harness-engineering report emphasizes self-verification and tracing, but its fixed model was `gpt-5.2-codex`. Consequently, I would adopt its **trace-driven evaluation method**, not transfer its verification instructions into an Opus 5 builder unchanged. [Improving Deep Agents with harness engineering](https://www.langchain.com/blog/improving-deep-agents-with-harness-engineering)

Its April evaluation methodology recommends targeted changes, checking regressions as well as aggregate gains, and reviewing proposed updates. For this harness, my suggested evaluation cases are premature stopping, unnecessary questions, scope expansion, missed updates, redundant testing, delegation errors, and compaction continuity. [Better Harness](https://www.langchain.com/blog/better-harness-a-recipe-for-harness-hill-climbing-with-evals)

**3. Opus 5 as a scoped builder**

The documented differences justify a distinct builder prompt:

| Documented Opus 5 behavior | Builder implication |
|---|---|
| Benefits from complete specifications and uninterrupted execution | Supply the whole scoped unit before execution. |
| Longer responses and ready narration | Explicitly request concise reporting; lowering effort does not reliably shorten visible output. |
| Can expand task scope | Define boundaries and material-ambiguity escalation. |
| Verifies and self-corrects without prompting | Remove generic repeated checking and mandatory verifier-agent instructions. |
| Delegates readily | Limit delegation; small units should generally remain local. |
| Written artifacts can be unnecessarily long | Specify useful content and proportionate length. |

These are documented tendencies, not a published quantitative comparison establishing how much more scope guarding Opus needs than Fable. Both need boundaries. The Opus page’s instruction is “Deliver what was asked, at the scope intended.” [Opus 5 prompting](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-opus-5)

For **your builder contract**, I would supply the following per assignment:

- Objective and acceptance criteria.
- Relevant files, interfaces, decisions, and error evidence.
- Owned work and explicit exclusions.
- Required repository checks.
- When to report a blocker or request a scope decision.

This is my synthesis of the documented fresh-context delegation model. A normal subagent receives its own prompt and the delegation message, not the parent’s entire reasoning history; the parent receives its final message as the tool result. [Agent SDK subagents](https://code.claude.com/docs/en/agent-sdk/subagents)

I would use this compact handoff format:

```text
Outcome: complete | partial | blocked
Implemented: behavior delivered and relevant files
Validation: commands actually run and observed results
Open issues: blockers, assumptions, and unimplemented requirements
Follow-ups: relevant findings outside this assignment
```

That is a proposed integration contract, **not an Anthropic-prescribed Opus schema**. Explicit output contracts are supported by the prompting guidance; structured handoffs also appear in Anthropic’s long-running application-development harness design. [Prompting best practices](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices), [Long-running application harness design](https://www.anthropic.com/engineering/harness-design-long-running-apps)

Keep required tests and acceptance evidence. Removing redundant self-check instructions does not mean removing task requirements. Older Fable guidance recommends fresh-context verification for long runs, while Opus 5 specifically advises removing inherited verification scaffolding; apply those recommendations to their respective roles rather than copying one shared prompt everywhere. [Fable 5 prompting](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-fable-5), [Opus 5 prompting](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-opus-5)

For a strictly scoped worker, enforce capabilities in the harness as well. Claude Code supports separate subagent tools, permissions, and working contexts; prompt prose alone is not the mechanism that restricts tool availability. [Custom subagents](https://code.claude.com/docs/en/sub-agents)

**4. Excluded scope**

OAuth and plan-billed session behavior are omitted as requested.

**5. Copy-ready sentences**

These are my proposed wording, not quotations; use the orchestrator sentences for Fable and the builder-specific ones for Opus.

1. **Role:** “You coordinate coding work in this harness and are responsible for turning the user’s request into a completed, reviewable result.” [Product context guidance](https://claude.com/blog/the-new-rules-of-context-engineering-for-claude-5-generation-models)

2. **Scope:** “Treat the requested outcome and approved constraints as your scope, and report unrelated improvements separately.” [Fable-family boundaries](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-fable-5)

3. **Autonomy:** “Proceed with authorized reversible work, and pause when missing input, destructive consequences, or a material scope decision requires the user.” [Fable-family checkpoint guidance](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-fable-5)

4. **Progress:** “Briefly state your next action, communicate meaningful developments, and finish with a recap understandable without earlier updates.” [Fable 5.1 progress guidance](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-fable-5-1#ask-for-user-facing-progress-updates)

5. **Style:** “Explain the result in plain language, with enough structure and detail for the reader to act.” [Clear output guidance](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices)

6. **Repository fit:** “Follow the surrounding code’s naming, organization, and level of commentary unless the task requires a change.” [Claude 5 context engineering](https://claude.com/blog/the-new-rules-of-context-engineering-for-claude-5-generation-models)

7. **Delegation:** “Give each builder the objective, relevant context, owned scope, acceptance criteria, and expected return format.” [Subagent context requirements](https://code.claude.com/docs/en/agent-sdk/subagents)

8. **Temporary batching reminder:** “Request independent reads together when their inputs are already known.” [Turn-scoped system messages](https://platform.claude.com/docs/en/build-with-claude/mid-conversation-system-messages)

9. **Compaction:** “Preserve the current objective, binding constraints, established decisions, completed work, unresolved items, and references needed to continue.” [Compaction instructions](https://platform.claude.com/docs/en/build-with-claude/compaction)

10. **Builder scope:** “Complete the assigned unit without expanding it, and escalate ambiguity only when different interpretations would materially change the work.” [Opus 5 scope guidance](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-opus-5#task-scope-and-over-verification)

11. **Builder delegation:** “Handle this scoped unit yourself unless the orchestrator explicitly authorizes further delegation.” [Agent SDK delegation controls](https://code.claude.com/docs/en/agent-sdk/subagents#run-opus-5-with-subagents)

12. **Builder return:** “Return a concise handoff stating the outcome, changed files, observed validation results, unresolved requirements, and follow-ups.” [Structured handoffs](https://www.anthropic.com/engineering/harness-design-long-running-apps), [Subagent result delivery](https://code.claude.com/docs/en/agent-sdk/subagents)
