# AI provider abstraction

**Status**: accepted (2026-08-20)

## Context

The AI features were originally described in governance and proposal documents as using
Google Gemini. The shipped server uses an `AIProvider` abstraction and a configured
provider implementation, while the use-case requirements are about assistive, grounded,
non-blocking behavior rather than a particular vendor. Keeping Gemini as a fixed
technology requirement would make the constitutional and product documentation disagree
with the implementation and would turn a replaceable adapter into a domain requirement.

## Decision

- AI use cases and feature specifications are provider-neutral.
- The server calls AI through the shared `AIProvider` abstraction; provider and model
  selection is configuration and implementation detail.
- At most one configured AI provider participates in the four-external-integration cap.
- Provider-backed requests remain subject to the existing authentication, grounding,
  bounded-context, allowance, quota, timeout, and fallback rules.
- Cache hits do not consume the user's model-backed allowance or platform provider quota.
- Vendor-specific implementation details may be documented here or in provider-specific
  technical notes, but must not be presented as UC-level product behavior.

## Consequences

- Replacing the configured provider does not require rewriting UC-10 or UC-22.
- Governance documents describe the abstraction and the cap without naming a mandatory
  vendor.
- Deployment diagrams need not show a fixed provider node; the active provider is an
  environment and operations concern.
- Existing vendor references in historical research or dependency inventories remain
  historical evidence, not normative requirements.

## Related records

- `src/.specify/memory/constitution.md` — technology and integration constraints
- `src/specs/008-ai-chatbot/spec.md` — provider-neutral feature behavior
- `src/specs/006-organizer-studio/spec.md` — provider-neutral listing assistant behavior
- `docs/Analysis_Design/Group02_UseCaseSpecification.md` — UC-10 and UC-22
- `server/src/modules/ai/providers/ai.provider.ts` — runtime provider contract
