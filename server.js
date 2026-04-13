/**
 * AI Coaching Simulation — Backend Server
 * Express + Anthropic API
 */

const express = require("express");
const path = require("path");

const app = express();
app.use(express.json());
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
app.use(express.static(path.join(__dirname, "public")));

// ── POST /api/ai ──────────────────────────────────────────────────────────────
app.post("/api/ai", async (req, res) => {
  const { questionNumber, userResponse, priorResponses, devPrompt } = req.body;

  if (!userResponse || !questionNumber) {
    return res.status(400).json({ error: "Missing required fields." });
  }

  // Build context string from prior responses
  const contextBlock =
    priorResponses && priorResponses.length > 0
      ? priorResponses
          .map(
            (r, i) =>
              `Question ${i + 1}: "${r.question}"\nUser's response: "${r.answer}"`
          )
          .join("\n\n")
      : null;

  // Scenario questions for reference
  const questions = [
    'Client says: "Your service isn\'t meeting expectations." — How would you handle this situation?',
    'Client says: "This has been ongoing for weeks." — How would you build on your earlier response?',
    'Client says: "We\'re considering other providers." — How would you resolve this?',
  ];

  const currentQuestion = questions[questionNumber - 1];

  // ── System prompt ─────────────────────────────────────────────────────────
  const systemPrompt = `You are an expert client success coach evaluating a professional's live response during a simulated client conversation.

EVALUATION FRAMEWORK:
Assess every response across three dimensions:
1. Empathy — Does the person acknowledge the client's feelings and validate their frustration?
2. Curiosity — Do they ask questions to understand root causes, or dig deeper into the issue?
3. Ownership — Do they take clear responsibility and commit to concrete next steps?

FEEDBACK STYLE:
- Be direct, warm, and coaching-oriented — not clinical or robotic
- Lead with what they did well before addressing gaps
- When noting weaknesses, explain *why* it matters to the client relationship
- Always close with one specific, actionable improvement tip
- Keep feedback between 100–160 words
- Do NOT use bullet points or lists — write in flowing, natural paragraphs
- Do NOT repeat the user's words verbatim more than once

${devPrompt ? `ADDITIONAL COACHING FOCUS (developer-defined):\n${devPrompt}` : ""}

${
  contextBlock
    ? `PRIOR CONVERSATION CONTEXT (use this to give progression-aware feedback):\n${contextBlock}`
    : ""
}`;

  // ── User message ──────────────────────────────────────────────────────────
  const userMessage = `Current scenario prompt (Question ${questionNumber} of 3):
"${currentQuestion}"

The professional responded:
"${userResponse}"

${
  contextBlock
    ? `This is not their first response. Reference their earlier answers where relevant to show growth or missed opportunities.`
    : `This is their first response in the simulation.`
}

Provide coaching feedback now.`;

  // ── Call Anthropic with retry on overload ────────────────────────────────
  const MAX_RETRIES = 3;
  const RETRY_DELAY_MS = 2000; // 2 seconds between retries

  const callAnthropic = async () => {
    return fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1000,
        system: systemPrompt,
        messages: [{ role: "user", content: userMessage }],
      }),
    });
  };

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  try {
    let lastError = null;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      const response = await callAnthropic();

      if (response.ok) {
        const data = await response.json();
        const text = data.content
          .filter((b) => b.type === "text")
          .map((b) => b.text)
          .join("\n");
        return res.json({ feedback: text });
      }

      const errBody = await response.json().catch(() => ({}));
      const isOverloaded = errBody?.error?.type === "overloaded_error";

      console.error(`Anthropic API error (attempt ${attempt}):`, errBody);

      if (isOverloaded && attempt < MAX_RETRIES) {
        console.log(`Overloaded — retrying in ${RETRY_DELAY_MS}ms...`);
        await sleep(RETRY_DELAY_MS);
        continue;
      }

      // Non-retryable error or out of retries
      return res.status(502).json({ error: "Upstream API error." });
    }
  } catch (err) {
    console.error("Server error:", err);
    return res.status(500).json({ error: "Internal server error." });
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`AI Coaching server running at http://localhost:${PORT}`);
});
