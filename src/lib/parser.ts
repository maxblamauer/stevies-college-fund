import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import { categorizeTransaction } from './categorize';
import type { CategoryMapping } from './categorize';
import { reconcileBillingPeriod } from './statementPeriod';
import type { CardProfile } from '../types';

GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.mjs',
  import.meta.url
).toString();

export interface ParsedTransaction {
  transDate: string;
  postingDate: string;
  description: string;
  amount: number;
  isCredit: boolean;
  cardholder: string;
  category: string;
  confirmed: boolean;
}

export interface ParsedStatement {
  statementDate: string;
  periodStart: string;
  periodEnd: string;
  totalBalance: number;
  transactions: ParsedTransaction[];
}

// ============================================================
// Shared utilities
// ============================================================

const MONTHS: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
  january: '01', february: '02', march: '03', april: '04',
  june: '06', july: '07', august: '08', september: '09',
  october: '10', november: '11', december: '12',
};

export async function extractText(data: Uint8Array): Promise<string> {
  const doc = await getDocument({ data }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    pages.push(content.items.map((item) => ('str' in item ? item.str : '')).join(' '));
  }
  return pages.join('\n');
}

/** Try to normalize any date string to YYYY-MM-DD */
function normalizeDate(dateStr: string, fallbackYear: number): string {
  // "Jan 15" or "Jan. 15"
  let m = dateStr.match(/([A-Za-z]+)\.?\s+(\d{1,2})/);
  if (m) {
    const month = MONTHS[m[1].toLowerCase()];
    if (month) return `${fallbackYear}-${month}-${m[2].padStart(2, '0')}`;
  }

  // "15 Jan" or "15 Jan 2026"
  m = dateStr.match(/(\d{1,2})\s+([A-Za-z]+)\.?,?\s*(\d{4})?/);
  if (m) {
    const month = MONTHS[m[2].toLowerCase()];
    if (month) {
      const yr = m[3] ? parseInt(m[3]) : fallbackYear;
      return `${yr}-${month}-${m[1].padStart(2, '0')}`;
    }
  }

  // "Jan 15, 2026"
  m = dateStr.match(/([A-Za-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})/);
  if (m) {
    const month = MONTHS[m[1].toLowerCase()];
    if (month) return `${parseInt(m[3])}-${month}-${m[2].padStart(2, '0')}`;
  }

  // "2026-01-15"
  m = dateStr.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;

  // "01/15/2026" or "01/15"
  m = dateStr.match(/(\d{2})\/(\d{2})(?:\/(\d{4}))?/);
  if (m) {
    const yr = m[3] ? parseInt(m[3]) : fallbackYear;
    return `${yr}-${m[1]}-${m[2]}`;
  }

  return dateStr;
}

/** Extract a 4-digit year from text, preferring context near "statement" or "period" */
function detectYear(text: string): number {
  const contextMatch = text.match(/(?:statement|period|closing|date)[^]*?(\d{4})/i);
  if (contextMatch) {
    const yr = parseInt(contextMatch[1]);
    if (yr >= 2020 && yr <= 2040) return yr;
  }
  const anyYear = text.match(/\b(20[2-4]\d)\b/);
  if (anyYear) return parseInt(anyYear[1]);
  return new Date().getFullYear();
}

// ============================================================
// Bank detection
// ============================================================

type Bank = 'bmo' | 'generic';

function detectBank(text: string): Bank {
  const lower = text.toLowerCase();
  if (lower.includes('bank of montreal') || lower.includes('bmo')) return 'bmo';
  return 'generic';
}

// ============================================================
// Main entry point
// ============================================================

export async function parseStatement(
  data: Uint8Array,
  mappings: CategoryMapping[],
  cardProfile?: CardProfile
): Promise<ParsedStatement> {
  const text = await extractText(data);

  // If we have a card profile, use profile-aware parsing
  if (cardProfile) {
    return parseWithProfile(text, mappings, cardProfile);
  }

  // Legacy path: auto-detect bank
  const bank = detectBank(text);
  if (bank === 'bmo') {
    return parseBMO(text, mappings);
  }
  return parseGeneric(text, mappings);
}

// ============================================================
// BMO-specific parser (preserved from original)
// ============================================================

function parseBMO(text: string, mappings: CategoryMapping[]): ParsedStatement {
  const stmtDateMatch = text.match(/Statement date\s+([A-Z][a-z]+\.?\s+\d+,\s+\d{4})/);
  const stmtDate = stmtDateMatch ? stmtDateMatch[1] : '';

  const periodMatch = text.match(/Statement period\s+([A-Z][a-z]+\.?\s+\d+,\s+\d{4})\s*-\s*([A-Z][a-z]+\.?\s+\d+,\s+\d{4})/);
  let periodStart = '';
  let periodEnd = '';
  let year = new Date().getFullYear();

  if (periodMatch) {
    periodStart = periodMatch[1];
    periodEnd = periodMatch[2];
    const yearMatch = periodEnd.match(/(\d{4})/);
    if (yearMatch) year = parseInt(yearMatch[1]);
  }

  const balanceMatch = text.match(/Total balance\s+\$([\d,]+\.\d{2})/);
  const totalBalance = balanceMatch ? parseFloat(balanceMatch[1].replace(/,/g, '')) : 0;

  const transactions: ParsedTransaction[] = [];
  const fullText = text.replace(/\n/g, ' ');

  const dateP = '([A-Z][a-z]+\\.?\\s+\\d{1,2})';
  const amtP = '([\\d,]+\\.\\d{2})\\s*(CR)?';

  const maxSection = fullText.match(/MR MAX BLAMAUER([\s\S]*?)(?:Subtotal for MR MAX BLAMAUER|Card number:\s*XXXX XXXX XXXX 1916)/);
  const kathSection = fullText.match(/MRS KATHRYN PEDDAR([\s\S]*?)Subtotal for MRS KATHRYN PEDDAR/);

  function parseSection(sectionText: string, cardholder: string) {
    const regex = new RegExp(
      dateP + '\\s+' + dateP + '\\s+' + '(.+?)\\s+' + amtP, 'g'
    );
    let match;
    while ((match = regex.exec(sectionText)) !== null) {
      const transDate = match[1];
      const postDate = match[2];
      let description = match[3].trim().replace(/\s{2,}/g, ' ');
      const amount = parseFloat(match[4].replace(/,/g, ''));
      const isCredit = match[5] === 'CR';

      if (/^TRANS DATE/i.test(description)) continue;
      if (/^Page\s+\d/i.test(description)) continue;

      const { category, confirmed } = categorizeTransaction(description, mappings);
      transactions.push({
        transDate: normalizeDate(transDate, year),
        postingDate: normalizeDate(postDate, year),
        description, amount, isCredit, cardholder, category, confirmed,
      });
    }
  }

  if (maxSection) parseSection(maxSection[1], 'Max Blamauer');
  if (kathSection) parseSection(kathSection[1], 'Kathryn Peddar');

  if (transactions.length === 0) {
    const txnArea = fullText.match(/Transactions since your last statement([\s\S]*?)(?:Trade-marks|Page\s+\d+\s+of)/);
    if (txnArea) parseSection(txnArea[1], 'Primary');
  }

  let periodStartIso = periodStart ? normalizeDate(periodStart, year) : '';
  let periodEndIso = periodEnd ? normalizeDate(periodEnd, year) : '';
  if (periodStartIso && periodEndIso) {
    ({ periodStart: periodStartIso, periodEnd: periodEndIso } = reconcileBillingPeriod(periodStartIso, periodEndIso));
  }

  return {
    statementDate: normalizeDate(stmtDate, year),
    periodStart: periodStartIso,
    periodEnd: periodEndIso,
    totalBalance,
    transactions,
  };
}

// ============================================================
// Generic parser — works with any bank's statement
// ============================================================

function parseGeneric(text: string, mappings: CategoryMapping[]): ParsedStatement {
  const year = detectYear(text);
  const fullText = text.replace(/\n/g, ' ');

  // Try to extract statement metadata
  const statementDate = extractStatementDate(fullText, year);
  const { periodStart, periodEnd } = extractPeriod(fullText, year);
  const totalBalance = extractBalance(fullText);

  // ---- Transaction extraction ----
  // Strategy: find all occurrences of "date description amount" patterns.
  // We try multiple date formats and amount patterns.

  const transactions: ParsedTransaction[] = [];
  const seen = new Set<string>(); // deduplicate

  // Date patterns to try (named groups for clarity)
  const datePatterns = [
    // "Jan 15" or "Jan. 15"
    '([A-Z][a-z]+\\.?\\s+\\d{1,2})',
    // "01/15" or "01-15"
    '(\\d{2}[/\\-]\\d{2})',
    // "2026-01-15"
    '(\\d{4}-\\d{2}-\\d{2})',
  ];

  // Amount pattern: optional $, digits with commas, decimal, optional CR/- suffix
  const amtPattern = '\\$?([\\d,]+\\.\\d{2})\\s*(CR|cr|-)?';

  for (const dp of datePatterns) {
    // Try: date date description amount (two-date format like BMO)
    const twoDateRegex = new RegExp(
      dp + '\\s+' + dp + '\\s+' + '(.+?)\\s+' + amtPattern, 'g'
    );
    let match;
    while ((match = twoDateRegex.exec(fullText)) !== null) {
      const txn = buildTransaction(match[1], match[2], match[3], match[4], match[5], year, mappings);
      if (txn && !seen.has(txn.key)) {
        seen.add(txn.key);
        transactions.push(txn.parsed);
      }
    }

    // Try: date description amount (single-date format)
    const oneDateRegex = new RegExp(
      dp + '\\s+' + '(.+?)\\s+' + amtPattern, 'g'
    );
    while ((match = oneDateRegex.exec(fullText)) !== null) {
      const txn = buildTransaction(match[1], match[1], match[2], match[3], match[4], year, mappings);
      if (txn && !seen.has(txn.key)) {
        seen.add(txn.key);
        transactions.push(txn.parsed);
      }
    }
  }

  // Sort by date
  transactions.sort((a, b) => b.transDate.localeCompare(a.transDate));

  let periodStartOut = periodStart;
  let periodEndOut = periodEnd;
  if (periodStartOut && periodEndOut) {
    ({ periodStart: periodStartOut, periodEnd: periodEndOut } = reconcileBillingPeriod(periodStartOut, periodEndOut));
  }

  return {
    statementDate,
    periodStart: periodStartOut,
    periodEnd: periodEndOut,
    totalBalance,
    transactions,
  };
}

function buildTransaction(
  dateStr1: string,
  dateStr2: string,
  description: string,
  amountStr: string,
  creditFlag: string | undefined,
  year: number,
  mappings: CategoryMapping[]
): { parsed: ParsedTransaction; key: string } | null {
  const amount = parseFloat(amountStr.replace(/,/g, ''));
  if (isNaN(amount) || amount <= 0) return null;

  let desc = description.replace(/\s{2,}/g, ' ').trim();

  // Filter out header/footer noise
  if (desc.length < 3) return null;
  if (/^(TRANS|DATE|POST|DESCRIPTION|AMOUNT|BALANCE|PAGE|TOTAL|SUBTOTAL|OPENING|CLOSING|PREVIOUS|NEW|MINIMUM|PAYMENT|CREDIT LIMIT)/i.test(desc)) return null;
  if (/^\d+\s+of\s+\d+$/i.test(desc)) return null;

  const isCredit = creditFlag === 'CR' || creditFlag === 'cr' || creditFlag === '-';

  const transDate = normalizeDate(dateStr1, year);
  const postingDate = normalizeDate(dateStr2, year);

  // Validate dates look reasonable
  if (!/^\d{4}-\d{2}-\d{2}$/.test(transDate)) return null;

  const { category, confirmed } = categorizeTransaction(desc, mappings);

  const key = `${transDate}|${desc}|${amount}`;

  return {
    key,
    parsed: {
      transDate,
      postingDate,
      description: desc,
      amount,
      isCredit,
      cardholder: 'Primary',
      category,
      confirmed,
    },
  };
}

// ---- Metadata extraction helpers ----

function extractStatementDate(text: string, year: number): string {
  // Try various "statement date" patterns
  const patterns = [
    /statement\s+date[:\s]+([A-Z][a-z]+\.?\s+\d{1,2},?\s+\d{4})/i,
    /statement\s+date[:\s]+(\d{2}[/\-]\d{2}[/\-]\d{4})/i,
    /closing\s+date[:\s]+([A-Z][a-z]+\.?\s+\d{1,2},?\s+\d{4})/i,
    /closing\s+date[:\s]+(\d{2}[/\-]\d{2}[/\-]\d{4})/i,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) return normalizeDate(m[1], year);
  }
  return '';
}

function extractPeriod(text: string, year: number): { periodStart: string; periodEnd: string } {
  const patterns = [
    /(?:statement\s+period|billing\s+period|period)[:\s]+([A-Z][a-z]+\.?\s+\d{1,2},?\s+\d{4})\s*[-–to]+\s*([A-Z][a-z]+\.?\s+\d{1,2},?\s+\d{4})/i,
    /(?:statement\s+period|billing\s+period|period)[:\s]+(\d{2}[/\-]\d{2}[/\-]\d{4})\s*[-–to]+\s*(\d{2}[/\-]\d{2}[/\-]\d{4})/i,
    /from\s+([A-Z][a-z]+\.?\s+\d{1,2},?\s+\d{4})\s+to\s+([A-Z][a-z]+\.?\s+\d{1,2},?\s+\d{4})/i,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) return { periodStart: normalizeDate(m[1], year), periodEnd: normalizeDate(m[2], year) };
  }
  return { periodStart: '', periodEnd: '' };
}

function extractBalance(text: string): number {
  const patterns = [
    /(?:total|new)\s+balance[:\s]+\$?([\d,]+\.\d{2})/i,
    /(?:amount\s+due|balance\s+due)[:\s]+\$?([\d,]+\.\d{2})/i,
    /(?:closing\s+balance)[:\s]+\$?([\d,]+\.\d{2})/i,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) return parseFloat(m[1].replace(/,/g, ''));
  }
  return 0;
}

// ============================================================
// Profile-aware parser — uses AI-generated card profile
// ============================================================

function parseWithProfile(
  text: string,
  mappings: CategoryMapping[],
  profile: CardProfile
): ParsedStatement {
  const year = detectYear(text);
  const fullText = text.replace(/\n/g, ' ');

  const statementDate = extractStatementDate(fullText, year);
  const { periodStart, periodEnd } = extractPeriod(fullText, year);
  const totalBalance = extractBalance(fullText);

  // Build cardholder sections if the statement has them
  const sections: Array<{ cardholder: string; text: string }> = [];

  if (profile.hasSections && profile.cardholderPatterns.length > 0) {
    // Find each cardholder's section in the text
    for (let i = 0; i < profile.cardholderPatterns.length; i++) {
      const pattern = profile.cardholderPatterns[i];
      const displayName = profile.cardholders[i] || pattern;
      const patternEscaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

      // Look for text between this cardholder's name and the next (or subtotal)
      const subtotalPattern = `(?:Subtotal for ${patternEscaped}|Card number:|${
        profile.cardholderPatterns
          .filter((_, j) => j !== i)
          .map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
          .join('|') || '$'
      })`;

      const sectionRegex = new RegExp(
        `${patternEscaped}([\\s\\S]*?)(?:${subtotalPattern}|$)`,
        'i'
      );
      const sectionMatch = fullText.match(sectionRegex);
      if (sectionMatch) {
        sections.push({ cardholder: displayName, text: sectionMatch[1] });
      }
    }
  }

  // If no sections found, treat entire text as one section
  if (sections.length === 0) {
    const defaultCardholder = profile.cardholders[0] || 'Primary';
    sections.push({ cardholder: defaultCardholder, text: fullText });
  }

  // Parse transactions from each section
  const transactions: ParsedTransaction[] = [];
  const seen = new Set<string>();

  const datePatterns = [
    '([A-Z][a-z]+\\.?\\s+\\d{1,2})',
    '(\\d{2}[/\\-]\\d{2})',
    '(\\d{4}-\\d{2}-\\d{2})',
  ];
  const amtPattern = '\\$?([\\d,]+\\.\\d{2})\\s*(CR|cr|-)?';

  for (const section of sections) {
    for (const dp of datePatterns) {
      if (profile.useTwoDateFormat) {
        const twoDateRegex = new RegExp(
          dp + '\\s+' + dp + '\\s+' + '(.+?)\\s+' + amtPattern, 'g'
        );
        let match;
        while ((match = twoDateRegex.exec(section.text)) !== null) {
          const txn = buildTransaction(match[1], match[2], match[3], match[4], match[5], year, mappings);
          if (txn && !seen.has(txn.key)) {
            seen.add(txn.key);
            transactions.push({ ...txn.parsed, cardholder: section.cardholder });
          }
        }
      }

      // Always try single-date as fallback
      const oneDateRegex = new RegExp(
        dp + '\\s+' + '(.+?)\\s+' + amtPattern, 'g'
      );
      let match;
      while ((match = oneDateRegex.exec(section.text)) !== null) {
        const txn = buildTransaction(match[1], match[1], match[2], match[3], match[4], year, mappings);
        if (txn && !seen.has(txn.key)) {
          seen.add(txn.key);
          transactions.push({ ...txn.parsed, cardholder: section.cardholder });
        }
      }
    }
  }

  transactions.sort((a, b) => b.transDate.localeCompare(a.transDate));

  let periodStartOut = periodStart;
  let periodEndOut = periodEnd;
  if (periodStartOut && periodEndOut) {
    ({ periodStart: periodStartOut, periodEnd: periodEndOut } = reconcileBillingPeriod(periodStartOut, periodEndOut));
  }

  return {
    statementDate,
    periodStart: periodStartOut,
    periodEnd: periodEndOut,
    totalBalance,
    transactions,
  };
}
