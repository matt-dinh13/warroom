// MiniMax API client — supports multi-turn conversation

const MINIMAX_BASE_URL = 'https://api.minimaxi.chat/v1';
const MODEL = 'MiniMax-M2.7';

/**
 * Call MiniMax chat completion API
 * Supports two modes:
 * - Legacy: callMiniMax(systemPrompt, userMessage, apiKey)
 * - Multi-turn: callMiniMax(null, null, apiKey, messagesArray)
 *
 * @param {string|null} systemPrompt - System prompt (null if using messages array)
 * @param {string|null} userMessage - User message (null if using messages array)
 * @param {string} apiKey - MiniMax API key
 * @param {Array|null} messages - Full messages array for multi-turn
 * @returns {Promise<object>} Parsed JSON response from AI
 */
export async function callMiniMax(systemPrompt, userMessage, apiKey, messages = null) {
  const msgPayload = messages || [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userMessage },
  ];

  // Fetch with 15s timeout + 1 retry
  let response;
  const fetchOpts = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages: msgPayload,
      temperature: 0.3,
      response_format: { type: 'json_object' },
    }),
  };

  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      response = await fetch(`${MINIMAX_BASE_URL}/chat/completions`, {
        ...fetchOpts,
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (response.ok) break;
      if (response.status >= 500 && attempt === 0) {
        console.warn(`MiniMax 5xx, retrying... (${response.status})`);
        await new Promise(r => setTimeout(r, 1000));
        continue;
      }
      const errorText = await response.text();
      throw new Error(`MiniMax API error ${response.status}: ${errorText}`);
    } catch (err) {
      clearTimeout(timeout);
      if (err.name === 'AbortError' && attempt === 0) {
        console.warn('MiniMax timeout, retrying...');
        continue;
      }
      throw err;
    }
  }

  const data = await response.json();
  let content = data.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error('MiniMax returned empty response');
  }

  // MiniMax M2.7 wraps reasoning in <think>...</think> tags — strip them
  content = content.replace(/<think>[\s\S]*?<\/think>/g, '').trim();

  // Debug: log raw content for diagnosing CAPTURE failures
  console.log('MiniMax raw (first 300):', content.substring(0, 300));

  // ─── Robust JSON extraction ─────────────────────────────
  // AI sometimes returns text + ```json {...} ``` or text + bare JSON
  // Strategy 1: Try direct parse (pure JSON response)
  let parsed = tryParseJSON(content);
  if (parsed) return parsed;

  // Strategy 2: Extract from markdown code fence (```json ... ```)
  const fenceMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    parsed = tryParseJSON(fenceMatch[1].trim());
    if (parsed) return parsed;
  }

  // Strategy 3: Find first { ... } block that looks like our schema
  const braceMatch = content.match(/\{[\s\S]*"intent"[\s\S]*\}/);
  if (braceMatch) {
    parsed = tryParseJSON(braceMatch[0]);
    if (parsed) return parsed;
  }

  // Strategy 4: Nothing worked — return as CLARIFY with the raw text
  console.error('MiniMax JSON parse failed. Raw content:', content.substring(0, 500));
  return {
    intent: 'CLARIFY',
    response_text: content || 'Xin lỗi, mình không hiểu. Thử gõ lại?',
    notion_action: null,
    needs_confirmation: false,
    follow_up_question: null,
  };
}

function tryParseJSON(str) {
  try {
    const obj = JSON.parse(str);
    // Validate it has our expected schema
    if (obj && typeof obj === 'object' && obj.intent) return obj;
    return null;
  } catch {
    return null;
  }
}
