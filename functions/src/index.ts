import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import Anthropic from '@anthropic-ai/sdk';

const anthropicKey = defineSecret('ANTHROPIC_API_KEY');

const CATEGORIES = [
  'Groceries', 'Restaurants & Dining', 'Gas & Fuel', 'Transportation',
  'Shopping - Clothing', 'Shopping - Online', 'Shopping - General', 'Shopping - Home',
  'Entertainment', 'Subscriptions', 'Alcohol & Liquor', 'Health & Pharmacy',
  'Utilities', 'Travel', 'Pets', 'Auto & Maintenance', 'Convenience Store',
  'Fees & Charges', 'Payment', 'Other',
];

export const generateMappings = onCall(
  { secrets: [anthropicKey], cors: true, maxInstances: 2 },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be signed in');
    }

    const { descriptions, pdfText } = request.data as {
      descriptions: string[];
      pdfText?: string;
    };

    if (!Array.isArray(descriptions) || descriptions.length === 0) {
      throw new HttpsError('invalid-argument', 'descriptions must be a non-empty array');
    }

    const capped = descriptions.slice(0, 200);
    // Send first ~8000 chars of PDF text for format analysis (enough for structure, keeps costs low)
    const textSample = pdfText ? pdfText.slice(0, 8000) : '';

    const client = new Anthropic({ apiKey: anthropicKey.value() });

    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 4096,
      messages: [{
        role: 'user',
        content: `You are analyzing a credit card statement. Do TWO things:

1. ANALYZE THE STATEMENT FORMAT from this PDF text sample:
"""
${textSample}
"""

Determine:
- bankName: the bank or card issuer (e.g. "BMO", "TD", "RBC", "CIBC", "Scotiabank", "Amex")
- cardholders: array of cardholder DISPLAY names found (e.g. ["Max Blamauer", "Kathryn Peddar"]). Use proper title case.
- cardholderPatterns: array of the EXACT text patterns used in the PDF to identify each cardholder section (e.g. ["MR MAX BLAMAUER", "MRS KATHRYN PEDDAR"]). These must match the PDF text exactly.
- hasSections: true if the statement groups transactions under separate cardholder headings, false if all transactions are listed together
- useTwoDateFormat: true if each transaction line has TWO dates (transaction date + posting date), false if only one date
- creditIndicator: what marks a credit/refund — usually "CR", "-", or "negative". Use the exact text from the statement.

2. CATEGORIZE THESE MERCHANTS into spending categories:

Categories (use EXACTLY one):
${CATEGORIES.join('\n')}

Merchant descriptions:
${capped.map((d, i) => `${i + 1}. "${d}"`).join('\n')}

For each merchant:
- "merchantPattern": lowercase 2-3 word identifier. Remove store numbers (#123), province/state codes (ON, BC, AB, etc.), trailing digits, special characters like *.
- "category": exactly one from the list above.

Return ONLY this JSON structure. No markdown fences, no explanation:
{
  "profile": {
    "bankName": "...",
    "cardholders": ["..."],
    "cardholderPatterns": ["..."],
    "hasSections": true,
    "useTwoDateFormat": true,
    "creditIndicator": "CR"
  },
  "mappings": [{"merchantPattern":"...","category":"..."}]
}`,
      }],
    });

    const text = message.content[0].type === 'text' ? message.content[0].text : '';
    const cleaned = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();

    let result: {
      profile: {
        bankName: string;
        cardholders: string[];
        cardholderPatterns: string[];
        hasSections: boolean;
        useTwoDateFormat: boolean;
        creditIndicator: string;
      };
      mappings: Array<{ merchantPattern: string; category: string }>;
    };

    try {
      result = JSON.parse(cleaned);
    } catch {
      throw new HttpsError('internal', 'Failed to parse Claude response');
    }

    // Validate mappings
    const validCategories = new Set(CATEGORIES);
    result.mappings = result.mappings.filter(
      (m) => m.merchantPattern && typeof m.merchantPattern === 'string' &&
             m.category && validCategories.has(m.category)
    );

    // Ensure profile has required fields
    if (!result.profile) {
      result.profile = {
        bankName: 'Unknown',
        cardholders: [],
        cardholderPatterns: [],
        hasSections: false,
        useTwoDateFormat: true,
        creditIndicator: 'CR',
      };
    }

    return result;
  }
);
