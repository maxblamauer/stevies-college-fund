import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { categorizeTransaction } from './categorize.js';

interface ParsedTransaction {
  trans_date: string;
  posting_date: string;
  description: string;
  amount: number;
  is_credit: boolean;
  cardholder: string;
  category: string;
  confirmed: boolean;
}

interface ParsedStatement {
  statement_date: string;
  period_start: string;
  period_end: string;
  total_balance: number;
  transactions: ParsedTransaction[];
}

const MONTHS: Record<string, string> = {
  Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
  Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12',
};

function parseDate(dateStr: string, year: number): string {
  const match = dateStr.match(/([A-Z][a-z]+)\.?\s+(\d+)/);
  if (!match) return dateStr;
  const month = MONTHS[match[1]] || '01';
  const day = match[2].padStart(2, '0');
  return `${year}-${month}-${day}`;
}

async function extractText(buffer: Buffer): Promise<string> {
  const data = new Uint8Array(buffer);
  const doc = await getDocument({ data }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    // @ts-expect-error items have str property
    pages.push(content.items.map((item) => item.str).join(' '));
  }
  return pages.join('\n');
}

export async function parseBMOStatement(buffer: Buffer): Promise<ParsedStatement> {
  const text = await extractText(buffer);

  // Extract statement metadata
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

  // Parse transactions using regex on the full text
  // Each transaction looks like:
  //   Feb. 5   Feb. 6   COSTCO WHOLESALE W253   BURLINGTON ON   509.05
  //   Feb. 17 Feb. 17   TRSF FROM/DE ACCT/CPT   2316-XXXX-641   4,211.00   CR
  // The key pattern is: date date description amount [CR]

  const transactions: ParsedTransaction[] = [];

  // Find cardholder sections
  // Card 9830 = Max, Card 1916 = Kathryn
  // We'll extract transaction blocks between cardholder markers and subtotals

  const fullText = text.replace(/\n/g, ' ');

  // Match individual transactions with a regex
  // Date pattern: "Mon. DD" where Mon is 3-letter month
  const dateP = '([A-Z][a-z]+\\.?\\s+\\d{1,2})';
  // Amount pattern: digits with optional comma and 2 decimal places, optional CR
  const amtP = '([\\d,]+\\.\\d{2})\\s*(CR)?';

  // Build a regex that matches: transDate postDate description amount [CR]
  // Description is everything between the second date and the amount
  const txnRegex = new RegExp(
    dateP + '\\s+' + dateP + '\\s+' +
    '(.+?)\\s+' + amtP,
    'g'
  );

  // Determine cardholder for each transaction based on position in text
  // Find the positions of cardholder markers
  const maxSection = fullText.match(/MR MAX BLAMAUER([\s\S]*?)(?:Subtotal for MR MAX BLAMAUER|Card number:\s*XXXX XXXX XXXX 1916)/);
  const kathSection = fullText.match(/MRS KATHRYN PEDDAR([\s\S]*?)Subtotal for MRS KATHRYN PEDDAR/);

  function parseSection(sectionText: string, cardholder: string) {
    const regex = new RegExp(
      dateP + '\\s+' + dateP + '\\s+' +
      '(.+?)\\s+' + amtP,
      'g'
    );

    let match;
    while ((match = regex.exec(sectionText)) !== null) {
      const transDate = match[1];
      const postDate = match[2];
      let description = match[3].trim();
      const amount = parseFloat(match[4].replace(/,/g, ''));
      const isCredit = match[5] === 'CR';

      // Clean up description - remove trailing location codes that got stuck
      description = description
        .replace(/\s{2,}/g, ' ')
        .trim();

      // Skip if description looks like header/footer text
      if (/^TRANS DATE/i.test(description)) continue;
      if (/^Page\s+\d/i.test(description)) continue;

      const { category, confirmed } = categorizeTransaction(description);

      transactions.push({
        trans_date: parseDate(transDate, year),
        posting_date: parseDate(postDate, year),
        description,
        amount,
        is_credit: isCredit,
        cardholder,
        category,
        confirmed,
      });
    }
  }

  if (maxSection) {
    parseSection(maxSection[1], 'Max Blamauer');
  }
  if (kathSection) {
    parseSection(kathSection[1], 'Kathryn Peddar');
  }

  // If section-based parsing didn't work, try the whole transaction area
  if (transactions.length === 0) {
    const txnArea = fullText.match(/Transactions since your last statement([\s\S]*?)(?:Trade-marks|Page\s+\d+\s+of)/);
    if (txnArea) {
      parseSection(txnArea[1], 'Max Blamauer');
    }
  }

  return {
    statement_date: parseDate(stmtDate, year),
    period_start: periodStart ? parseDate(periodStart, year) : '',
    period_end: periodEnd ? parseDate(periodEnd, year) : '',
    total_balance: totalBalance,
    transactions,
  };
}
