interface KeywordRule {
  kw: string;
  w: number;
}

export interface CategoryMapping {
  merchantPattern: string;
  category: string;
}

const KEYWORDS: Record<string, KeywordRule[]> = {
  'Groceries': [
    { kw: 'costco wholesale', w: 10 },
    { kw: 'no frills', w: 10 },
    { kw: 'fortino', w: 10 },
    { kw: 'denninger', w: 10 },
    { kw: 'loblaws', w: 10 },
    { kw: 'food basics', w: 10 },
    { kw: 'farm boy', w: 10 },
    { kw: 'sobeys', w: 10 },
    { kw: 'freshco', w: 10 },
    { kw: "longo's", w: 10 },
    { kw: 'longos', w: 10 },
    { kw: 't&t supermarket', w: 10 },
    { kw: 'metro ', w: 6 },
    { kw: 'goodness me', w: 10 },
    { kw: 'whole foods', w: 10 },
    { kw: 'zehrs', w: 10 },
    { kw: 'independent grocer', w: 10 },
    { kw: 'voila', w: 8 },
    { kw: 'grocer', w: 5 },
    { kw: 'supermarket', w: 5 },
    { kw: 'natural food', w: 6 },
  ],
  'Restaurants & Dining': [
    { kw: 'fionn maccool', w: 10 },
    { kw: 'the poacher', w: 10 },
    { kw: 'bardo restaurant', w: 10 },
    { kw: 'art of pho', w: 10 },
    { kw: 'lugano pizza', w: 10 },
    { kw: 'jimmy the greek', w: 10 },
    { kw: 'prince of india', w: 10 },
    { kw: 'hakka rise', w: 10 },
    { kw: 'momo hous', w: 8 },
    { kw: 'barburrito', w: 10 },
    { kw: 'shawarma', w: 10 },
    { kw: 'culaccino', w: 10 },
    { kw: 'la la noodle', w: 10 },
    { kw: 'sconewitch', w: 10 },
    { kw: 'pai northern thai', w: 10 },
    { kw: 'cafe landwer', w: 10 },
    { kw: 'radius on brant', w: 10 },
    { kw: "pj o'brien", w: 10 },
    { kw: 'the argyle', w: 10 },
    { kw: "bernie's tavern", w: 10 },
    { kw: 'malarkey', w: 8 },
    { kw: 'russell williams', w: 10 },
    { kw: 'wandering scott', w: 10 },
    { kw: 'joe dogs', w: 10 },
    { kw: 'zaks diner', w: 10 },
    { kw: 'level one', w: 6 },
    { kw: 'layla', w: 5 },
    { kw: 'zesty', w: 5 },
    { kw: 'uber canada/ubereats', w: 12 },
    { kw: 'ubereats', w: 10 },
    { kw: 'skip the dishes', w: 10 },
    { kw: 'doordash', w: 10 },
    { kw: 'restaurant', w: 8 },
    { kw: 'tavern', w: 7 },
    { kw: 'grill', w: 5 },
    { kw: 'bistro', w: 7 },
    { kw: 'trattoria', w: 7 },
    { kw: 'kitchen', w: 4 },
    { kw: 'kitch', w: 4 },
    { kw: 'diner', w: 6 },
    { kw: 'noodle', w: 5 },
    { kw: 'sushi', w: 6 },
    { kw: 'ramen', w: 6 },
    { kw: 'thai', w: 4 },
    { kw: 'indian', w: 4 },
    { kw: 'steakhouse', w: 7 },
    { kw: 'pub ', w: 5 },
    { kw: 'bar ', w: 3 },
    { kw: 'bar +', w: 4 },
    { kw: 'wok', w: 4 },
    { kw: 'pho ', w: 5 },
    { kw: 'tst-', w: 6 },
    // Fast food & coffee chains
    { kw: 'mcdonald', w: 10 },
    { kw: 'tim horton', w: 10 },
    { kw: 'subway ', w: 8 },
    { kw: 'wendy', w: 10 },
    { kw: 'starbucks', w: 10 },
    { kw: 'a&w ', w: 8 },
    { kw: 'burger king', w: 10 },
    { kw: 'popeyes', w: 10 },
    { kw: 'pizza pizza', w: 10 },
    { kw: 'firehouse subs', w: 10 },
    { kw: 'dominos', w: 10 },
    { kw: "domino's", w: 10 },
    { kw: 'chipotle', w: 10 },
    { kw: 'burrito boyz', w: 10 },
    { kw: 'smokes poutinerie', w: 10 },
    { kw: 'poutinerie', w: 8 },
    { kw: 'bourbon st. gri', w: 8 },
    { kw: 'sunshine donut', w: 10 },
    { kw: 'hot bagel', w: 8 },
    { kw: 'jc hot bagel', w: 10 },
    { kw: 'jcs hot bagel', w: 10 },
    { kw: 'coffeedshop', w: 8 },
    { kw: 'firebat coffee', w: 10 },
    { kw: 'coffee culture', w: 10 },
    { kw: 'tribeca coffee', w: 10 },
    { kw: 'ecs coffee', w: 10 },
    { kw: "craig's cookies", w: 10 },
    { kw: 'fibs cafe', w: 10 },
    { kw: 'donut', w: 6 },
  ],
  'Gas & Fuel': [
    { kw: 'shell ', w: 8 },
    { kw: 'esso', w: 8 },
    { kw: 'petro-canada', w: 10 },
    { kw: 'petro canada', w: 10 },
    { kw: 'pioneer #', w: 8 },
    { kw: 'pioneer ', w: 5 },
    { kw: 'husky', w: 6 },
    { kw: 'ultramar', w: 8 },
    { kw: 'mobil', w: 5 },
    { kw: 'onroute', w: 7 },
    { kw: 'gasbar', w: 8 },
    { kw: 'gas bar', w: 8 },
    { kw: 'fuel', w: 4 },
    { kw: 'ev charging', w: 8 },
    { kw: 'chargepoint', w: 8 },
  ],
  'Transportation': [
    { kw: 'uber canada/ubertrip', w: 12 },
    { kw: 'ubertrip', w: 10 },
    { kw: 'lyft', w: 10 },
    { kw: '1832_yyz_relay', w: 10 },
    { kw: 'welcomepickups', w: 10 },
    { kw: 'presto', w: 8 },
    { kw: 'capital taxi', w: 10 },
    { kw: 'taxi', w: 6 },
    { kw: 'cab ', w: 4 },
    { kw: 'transit', w: 5 },
    { kw: 'go transit', w: 10 },
    { kw: 'up express', w: 10 },
    { kw: 'parking', w: 5 },
  ],
  'Shopping - Clothing': [
    { kw: 'old navy', w: 10 },
    { kw: 'hm ca', w: 8 },
    { kw: 'h&m', w: 8 },
    { kw: 'bikini village', w: 10 },
    { kw: 'winners', w: 10 },
    { kw: 'marshalls', w: 10 },
    { kw: 'rwco', w: 8 },
    { kw: 'gap ', w: 5 },
    { kw: 'zara', w: 8 },
    { kw: 'uniqlo', w: 8 },
    { kw: 'joe fresh', w: 8 },
    { kw: 'lululemon', w: 10 },
    { kw: 'roots', w: 6 },
  ],
  'Shopping - Online': [
    { kw: 'amazon', w: 10 },
    { kw: 'amzn', w: 10 },
    { kw: 'wf* ca', w: 8 },
    { kw: 'wayfair', w: 10 },
    { kw: 'ebay', w: 8 },
    { kw: 'etsy', w: 8 },
    { kw: 'www.', w: 3 },
  ],
  'Shopping - General': [
    { kw: 'wal-mart', w: 10 },
    { kw: 'walmart', w: 10 },
    { kw: 'canadian tire', w: 10 },
    { kw: 'canadiantire', w: 10 },
    { kw: 'dollarama', w: 10 },
    { kw: 'dollar tree', w: 10 },
    { kw: 'eterea sugar', w: 10 },
    { kw: 'handmade', w: 4 },
    { kw: 'centro garden', w: 8 },
  ],
  'Shopping - Home': [
    { kw: 'ikea', w: 10 },
    { kw: 'homesense', w: 10 },
    { kw: 'home sense', w: 10 },
    { kw: 'structube', w: 10 },
    { kw: 'jysk', w: 10 },
    { kw: 'rona', w: 8 },
    { kw: 'home depot', w: 10 },
    { kw: 'home hardware', w: 10 },
    { kw: 'lowes', w: 8 },
    { kw: 'bed bath', w: 8 },
    { kw: 'crate & barrel', w: 10 },
    { kw: 'cb2', w: 6 },
    { kw: 'furniture', w: 5 },
    { kw: 'wayfair', w: 8 },
  ],
  'Subscriptions': [
    { kw: 'netflix', w: 10 },
    { kw: 'apple.com/bill', w: 10 },
    { kw: 'spotify', w: 10 },
    { kw: 'disney+', w: 10 },
    { kw: 'crave', w: 8 },
    { kw: 'youtube', w: 8 },
    { kw: 'prime video', w: 8 },
    { kw: 'hulu', w: 8 },
    { kw: 'paramount', w: 6 },
    { kw: 'adobe', w: 8 },
    { kw: 'dropbox', w: 8 },
    { kw: 'icloud', w: 8 },
    { kw: 'google storage', w: 8 },
  ],
  'Alcohol & Liquor': [
    { kw: 'lcbo', w: 10 },
    { kw: 'beer store', w: 10 },
    { kw: 'wine rack', w: 10 },
    { kw: 'spirit', w: 4 },
    { kw: 'spiritleaf', w: 8 },
    { kw: 'nickel brook brew', w: 10 },
    { kw: 'fairweather brew', w: 10 },
    { kw: 'brewery', w: 7 },
    { kw: 'brewi', w: 5 },
    { kw: 'brew ', w: 4 },
    { kw: 'wine ', w: 3 },
    { kw: 'liquor', w: 8 },
    { kw: 'distill', w: 6 },
  ],
  'Health & Pharmacy': [
    { kw: 'shoppers drug', w: 10 },
    { kw: 'rexall', w: 10 },
    { kw: 'pharmasave', w: 10 },
    { kw: 'pharmacy', w: 8 },
    { kw: 'dental', w: 8 },
    { kw: 'alton dental', w: 10 },
    { kw: 'hospital', w: 7 },
    { kw: 'joseph brant', w: 8 },
    { kw: 'clinic', w: 5 },
    { kw: 'doctor', w: 5 },
    { kw: 'optom', w: 6 },
    { kw: 'physio', w: 6 },
    { kw: 'chiro', w: 6 },
  ],
  'Utilities': [
    { kw: 'wyse meter', w: 10 },
    { kw: 'enbridge', w: 10 },
    { kw: 'hydro', w: 8 },
    { kw: 'cogeco', w: 10 },
    { kw: 'bell canada', w: 10 },
    { kw: 'rogers', w: 7 },
    { kw: 'telus', w: 8 },
    { kw: 'fido', w: 6 },
    { kw: 'koodo', w: 8 },
    { kw: 'freedom mobile', w: 10 },
    { kw: 'connexion', w: 6 },
    { kw: 'internet', w: 4 },
    { kw: 'electric', w: 3 },
    { kw: 'utility', w: 5 },
  ],
  'Travel': [
    { kw: 'westjet', w: 10 },
    { kw: 'air canada', w: 10 },
    { kw: 'airbnb', w: 10 },
    { kw: 'hotel', w: 8 },
    { kw: 'virgin at', w: 8 },
    { kw: 'virgin atlantic', w: 10 },
    { kw: 'expedia', w: 10 },
    { kw: 'booking.com', w: 10 },
    { kw: 'holbox', w: 8 },
    { kw: 'asur c conv', w: 8 },
    { kw: 'airline', w: 6 },
    { kw: 'flight', w: 5 },
    { kw: 'resort', w: 6 },
    { kw: 'hostel', w: 6 },
  ],
  'Entertainment': [
    { kw: 'massey hall', w: 10 },
    { kw: 'meridian hall', w: 10 },
    { kw: 'splitsville', w: 10 },
    { kw: 'sens community', w: 8 },
    { kw: 'nbx*sens', w: 8 },
    { kw: 'cinema', w: 8 },
    { kw: 'cineplex', w: 10 },
    { kw: 'theatre', w: 6 },
    { kw: 'theater', w: 6 },
    { kw: 'concert', w: 6 },
    { kw: 'ticket', w: 4 },
    { kw: 'bowling', w: 6 },
    { kw: 'golf', w: 5 },
    { kw: 'rec centre', w: 6 },
    { kw: 'museum', w: 6 },
    { kw: 'gallery', w: 4 },
  ],
  'Pets': [
    { kw: 'pet valu', w: 10 },
    { kw: 'pet smart', w: 10 },
    { kw: 'petsmart', w: 10 },
    { kw: "ren's pets", w: 10 },
    { kw: 'global pet', w: 10 },
    { kw: 'veterinar', w: 8 },
    { kw: 'vet clinic', w: 8 },
  ],
  'Auto & Maintenance': [
    { kw: 'mechanical edge', w: 10 },
    { kw: 'auto ', w: 4 },
    { kw: 'automotive', w: 7 },
    { kw: 'midas', w: 8 },
    { kw: 'mr lube', w: 10 },
    { kw: 'oil change', w: 8 },
    { kw: 'tire ', w: 4 },
    { kw: 'muffler', w: 7 },
    { kw: 'mechanic', w: 7 },
    { kw: 'car wash', w: 6 },
    { kw: 'collision', w: 6 },
  ],
  'Fees & Charges': [
    { kw: 'paymentus', w: 10 },
    { kw: 'service fee', w: 8 },
    { kw: 'annual fee', w: 10 },
    { kw: 'interest charge', w: 10 },
    { kw: 'late fee', w: 10 },
    { kw: 'nsf', w: 8 },
  ],
  'Convenience Store': [
    { kw: 'oxxo', w: 8 },
    { kw: 'circle k', w: 10 },
    { kw: '7-eleven', w: 10 },
    { kw: 'couche-tard', w: 10 },
    { kw: 'hasty market', w: 10 },
    { kw: "mac's", w: 6 },
    { kw: 'variety', w: 3 },
  ],
  'Payment': [
    { kw: 'payment received', w: 15 },
    { kw: 'trsf from', w: 15 },
    { kw: 'payment - thank', w: 15 },
  ],
};

function scoreDescription(desc: string): { category: string; score: number } {
  const lower = desc.toLowerCase();
  let bestCategory = 'Other';
  let bestScore = 0;

  for (const [category, rules] of Object.entries(KEYWORDS)) {
    let score = 0;
    for (const rule of rules) {
      if (lower.includes(rule.kw)) {
        score += rule.w;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestCategory = category;
    }
  }

  return { category: bestCategory, score: bestScore };
}

export function categorizeTransaction(
  description: string,
  mappings: CategoryMapping[]
): { category: string; confirmed: boolean } {
  // 1. Check user-saved mappings first (these are confirmed)
  for (const mapping of mappings) {
    if (description.toLowerCase().includes(mapping.merchantPattern.toLowerCase())) {
      return { category: mapping.category, confirmed: true };
    }
  }

  // 2. Run keyword scoring engine
  const { category, score } = scoreDescription(description);
  if (score > 0) {
    return { category, confirmed: false };
  }

  // 3. Foreign currency transactions
  const foreignMatch = description.match(/(?:MXN|USD|EUR|GBP)\s+[\d.]+@[\d.]+\s+(.*)/i);
  if (foreignMatch) {
    const { category: foreignCat, score: foreignScore } = scoreDescription(foreignMatch[1]);
    if (foreignScore > 0) {
      return { category: foreignCat, confirmed: false };
    }
    return { category: 'Travel', confirmed: false };
  }

  return { category: 'Other', confirmed: false };
}

export function extractMerchantPattern(description: string): string {
  let cleaned = description
    .replace(/\s+(ON|BC|AB|QC|MB|SK|NB|NS|PE|NL|NT|YT|NU)\s*$/i, '')
    .replace(/\s+#\d+/g, '')
    .replace(/\s+\d+$/, '')
    .replace(/\*[A-Z0-9]+/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

  const foreignMatch = description.match(/(?:MXN|USD|EUR|GBP)\s+[\d.]+@[\d.]+\s+(.*)/i);
  if (foreignMatch) {
    cleaned = foreignMatch[1].replace(/\s+(ON|BC|AB|QC)\s*$/i, '').replace(/\s+\d+$/, '').trim();
  }

  const words = cleaned.split(/\s+/).slice(0, 3);
  return words.join(' ').toLowerCase();
}
