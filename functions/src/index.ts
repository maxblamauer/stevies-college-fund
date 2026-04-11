import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import Anthropic from '@anthropic-ai/sdk';

const anthropicKey = defineSecret('ANTHROPIC_API_KEY');

const CATEGORIES = [
  'Groceries', 'Restaurants & Dining', 'Gas & Fuel', 'Rides & Transit',
  'Shopping - Clothing', 'Shopping - Online', 'Shopping - General', 'Shopping - Home',
  'Entertainment', 'Subscriptions', 'Alcohol & Liquor', 'Health',
  'Utilities', 'Travel', 'Pets', 'Auto & Maintenance', 'Convenience Store',
  'Fees & Charges', 'Payment', 'Other',
];

export const generateMappings = onCall(
  { secrets: [anthropicKey], cors: true, maxInstances: 2 },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be signed in');
    }

    const { descriptions, pdfText, jointCardholders } = request.data as {
      descriptions: string[];
      pdfText?: string;
      jointCardholders?: string[];
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

1. ANALYZE THE STATEMENT FORMAT from this PDF text sample:${jointCardholders && jointCardholders.length > 0 ? `\n\nIMPORTANT: The user has confirmed this is a joint card with these cardholders (exact names from the statement): ${jointCardholders.join(', ')}. Use these as the cardholderPatterns and set hasSections to true.` : ''}
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

export const extractScreenshot = onCall(
  { secrets: [anthropicKey], cors: true, maxInstances: 2 },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be signed in');
    }

    const { imageBase64, mediaType, existingTransactions } = request.data as {
      imageBase64: string;
      mediaType: 'image/png' | 'image/jpeg' | 'image/webp';
      existingTransactions?: Array<{ date: string; description: string; amount: number }>;
    };

    if (!imageBase64 || !mediaType) {
      throw new HttpsError('invalid-argument', 'imageBase64 and mediaType are required');
    }

    let dedupeInstructions = '';
    if (existingTransactions && existingTransactions.length > 0) {
      dedupeInstructions = `\n\nIMPORTANT: The user already has these transactions recorded. Do NOT include any transaction that matches one below (same date, similar description, same amount). Mark any you skip in a "skipped" array with the reason.
Existing transactions:
${existingTransactions.map((t) => `- ${t.date} | ${t.description} | $${t.amount}`).join('\n')}`;
    }

    const client = new Anthropic({ apiKey: anthropicKey.value() });

    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 4096,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: mediaType,
              data: imageBase64,
            },
          },
          {
            type: 'text',
            text: `Extract all transactions from this bank/credit card statement screenshot.

For each transaction, extract:
- date: the transaction date in YYYY-MM-DD format. Use the year from the dates shown in the screenshot. If no year is visible, use the current year (${new Date().getFullYear()}).
- description: the merchant/description text exactly as shown
- amount: the dollar amount as a number (no $ sign)
- isPending: true if the transaction is listed under "PENDING" or similar, false if posted/completed
- isCredit: true if this is a credit/refund/payment, false for charges

Also determine:
- statementMonth: the billing month these transactions belong to, in YYYY-MM format (based on the dates shown)
- periodStart: the earliest transaction date in YYYY-MM-DD
- periodEnd: the latest transaction date in YYYY-MM-DD
${dedupeInstructions}

Return ONLY this JSON structure. No markdown fences, no explanation:
{
  "statementMonth": "YYYY-MM",
  "periodStart": "YYYY-MM-DD",
  "periodEnd": "YYYY-MM-DD",
  "transactions": [
    {
      "date": "YYYY-MM-DD",
      "description": "...",
      "amount": 0.00,
      "isPending": false,
      "isCredit": false
    }
  ],
  "skipped": [
    {
      "date": "YYYY-MM-DD",
      "description": "...",
      "amount": 0.00,
      "reason": "duplicate of existing transaction"
    }
  ]
}`,
          },
        ],
      }],
    });

    const text = message.content[0].type === 'text' ? message.content[0].text : '';
    const cleaned = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();

    let result: {
      statementMonth: string;
      periodStart: string;
      periodEnd: string;
      transactions: Array<{
        date: string;
        description: string;
        amount: number;
        isPending: boolean;
        isCredit: boolean;
      }>;
      skipped?: Array<{
        date: string;
        description: string;
        amount: number;
        reason: string;
      }>;
    };

    try {
      result = JSON.parse(cleaned);
    } catch {
      throw new HttpsError('internal', 'Failed to parse Claude response');
    }

    // Validate transactions have required fields
    result.transactions = (result.transactions || []).filter(
      (t) => t.date && t.description && typeof t.amount === 'number'
    );

    return result;
  }
);
