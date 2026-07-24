import Anthropic from '@anthropic-ai/sdk';
import { logger } from '../config/logger';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = process.env.CLAUDE_MODEL || 'claude-haiku-20240307';

export interface AIGradingResult {
  score: number;         // 0.0 – 1.0
  reasoning: string;
  suggestions?: string;
}

/**
 * Call Claude API to evaluate code logic quality asynchronously.
 * Returns a 0-1 score for approach efficiency and edge-case handling.
 * Called AFTER Piston test results are returned to the student — never blocks them.
 */
export async function gradeWithAI(
  code: string,
  language: string,
  problemTitle: string,
  problemStatement: string,
  testPassRatio: number
): Promise<AIGradingResult> {
  try {
    const prompt = `You are an expert programming judge evaluating student code for a competitive programming contest.

Problem: ${problemTitle}
Statement: ${problemStatement}

Student's Code (${language}):
\`\`\`${language.toLowerCase()}
${code}
\`\`\`

Test Case Pass Ratio: ${(testPassRatio * 100).toFixed(0)}%

Evaluate this code on TWO criteria:
1. **Approach Efficiency** (0-1): Is the algorithm efficient? Does it avoid brute-force when a better approach exists? (O(n) vs O(n²), etc.)
2. **Edge Case Handling** (0-1): Does the code handle edge cases, boundary conditions, empty inputs, and overflow?

Respond with ONLY valid JSON in this exact format:
{
  "score": <number 0.0 to 1.0>,
  "reasoning": "<brief 1-2 sentence explanation>",
  "suggestions": "<one specific improvement suggestion, max 30 words>"
}

Be strict but fair. A brute-force solution that passes all tests should score around 0.5. An optimal solution with good edge case handling should score 0.85-1.0.`;

    const message = await client.messages.create({
      model: MODEL,
      max_tokens: 256,
      messages: [{ role: 'user', content: prompt }],
    });

    const content = message.content[0];
    if (content.type !== 'text') {
      throw new Error('Unexpected Claude response type');
    }

    // Extract JSON from response (handle markdown code blocks)
    const jsonMatch = content.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('Claude returned no JSON');
    }

    const parsed = JSON.parse(jsonMatch[0]);
    const score = Math.max(0, Math.min(1, parseFloat(parsed.score) || 0));

    logger.info('AI grading complete', { score, model: MODEL });

    return {
      score,
      reasoning: parsed.reasoning || 'No reasoning provided.',
      suggestions: parsed.suggestions,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    logger.error('AI grading failed', { error: message });
    // Graceful degradation: return neutral score on failure
    return {
      score: 0.5,
      reasoning: 'AI evaluation unavailable.',
    };
  }
}
