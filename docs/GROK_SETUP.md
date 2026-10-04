# Grok for Wildman Hockey

Wildman uses its existing OpenRouter connection for two optional Grok workflows.
The default model is `x-ai/grok-4.7`, verified against the
[OpenRouter model documentation](https://openrouter.ai/x-ai/grok-4.7) on October 4, 2026.
OpenRouter API credits and access to that model are required; a Grok chat subscription alone does not supply API credits.

## Hockey scouting

1. Sign in to `hitmen-gm-ai.html` as Calgary owner, GM, AGM or Wildman admin.
2. Enter a hockey question and choose **Grok — second opinion** under **Scouting analyst**.
3. Select **Analyze Hockey Question**. Choose Claude and repeat to compare answers.

Both models receive the existing hockey framework and evidence retrieval, with the same
management authorization and citation checks. Evidence is fetched anew each time, so records
can change between requests. Prior answers (up to four) remain collapsed below the current
answer during the session. Every successful analysis is appended to the existing
`hitmen_ai_analysis_runs` history with its model and provider. A failed history write is shown
as a warning. Signing out clears browser comparison history.

This does not replace the Railway VOD model or re-run footage. Grok sees the same approved
published VOD evidence, structured stats, schedule and management context as the GM assistant.
Responses are advisory and cannot approve, publish, overwrite reviewed evidence or edit rosters.

The Vercel server needs its existing `OPENROUTER_API_KEY`. Optional `GROK_MODEL` selects another
supported OpenRouter `x-ai/grok-*` model. The default supports low/high/xhigh reasoning effort;
verify effort compatibility before changing it. Claude and `CLAUDE_MODEL` remain the default.
No API key belongs in browser JavaScript or local storage. No database migration is needed.

## Coding helper in Ubuntu WSL

Use Node 24 and Git in your existing VVHL-HUB checkout. There are no npm dependencies.

```bash
node scripts/grok-code.cjs --help
node scripts/grok-code.cjs --question "Check this function for bugs" --file vod-review-model.js --dry-run
```

For a live review, configure your own OpenRouter API key locally. In Bash, this prompts without
showing the key or placing its value in shell history:

```bash
read -rsp 'OpenRouter API key: ' OPENROUTER_API_KEY
export OPENROUTER_API_KEY
node scripts/grok-code.cjs --question "Review the VOD state reconciliation and suggest a minimal fix if needed" --file vod-review-model.js
unset OPENROUTER_API_KEY
```

The website's server key is not automatically available in your terminal. Obtain a key through
your OpenRouter account; do not paste it into chat. `GROK_CODE_MODEL` can override the coding model.

Repeat `--file` to include related files and quote filenames containing spaces. The helper sends
only your question and selected tracked source files to OpenRouter/xAI. It blocks environment
files, common credential patterns, symlinks, untracked files and excessive context. Review what
you select: pattern checks cannot guarantee that arbitrary source contains no private data.
`--dry-run` lists paths and size without sending a model request. Results print to the terminal;
they do not execute shell commands, edit files, commit or deploy. Review suggested patches with
Codex or management and run the repository's tests before applying them.

## Verification and troubleshooting

```bash
node test-deep-scout.cjs
node test-grok.cjs
node test-grok-code.cjs
```

- Missing key: configure `OPENROUTER_API_KEY` in Vercel for scouting, or your local environment for coding.
- Credits/model access error: check OpenRouter balance and the key's model restrictions.
- Rate limit: wait and retry. Requests never silently fall back to another model.
- Authentication error: sign into Wildman with an authorized management account. Do not relax access checks.
- Truncated/empty/model-error response: no scouting report is saved. Narrow the question and retry.
- A second opinion is not corroborating evidence. Validate disagreement against stats and footage.

Mocked tests verify routing and failure handling without paid calls. Live model access must also
be checked with a signed-in management request and a locally configured coding key.
