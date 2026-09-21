// api/chelscout-deepthink.js
// Dual-model NHL Scout + Gameplay Mechanics AI endpoint.
// Plain Vercel serverless function, zero npm dependencies - calls both APIs directly with fetch().
//
// Routing logic:
//   - Gemini Flash handles quick lookups / simple stat questions (cheap, fast).
//   - Claude Sonnet handles deep reasoning: lineup construction, trade/roster value,
//     and gameplay mechanics diagnosis (higher quality reasoning, higher cost per call).
//   - The client can force a model via { forceModel: "gemini" | "sonnet" } in the request body;
//     otherwise the endpoint classifies the question automatically.
//
// Setup:
// 1. In Vercel Project Settings -> Environment Variables, add:
//      GEMINI_API_KEY
//      ANTHROPIC_API_KEY
// 2. (Optional) Point SUPABASE_URL / SUPABASE_ANON_KEY at your roster/stats tables so the model
//    reasons over live data instead of whatever the client sends.
// 3. POST { "question": "...", "context": "...", "forceModel": "gemini"|"sonnet" } to /api/chelscout-deepthink

const SYSTEM_PROMPT = `You are the head scout and gameplay strategist for the Wildman Hockey / VVHL team, competing in CHL and LG on NHL EASHL. You combine two disciplines:

1. Scouting/analytics - player value, chemistry, lineup construction, built from provided stats (previous LG seasons, current pub stats, WOWY data).
2. Gameplay mechanics coaching - skating mechanics, deking, hitting, defensive positioning, goalie logic, and build/archetype-specific strategy.

CRITICAL RULES:
- Never invent stats, results, or unverified patch-specific mechanics. If data is missing, say so explicitly and ask for it rather than guessing.
- Label claims as stats-based (from provided data), mechanics/rules-based (game logic), or strategic judgment (your synthesis), when precision matters.
- Do not use hype language ("elite", "generational") unless the provided stats clearly support it.

GAMEPLAY MECHANICS REASONING ORDER (when the question is about execution, not roster building):
1. Fundamentals - skating engine mechanics, stick-checking timing, positioning basics.
2. Situational execution - how the fundamental applies to the specific scenario described.
3. Build/archetype interaction - how the player's chosen build/attributes change the optimal play.
4. Meta context - only assert this if given or clearly inferable; otherwise flag as unverified.

OUTPUT FORMAT for every answer:
1. Quick verdict (1-2 sentences, direct answer first)
2. Reasoning steps (numbered, showing the actual chain of logic - cite the specific stats/context used)
3. Recommendation (concrete and actionable)
4. Data/Info Needed (only if something relevant was missing - state exactly what would sharpen the answer)`;

const DEEP_KEYWORDS = [
  'lineup', 'line combo', 'line combination', 'pairing', 'trade', 'worth', 'value',
  'compare', 'should i keep', 'should i cut', 'should i play', 'chemistry',
  'why do i keep', 'why am i', 'diagnose', 'matchup', 'best build for', 'roster',
];

function classify(question, forceModel) {
  if (forceModel === 'gemini' || forceModel === 'sonnet') return forceModel;
  const q = question.toLowerCase();
  return DEEP_KEYWORDS.some((kw) => q.includes(kw)) ? 'sonnet' : 'gemini';
}

async function fetchTeamContext() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
    return null;
  }
  try {
    const res = await fetch(`${process.env.SUPABASE_URL}/rest/v1/roster?select=*`, {
      headers: {
        apikey: process.env.SUPABASE_ANON_KEY,
        Authorization: `Bearer ${process.env.SUPABASE_ANON_KEY}`,
      },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return JSON.stringify(data);
  } catch (err) {
    console.error('Supabase roster fetch failed:', err);
    return null;
  }
}

async function callGemini(userText) {
  const model = 'gemini-flash-latest';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`;
  const body = {
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [{ role: 'user', parts: [{ text: userText }] }],
    generationConfig: {
      temperature: 0.4,
      thinkingConfig: { thinkingBudget: 1024, includeThoughts: false },
    },
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Gemini error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join('\n') || '(No answer returned.)';
}

async function callSonnet(userText) {
  const url = 'https://api.anthropic.com/v1/messages';
  const body = {
    model: 'claude-sonnet-4-5',
    max_tokens: 2048,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userText }],
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Claude error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data?.content?.map((c) => c.text).join('\n') || '(No answer returned.)';
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const { question, context, forceModel } = req.body || {};
  if (!question || typeof question !== 'string') {
    res.status(400).json({ error: "Missing 'question' in request body" });
    return;
  }

  const modelChoice = classify(question, forceModel);

  if (modelChoice === 'gemini' && !process.env.GEMINI_API_KEY) {
    res.status(500).json({ error: 'GEMINI_API_KEY is not configured on this project' });
    return;
  }
  if (modelChoice === 'sonnet' && !process.env.ANTHROPIC_API_KEY) {
    res.status(500).json({ error: 'ANTHROPIC_API_KEY is not configured on this project' });
    return;
  }

  try {
    const liveContext = await fetchTeamContext();
    const combinedContext = liveContext || context || '(No roster/stats context provided.)';
    const userText = `TEAM CONTEXT:\n${combinedContext}\n\nQUESTION:\n${question}`;

    const answer = modelChoice === 'sonnet' ? await callSonnet(userText) : await callGemini(userText);

    res.status(200).json({ answer, model: modelChoice });
  } catch (err) {
    console.error('Scout AI error:', err);
    res.status(500).json({ error: 'Failed to generate scouting response', detail: String(err) });
  }
};
