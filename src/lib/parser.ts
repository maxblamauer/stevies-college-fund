import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import { categorizeTransaction } from './categorize';
import type { CategoryMapping } from './categorize';

// Use the bundled worker for pdfjs in the browser
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

async function extractText(data: Uint8Array): Promise<string> {
  const doc = await getDocument({ data }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    pages.push(content.items.map((item) => ('str' in item ? item.str : '')).join(' '));
  }
  return pages.join('\n');
}

export async function parseBMOStatement(
  data: Uint8Array,
  mappings: CategoryMapping[]
): Promise<ParsedStatement> {
  const text = await extractText(data);

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

      description = description.replace(/\s{2,}/g, ' ').trim();

      if (/^TRANS DATE/i.test(description)) continue;
      if (/^Page\s+\d/i.test(description)) continue;

      const { category, confirmed } = categorizeTransaction(description, mappings);

      transactions.push({
        transDate: parseDate(transDate, year),
        postingDate: parseDate(postDate, year),
        description,
        amount,
        isCredit,
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

  if (transactions.length === 0) {
    const txnArea = fullText.match(/Transactions since your last statement([\s\S]*?)(?:Trade-marks|Page\s+\d+\s+of)/);
    if (txnArea) {
      parseSection(txnArea[1], 'Max Blamauer');
    }
  }

  return {
    statementDate: parseDate(stmtDate, year),
    periodStart: periodStart ? parseDate(periodStart, year) : '',
    periodEnd: periodEnd ? parseDate(periodEnd, year) : '',
    totalBalance,
    transactions,
  };
}
