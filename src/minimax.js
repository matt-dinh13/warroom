// MiniMax API client — direct MiniMax API

const MINIMAX_BASE_URL = 'https://api.minimaxi.chat/v1';
const MODEL = 'MiniMax-M2.7';

/**
 * Call MiniMax chat completion API
 * @param {string} systemPrompt - System prompt
 * @param {string} userMessage - User message
 * @param {string} apiKey - MiniMax API key
 * @returns {Promise<object>} Parsed JSON response from AI
 */
export async function callMiniMax(systemPrompt, userMessage, apiKey) {
  const response = await fetch(`${MINIMAX_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      temperature: 0.3,
      response_format: { type: 'json_object' },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`MiniMax API error ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  let content = data.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error('MiniMax returned empty response');
  }

  // MiniMax M2.7 wraps reasoning in <think>...</think> tags — strip them
  content = content.replace(/<think>[\s\S]*?<\/think>/g, '').trim();

  // Also strip markdown code fences if present
  content = content.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim();

  try {
    return JSON.parse(content);
  } catch {
    // If AI didn't return valid JSON, wrap it
    return {
      intent: 'CLARIFY',
      response_text: content || 'Xin lỗi, mình không hiểu. Thử gõ lại?',
      notion_action: null,
      needs_confirmation: false,
      follow_up_question: null,
    };
  }
}
