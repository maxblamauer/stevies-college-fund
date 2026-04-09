import { useCallback, useEffect, useMemo, useState } from 'react';
import { collection, getDocs, deleteDoc, doc, orderBy, query, addDoc, updateDoc, writeBatch, where, Timestamp } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../firebase';
import { useDropzone } from 'react-dropzone';
import { parseStatement, extractText } from '../lib/parser';
import { extractMerchantPattern } from '../lib/categorize';
import { FilterSelect } from './ui/FilterSelect';
import { Modal, ModalBodyPanel } from './ui/Modal';
import type { CardProfile, FixedExpense, IncomeSource } from '../types';
import { CATEGORIES } from '../types';

interface Mapping {
  id: string;
  merchantPattern: string;
  category: string;
  cardProfileId?: string;
}

interface Props {
  householdId: string;
  blurAmounts: boolean;
  onBlurAmountsChange: (value: boolean) => void;
  statementMonthOffset: number;
  onStatementMonthOffsetChange: (value: number) => void;
  householdName: string;
  inviteCode: string;
  theme: 'light' | 'dark';
  onThemeChange: (theme: 'light' | 'dark') => void;
  onLogout: () => void;
  onDeleteAccount: () => void;
  userName: string;
}

interface GenerateResult {
  profile: {
    bankName: string;
    cardholders: string[];
    cardholderPatterns: string[];
    hasSections: boolean;
    useTwoDateFormat: boolean;
    creditIndicator: string;
  };
  mappings: Array<{ merchantPattern: string; category: string }>;
}

type AddCardStep = 'idle' | 'label' | 'upload' | 'processing' | 'done';

export function MappingsManager({ householdId, blurAmounts, onBlurAmountsChange, statementMonthOffset, onStatementMonthOffsetChange, householdName, inviteCode, theme, onThemeChange, onLogout, onDeleteAccount, userName }: Props) {
  const [mappings, setMappings] = useState<Mapping[]>([]);
  const [cardProfiles, setCardProfiles] = useState<(CardProfile & { id: string })[]>([]);
  const [addCardStep, setAddCardStep] = useState<AddCardStep>('idle');
  const [newCardLabel, setNewCardLabel] = useState('');
  const [addCardError, setAddCardError] = useState('');
  const [addCardResult, setAddCardResult] = useState('');

  const [editingCardId, setEditingCardId] = useState<string | null>(null);
  const [editCardLabel, setEditCardLabel] = useState('');
  const [editBankName, setEditBankName] = useState('');
  const [editCardholders, setEditCardholders] = useState('');
  const [editCardholderPatterns, setEditCardholderPatterns] = useState('');
  const [editHasSections, setEditHasSections] = useState(false);
  const [editCardError, setEditCardError] = useState('');

  const [editingMappingId, setEditingMappingId] = useState<string | null>(null);
  const [editMappingPattern, setEditMappingPattern] = useState('');
  const [editMappingCategory, setEditMappingCategory] = useState('');
  const [editMappingError, setEditMappingError] = useState('');

  const [fixedExpenses, setFixedExpenses] = useState<(FixedExpense & { id: string })[]>([]);
  const [editingExpenseId, setEditingExpenseId] = useState<string | null>(null);
  const [expenseLabel, setExpenseLabel] = useState('');
  const [expenseAmount, setExpenseAmount] = useState('');
  const [expenseCategory, setExpenseCategory] = useState('Utilities');
  const [expenseStartDate, setExpenseStartDate] = useState('');
  const [expenseEndDate, setExpenseEndDate] = useState('');
  const [expenseError, setExpenseError] = useState('');
  const [addingExpense, setAddingExpense] = useState(false);

  const [incomeSources, setIncomeSources] = useState<(IncomeSource & { id: string })[]>([]);
  const [editingIncomeId, setEditingIncomeId] = useState<string | null>(null);
  const [incomePerson, setIncomePerson] = useState('');
  const [incomeAmount, setIncomeAmount] = useState('');
  const [incomeError, setIncomeError] = useState('');
  const [addingIncome, setAddingIncome] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<
    { kind: 'card'; id: string } | { kind: 'mapping'; id: string } | { kind: 'expense'; id: string } | { kind: 'income'; id: string } | null
  >(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [expandedMappingGroups, setExpandedMappingGroups] = useState<Set<string>>(new Set());

  const categorySelectOptions = useMemo((): { value: string; label: string }[] => {
    const seen = new Set<string>([...CATEGORIES]);
    const out: { value: string; label: string }[] = CATEGORIES.map((c) => ({ value: c, label: c }));
    for (const m of mappings) {
      if (!seen.has(m.category)) {
        seen.add(m.category);
        out.push({ value: m.category, label: m.category });
      }
    }
    return out.sort((a, b) => a.label.localeCompare(b.label));
  }, [mappings]);

  const normalizeMappingPattern = (raw: string) => raw.trim().toLowerCase();

  const fetchMappings = useCallback(async () => {
    const q = query(collection(db, 'households', householdId, 'categoryMappings'), orderBy('merchantPattern'));
    const snap = await getDocs(q);
    setMappings(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Mapping)));
  }, [householdId]);

  const fetchCardProfiles = useCallback(async () => {
    const snap = await getDocs(collection(db, 'households', householdId, 'cardProfiles'));
    setCardProfiles(snap.docs.map((d) => ({ id: d.id, ...d.data() } as CardProfile & { id: string })));
  }, [householdId]);

  const fetchFixedExpenses = useCallback(async () => {
    try {
      const snap = await getDocs(
        query(collection(db, 'households', householdId, 'fixedExpenses'), orderBy('label'))
      );
      setFixedExpenses(snap.docs.map((d) => ({ id: d.id, ...d.data() } as FixedExpense & { id: string })));
    } catch {
      setFixedExpenses([]);
    }
  }, [householdId]);

  const fetchIncomeSources = useCallback(async () => {
    try {
      const snap = await getDocs(
        query(collection(db, 'households', householdId, 'incomeSources'), orderBy('person'))
      );
      setIncomeSources(snap.docs.map((d) => ({ id: d.id, ...d.data() } as IncomeSource & { id: string })));
    } catch {
      setIncomeSources([]);
    }
  }, [householdId]);

  useEffect(() => {
    fetchMappings();
    fetchCardProfiles();
    fetchFixedExpenses();
    fetchIncomeSources();
  }, [fetchMappings, fetchCardProfiles, fetchFixedExpenses, fetchIncomeSources]);

  const deleteMappingDoc = async (id: string) => {
    await deleteDoc(doc(db, 'households', householdId, 'categoryMappings', id));
    fetchMappings();
  };

  const openAddExpense = () => {
    setAddingExpense(true);
    setEditingExpenseId(null);
    setExpenseLabel('');
    setExpenseAmount('');
    setExpenseCategory('Utilities');
    setExpenseStartDate(new Date().toISOString().slice(0, 10));
    setExpenseEndDate('');
    setExpenseError('');
  };

  const openEditExpense = (e: FixedExpense & { id: string }) => {
    setAddingExpense(false);
    setEditingExpenseId(e.id);
    setExpenseLabel(e.label);
    setExpenseAmount(String(e.amount));
    setExpenseCategory(e.category);
    setExpenseStartDate(e.startDate);
    setExpenseEndDate(e.endDate || '');
    setExpenseError('');
  };

  const closeExpenseModal = () => {
    setAddingExpense(false);
    setEditingExpenseId(null);
    setExpenseError('');
  };

  const saveExpense = async () => {
    const label = expenseLabel.trim();
    if (!label) { setExpenseError('Name is required.'); return; }
    const amount = parseFloat(expenseAmount);
    if (!amount || amount <= 0) { setExpenseError('Enter a valid amount.'); return; }
    if (!expenseStartDate) { setExpenseError('Start date is required.'); return; }
    setExpenseError('');

    const data: Omit<FixedExpense, 'id'> = {
      label,
      amount,
      category: expenseCategory,
      frequency: 'monthly',
      startDate: expenseStartDate,
      ...(expenseEndDate ? { endDate: expenseEndDate } : {}),
    };

    try {
      if (editingExpenseId) {
        await updateDoc(doc(db, 'households', householdId, 'fixedExpenses', editingExpenseId), data);
      } else {
        await addDoc(collection(db, 'households', householdId, 'fixedExpenses'), data);
      }
      closeExpenseModal();
      fetchFixedExpenses();
    } catch (err) {
      console.error('Save expense error:', err);
      setExpenseError(err instanceof Error ? err.message : 'Could not save.');
    }
  };

  const openAddIncome = () => {
    setAddingIncome(true);
    setEditingIncomeId(null);
    setIncomePerson('');
    setIncomeAmount('');
    setIncomeError('');
  };

  const openEditIncome = (inc: IncomeSource & { id: string }) => {
    setAddingIncome(false);
    setEditingIncomeId(inc.id);
    setIncomePerson(inc.person);
    setIncomeAmount(String(inc.amount));
    setIncomeError('');
  };

  const closeIncomeModal = () => {
    setAddingIncome(false);
    setEditingIncomeId(null);
    setIncomeError('');
  };

  const saveIncome = async () => {
    const person = incomePerson.trim();
    if (!person) { setIncomeError('Name is required.'); return; }
    const amount = parseFloat(incomeAmount);
    if (!amount || amount <= 0) { setIncomeError('Enter a valid amount.'); return; }
    setIncomeError('');

    const data: Omit<IncomeSource, 'id'> = { person, amount };

    try {
      if (editingIncomeId) {
        await updateDoc(doc(db, 'households', householdId, 'incomeSources', editingIncomeId), data);
      } else {
        await addDoc(collection(db, 'households', householdId, 'incomeSources'), data);
      }
      closeIncomeModal();
      fetchIncomeSources();
    } catch (err) {
      console.error('Save income error:', err);
      setIncomeError(err instanceof Error ? err.message : 'Could not save.');
    }
  };

  const mappingPatternTaken = (normalized: string, exceptId?: string) =>
    mappings.some(
      (m) => normalizeMappingPattern(m.merchantPattern) === normalized && m.id !== exceptId
    );

  const startEditMapping = (m: Mapping) => {
    setEditingMappingId(m.id);
    setEditMappingPattern(m.merchantPattern);
    setEditMappingCategory(m.category);
    setEditMappingError('');
  };

  const cancelEditMapping = () => {
    setEditingMappingId(null);
    setEditMappingError('');
  };

  const saveEditMapping = async () => {
    if (!editingMappingId) return;
    const normalized = normalizeMappingPattern(editMappingPattern);
    if (!normalized) {
      setEditMappingError('Pattern cannot be empty.');
      return;
    }
    if (mappingPatternTaken(normalized, editingMappingId)) {
      setEditMappingError('Another mapping already uses this pattern.');
      return;
    }
    if (!categorySelectOptions.some((o) => o.value === editMappingCategory)) {
      setEditMappingError('Pick a valid category.');
      return;
    }
    setEditMappingError('');
    try {
      await updateDoc(doc(db, 'households', householdId, 'categoryMappings', editingMappingId), {
        merchantPattern: normalized,
        category: editMappingCategory,
      });
      setEditingMappingId(null);
      fetchMappings();
    } catch (err) {
      console.error('Save mapping error:', err);
      setEditMappingError(err instanceof Error ? err.message : 'Could not save.');
    }
  };

  const deleteCardDoc = async (id: string) => {
    await deleteDoc(doc(db, 'households', householdId, 'cardProfiles', id));
    fetchCardProfiles();
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleteBusy(true);
    try {
      if (deleteTarget.kind === 'card') {
        await deleteCardDoc(deleteTarget.id);
      } else if (deleteTarget.kind === 'expense') {
        await deleteDoc(doc(db, 'households', householdId, 'fixedExpenses', deleteTarget.id));
        fetchFixedExpenses();
      } else if (deleteTarget.kind === 'income') {
        await deleteDoc(doc(db, 'households', householdId, 'incomeSources', deleteTarget.id));
        fetchIncomeSources();
      } else {
        await deleteMappingDoc(deleteTarget.id);
      }
      setDeleteTarget(null);
    } catch (err) {
      console.error('Delete error:', err);
    } finally {
      setDeleteBusy(false);
    }
  };

  const deleteDetailLine = useMemo(() => {
    if (!deleteTarget) return '';
    if (deleteTarget.kind === 'card') {
      const p = cardProfiles.find((c) => c.id === deleteTarget.id);
      return p
        ? `The card “${p.cardLabel}” (${p.bankName}) will be removed.`
        : 'This card will be removed.';
    }
    if (deleteTarget.kind === 'expense') {
      const e = fixedExpenses.find((x) => x.id === deleteTarget.id);
      return e
        ? `The fixed expense “${e.label}” ($${e.amount}/mo) will be removed.`
        : 'This fixed expense will be removed.';
    }
    if (deleteTarget.kind === 'income') {
      const inc = incomeSources.find((x) => x.id === deleteTarget.id);
      return inc
        ? `The income source for “${inc.person}” will be removed.`
        : 'This income source will be removed.';
    }
    const m = mappings.find((x) => x.id === deleteTarget.id);
    return m
      ? `The mapping “${m.merchantPattern}” → ${m.category} will be removed.`
      : 'This mapping will be removed.';
  }, [deleteTarget, cardProfiles, mappings, fixedExpenses]);

  const onDrop = useCallback(async (files: File[]) => {
    if (files.length === 0) return;
    setAddCardError('');
    setAddCardStep('processing');

    try {
      const buffer = await files[0].arrayBuffer();
      const pdfText = await extractText(new Uint8Array(buffer.slice(0)));
      const parsed = await parseStatement(new Uint8Array(buffer.slice(0)), []);

      const merchantMap = new Map<string, string>();
      for (const txn of parsed.transactions) {
        if (txn.isCredit) continue;
        const pattern = extractMerchantPattern(txn.description);
        if (pattern && !merchantMap.has(pattern)) {
          merchantMap.set(pattern, txn.description);
        }
      }

      if (merchantMap.size === 0) {
        setAddCardError('No merchant transactions found. Try a different file.');
        setAddCardStep('upload');
        return;
      }

      const descriptions = Array.from(merchantMap.values());
      const generateMappings = httpsCallable<
        { descriptions: string[]; pdfText: string },
        GenerateResult
      >(functions, 'generateMappings');

      const result = await generateMappings({ descriptions, pdfText });

      // Save card profile
      const profile: Omit<CardProfile, 'id'> = {
        cardLabel: newCardLabel.trim(),
        bankName: result.data.profile.bankName || 'Unknown',
        cardholders: result.data.profile.cardholders || [],
        cardholderPatterns: result.data.profile.cardholderPatterns || [],
        hasSections: result.data.profile.hasSections ?? false,
        useTwoDateFormat: result.data.profile.useTwoDateFormat ?? true,
        creditIndicator: result.data.profile.creditIndicator || 'CR',
      };
      const cardProfileRef = await addDoc(collection(db, 'households', householdId, 'cardProfiles'), profile);

      // Build Claude category lookup
      const claudeCategories = new Map<string, string>();
      for (const m of result.data.mappings) {
        const key = m.merchantPattern?.toLowerCase().trim();
        if (key && m.category) claudeCategories.set(key, m.category);
      }

      // Save new mappings using our extractMerchantPattern (skip duplicates)
      const existingPatterns = new Set(mappings.map((m) => m.merchantPattern));
      const mappingsCol = collection(db, 'households', householdId, 'categoryMappings');
      let count = 0;

      for (const [pattern, desc] of merchantMap) {
        if (existingPatterns.has(pattern)) continue;
        existingPatterns.add(pattern);

        let category = 'Other';
        const descLower = desc.toLowerCase();
        const patternWords = pattern.split(/\s+/);

        for (const [claudePattern, claudeCategory] of claudeCategories) {
          if (
            descLower.includes(claudePattern) ||
            claudePattern.includes(pattern) ||
            patternWords.some((w) => w.length > 2 && claudePattern.includes(w)) ||
            claudePattern.split(/\s+/).some((w: string) => w.length > 2 && descLower.includes(w))
          ) {
            category = claudeCategory;
            break;
          }
        }

        // Don't save "Other" mappings — let the built-in keyword engine handle those
        if (category === 'Other') continue;

        await addDoc(mappingsCol, { merchantPattern: pattern, category, cardProfileId: cardProfileRef.id });
        count++;
      }

      // Re-parse with new profile + all mappings, then save statement & transactions
      const allMappingsSnap = await getDocs(collection(db, 'households', householdId, 'categoryMappings'));
      const allMappings = allMappingsSnap.docs.map((d) => d.data() as { merchantPattern: string; category: string });

      // Keep a copy of bytes for re-parse (pdfjs detaches ArrayBuffer)
      const fileBytes = new Uint8Array(buffer.slice(0));
      let reParsed = await parseStatement(new Uint8Array(fileBytes), allMappings, profile as CardProfile);
      if (reParsed.transactions.length === 0) {
        reParsed = await parseStatement(new Uint8Array(fileBytes), allMappings);
      }

      let txnCount = 0;
      // Check for duplicate statement
      const existingStmtSnap = reParsed.statementDate
        ? await getDocs(
            query(
              collection(db, 'households', householdId, 'statements'),
              where('statementDate', '==', reParsed.statementDate)
            )
          )
        : null;

      if ((!existingStmtSnap || existingStmtSnap.empty) && reParsed.transactions.length > 0) {
        const stmtRef = await addDoc(collection(db, 'households', householdId, 'statements'), {
          filename: files[0].name,
          statementDate: reParsed.statementDate,
          periodStart: reParsed.periodStart,
          periodEnd: reParsed.periodEnd,
          totalBalance: reParsed.totalBalance,
          uploadedAt: Timestamp.now(),
          cardProfileId: cardProfileRef.id,
        });

        const txnCol = collection(db, 'households', householdId, 'transactions');
        for (let i = 0; i < reParsed.transactions.length; i += 500) {
          const batch = writeBatch(db);
          const chunk = reParsed.transactions.slice(i, i + 500);
          for (const txn of chunk) {
            const ref = doc(txnCol);
            batch.set(ref, {
              statementId: stmtRef.id,
              transDate: txn.transDate,
              postingDate: txn.postingDate,
              description: txn.description,
              amount: txn.amount,
              isCredit: txn.isCredit,
              cardholder: txn.cardholder,
              category: txn.category,
              confirmed: txn.confirmed,
              cardProfileId: cardProfileRef.id,
            });
          }
          await batch.commit();
        }
        txnCount = reParsed.transactions.length;
      }

      const txnMsg = txnCount > 0 ? ` and ${txnCount} transactions imported` : '';
      setAddCardResult(`${profile.bankName} card added with ${count} new mappings${txnMsg}.`);
      setAddCardStep('done');
      fetchCardProfiles();
      fetchMappings();
    } catch (err) {
      console.error('Add card error:', err);
      setAddCardError(err instanceof Error ? err.message : 'Something went wrong.');
      setAddCardStep('upload');
    }
  }, [householdId, newCardLabel, mappings, fetchCardProfiles, fetchMappings]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'application/pdf': ['.pdf'] },
    maxFiles: 1,
    disabled: addCardStep !== 'upload',
  });

  const startAddCard = () => {
    setEditingCardId(null);
    setEditCardError('');
    setNewCardLabel('');
    setAddCardError('');
    setAddCardResult('');
    setAddCardStep('label');
  };

  const startEditCard = (p: CardProfile & { id: string }) => {
    setAddCardStep('idle');
    setAddCardError('');
    setAddCardResult('');
    setEditingCardId(p.id);
    setEditCardLabel(p.cardLabel);
    setEditBankName(p.bankName);
    setEditCardholders(p.cardholders.join(', '));
    setEditCardholderPatterns(p.cardholderPatterns.join(', '));
    setEditHasSections(p.hasSections);
    setEditCardError('');
  };

  const cancelEditCard = () => {
    setEditingCardId(null);
    setEditCardError('');
  };

  const cancelAddCard = () => {
    setAddCardStep('idle');
    setNewCardLabel('');
    setAddCardError('');
    setAddCardResult('');
  };

  const closeAddCardModal = () => {
    if (addCardStep === 'processing') return;
    cancelAddCard();
  };

  const saveEditCard = async () => {
    if (!editingCardId) return;
    const label = editCardLabel.trim();
    if (!label) {
      setEditCardError('Give your card a name');
      return;
    }
    setEditCardError('');
    const holders = editCardholders
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const patterns = editCardholderPatterns
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    try {
      await updateDoc(doc(db, 'households', householdId, 'cardProfiles', editingCardId), {
        cardLabel: label,
        bankName: editBankName.trim() || 'Unknown',
        cardholders: holders,
        cardholderPatterns: patterns,
        hasSections: editHasSections,
      });
      setEditingCardId(null);
      fetchCardProfiles();
    } catch (err) {
      console.error('Save card error:', err);
      setEditCardError(err instanceof Error ? err.message : 'Could not save.');
    }
  };

  const [codeCopied, setCodeCopied] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [memberCount, setMemberCount] = useState(0);

  // Fetch member count when delete modal opens
  useEffect(() => {
    if (!showDeleteConfirm || !householdId) return;
    getDocs(collection(db, 'households', householdId, 'members')).then((snap) => {
      setMemberCount(snap.size);
    });
  }, [showDeleteConfirm, householdId]);

  return (
    <div className="mappings-page">
      {/* Display Section */}
      <h2 className="mappings-page-section-title">Display</h2>
      <p className="hint">Appearance and display preferences.</p>
      <div className="table-wrapper">
        <table className="transactions-table fixed-expenses-table">
          <thead>
            <tr>
              <th>Setting</th>
              <th>Description</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="mapping-cell-primary"><strong>Dark mode</strong></td>
              <td className="mapping-cell-meta">Switch between light and dark theme</td>
              <td className="mapping-cell-actions">
                <label className="fixed-expense-toggle">
                  <input type="checkbox" checked={theme === 'dark'} onChange={(e) => onThemeChange(e.target.checked ? 'dark' : 'light')} />
                  <span className="fixed-expense-toggle-track" />
                </label>
              </td>
            </tr>
            <tr>
              <td className="mapping-cell-primary"><strong>Blur amounts</strong></td>
              <td className="mapping-cell-meta">Hide dollar values throughout the app for privacy</td>
              <td className="mapping-cell-actions">
                <label className="fixed-expense-toggle">
                  <input type="checkbox" checked={blurAmounts} onChange={(e) => onBlurAmountsChange(e.target.checked)} />
                  <span className="fixed-expense-toggle-track" />
                </label>
              </td>
            </tr>
            <tr>
              <td className="mapping-cell-primary"><strong>Statement month offset</strong></td>
              <td className="mapping-cell-meta">Show statement as the prior month's spending (e.g. Apr statement = March)</td>
              <td className="mapping-cell-actions">
                <label className="fixed-expense-toggle">
                  <input type="checkbox" checked={statementMonthOffset !== 0} onChange={(e) => onStatementMonthOffsetChange(e.target.checked ? -1 : 0)} />
                  <span className="fixed-expense-toggle-track" />
                </label>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Card Profiles Section */}
      <h2 className="mappings-page-section-title">Credit Cards</h2>
      <p className="hint">
        Card profiles tell the parser how to read each credit card's statement format.
      </p>

      <div className="table-wrapper">
        <table className="transactions-table mappings-cards-table">
          <thead>
            <tr>
              <th>Card</th>
              <th>Bank</th>
              <th>Cardholders</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {cardProfiles.map((p) => (
              <tr key={p.id}>
                <td className="mapping-cell-primary">
                  <strong>{p.cardLabel}</strong>
                </td>
                <td className="mapping-cell-meta">{p.bankName}</td>
                <td className="mapping-cell-meta2">{p.cardholders.join(', ') || '—'}</td>
                <td className="mapping-cell-actions">
                  <button type="button" className="btn btn-xs" onClick={() => startEditCard(p)}>
                    Edit
                  </button>
                  <button
                    type="button"
                    className="btn btn-xs btn-destructive"
                    onClick={() => setDeleteTarget({ kind: 'card', id: p.id })}
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
            <tr>
              <td colSpan={4} className="table-action-row">
                <button
                  type="button"
                  className="btn btn-xs btn-save"
                  onClick={startAddCard}
                  disabled={addCardStep !== 'idle'}
                >
                  + Add Card
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <Modal
        open={addCardStep !== 'idle'}
        onClose={closeAddCardModal}
        title={
          addCardStep === 'label'
            ? 'Add card'
            : addCardStep === 'upload'
              ? 'Upload statement'
              : addCardStep === 'processing'
                ? 'Adding card…'
                : 'Card added'
        }
        description={
          addCardStep === 'label'
            ? 'Name this card, then upload a sample statement so we can learn its format.'
            : addCardStep === 'upload'
              ? `PDF for “${newCardLabel}”.`
              : addCardStep === 'processing'
                ? 'Analyzing statement format and merchants…'
                : undefined
        }
        panelClassName="modal-panel--add-card"
        closeOnBackdropClick={addCardStep !== 'processing'}
        showCloseButton={addCardStep !== 'processing'}
      >
        {addCardStep === 'label' && (
          <>
            <ModalBodyPanel>
              <div className="edit-card-panel-fields">
                <label className="edit-card-field">
                  <span className="edit-card-field-label">Card name</span>
                  <input
                    type="text"
                    className="household-input"
                    placeholder="e.g. TD Visa"
                    value={newCardLabel}
                    onChange={(e) => setNewCardLabel(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && newCardLabel.trim()) {
                        setAddCardError('');
                        setAddCardStep('upload');
                      }
                    }}
                  />
                </label>
              </div>
            </ModalBodyPanel>
            <div className="edit-card-panel-actions">
              <button type="button" className="btn" onClick={cancelAddCard}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-save"
                onClick={() => {
                  if (!newCardLabel.trim()) {
                    setAddCardError('Give your card a name');
                    return;
                  }
                  setAddCardError('');
                  setAddCardStep('upload');
                }}
              >
                Next
              </button>
            </div>
            {addCardError && <p className="login-error household-inline-error edit-card-panel-error">{addCardError}</p>}
          </>
        )}
        {addCardStep === 'upload' && (
          <>
            <ModalBodyPanel>
              <div
                {...getRootProps()}
                className={`dropzone add-card-dropzone ${isDragActive ? 'active' : ''}`}
              >
                <input {...getInputProps()} />
                <div className="dropzone-content">
                  <p>{isDragActive ? 'Drop here...' : 'Drag & drop a statement PDF'}</p>
                </div>
              </div>
            </ModalBodyPanel>
            <div className="edit-card-panel-actions">
              <button type="button" className="btn" onClick={cancelAddCard}>
                Cancel
              </button>
            </div>
            {addCardError && <p className="login-error household-inline-error edit-card-panel-error">{addCardError}</p>}
          </>
        )}
        {addCardStep === 'processing' && (
          <ModalBodyPanel>
            <div className="onboarding-processing">
              <div className="upload-spinner" />
              <p>This may take a moment.</p>
            </div>
          </ModalBodyPanel>
        )}
        {addCardStep === 'done' && (
          <>
            <ModalBodyPanel>
              <p className="add-card-success modal-add-card-done-msg">{addCardResult}</p>
            </ModalBodyPanel>
            <div className="edit-card-panel-actions">
              <button type="button" className="btn btn-save" onClick={cancelAddCard}>
                Done
              </button>
            </div>
          </>
        )}
      </Modal>

      {/* Fixed Expenses Section */}
      <h2 className="mappings-page-section-title">Fixed Expenses</h2>
      <p className="hint">
        Recurring expenses outside of credit cards (rent, utilities, insurance, etc.) that are included in your spending totals.
      </p>

      <div className="table-wrapper">
        <table className="transactions-table fixed-expenses-table">
          <thead>
            <tr>
              <th>Expense</th>
              <th>Amount</th>
              <th>Category</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {fixedExpenses.map((e) => (
              <tr key={e.id}>
                <td className="mapping-cell-primary">
                  <strong>{e.label}</strong>
                  {e.endDate && <span className="fixed-expense-ended"> (ended)</span>}
                </td>
                <td className="mapping-cell-meta fixed-expense-amount">
                  ${e.amount.toLocaleString('en-CA', { minimumFractionDigits: 2 })}/mo
                </td>
                <td className="mapping-cell-meta2">
                  <span className={`category-badge cat-${e.category.toLowerCase().replace(/[^a-z]/g, '-')}`}>
                    {e.category}
                  </span>
                </td>
                <td className="mapping-cell-actions">
                  <button type="button" className="btn btn-xs" onClick={() => openEditExpense(e)}>
                    Edit
                  </button>
                  <button
                    type="button"
                    className="btn btn-xs btn-destructive"
                    onClick={() => setDeleteTarget({ kind: 'expense', id: e.id })}
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
            {fixedExpenses.length === 0 && (
              <tr>
                <td colSpan={4} className="empty-state" style={{ padding: '20px 14px', borderBottom: 'none' }}>
                  No fixed expenses yet.
                </td>
              </tr>
            )}
            <tr>
              <td colSpan={4} className="table-action-row">
                <button type="button" className="btn btn-xs btn-save" onClick={openAddExpense}>
                  + Add Expense
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <Modal
        open={addingExpense || editingExpenseId !== null}
        onClose={closeExpenseModal}
        title={editingExpenseId ? 'Edit expense' : 'Add fixed expense'}
        description="This amount will be added to your monthly spending totals."
      >
        <ModalBodyPanel>
          <div className="edit-card-panel-fields">
            <label className="edit-card-field">
              <span className="edit-card-field-label">Name</span>
              <input
                type="text"
                className="household-input"
                placeholder="e.g. Rent, Hydro, Insurance"
                value={expenseLabel}
                onChange={(e) => setExpenseLabel(e.target.value)}
              />
            </label>
            <label className="edit-card-field">
              <span className="edit-card-field-label">Monthly amount</span>
              <input
                type="number"
                className="household-input"
                placeholder="0.00"
                min="0"
                step="0.01"
                value={expenseAmount}
                onChange={(e) => setExpenseAmount(e.target.value)}
              />
            </label>
            <label className="edit-card-field">
              <span className="edit-card-field-label">Category</span>
              <FilterSelect
                className="filter-pill mapping-category-select"
                value={expenseCategory}
                onChange={setExpenseCategory}
                options={categorySelectOptions}
              />
            </label>
            <label className="edit-card-field">
              <span className="edit-card-field-label">Start date</span>
              <input
                type="date"
                className="household-input"
                value={expenseStartDate}
                onChange={(e) => setExpenseStartDate(e.target.value)}
              />
            </label>
            <label className="edit-card-field">
              <span className="edit-card-field-label">End date <span className="edit-card-field-hint">(optional — leave blank if ongoing)</span></span>
              <input
                type="date"
                className="household-input"
                value={expenseEndDate}
                onChange={(e) => setExpenseEndDate(e.target.value)}
              />
            </label>
          </div>
        </ModalBodyPanel>
        <div className="edit-card-panel-actions">
          <button type="button" className="btn" onClick={closeExpenseModal}>Cancel</button>
          <button type="button" className="btn btn-save" onClick={() => void saveExpense()}>
            {editingExpenseId ? 'Save changes' : 'Add expense'}
          </button>
        </div>
        {expenseError && (
          <p className="login-error household-inline-error edit-card-panel-error">{expenseError}</p>
        )}
      </Modal>

      {/* Income Section */}
      <h2 className="mappings-page-section-title">Income</h2>
      <p className="hint">
        Monthly income per person. Used to calculate your household surplus on the dashboard.
      </p>

      <div className="table-wrapper">
        <table className="transactions-table mappings-income-table">
          <thead>
            <tr>
              <th>Person</th>
              <th>Monthly Income</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {incomeSources.map((inc) => (
              <tr key={inc.id}>
                <td className="mapping-cell-primary">
                  <strong>{inc.person}</strong>
                </td>
                <td className="mapping-cell-meta income-amount">
                  ${inc.amount.toLocaleString('en-CA', { minimumFractionDigits: 2 })}/mo
                </td>
                <td className="mapping-cell-actions">
                  <button type="button" className="btn btn-xs" onClick={() => openEditIncome(inc)}>
                    Edit
                  </button>
                  <button
                    type="button"
                    className="btn btn-xs btn-destructive"
                    onClick={() => setDeleteTarget({ kind: 'income', id: inc.id })}
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
            {incomeSources.length === 0 && (
              <tr>
                <td colSpan={3} className="empty-state" style={{ padding: '20px 14px', borderBottom: 'none' }}>
                  No income sources yet.
                </td>
              </tr>
            )}
            <tr>
              <td colSpan={3} className="table-action-row">
                <button type="button" className="btn btn-xs btn-save" onClick={openAddIncome}>
                  + Add Income
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <Modal
        open={addingIncome || editingIncomeId !== null}
        onClose={closeIncomeModal}
        title={editingIncomeId ? 'Edit income' : 'Add income source'}
        description="Monthly take-home income for this person."
      >
        <ModalBodyPanel>
          <div className="edit-card-panel-fields">
            <label className="edit-card-field">
              <span className="edit-card-field-label">Person</span>
              <input
                type="text"
                className="household-input"
                placeholder="e.g. Max, Kathryn"
                value={incomePerson}
                onChange={(e) => setIncomePerson(e.target.value)}
              />
            </label>
            <label className="edit-card-field">
              <span className="edit-card-field-label">Monthly amount</span>
              <input
                type="number"
                className="household-input"
                placeholder="0.00"
                min="0"
                step="0.01"
                value={incomeAmount}
                onChange={(e) => setIncomeAmount(e.target.value)}
              />
            </label>
          </div>
        </ModalBodyPanel>
        <div className="edit-card-panel-actions">
          <button type="button" className="btn" onClick={closeIncomeModal}>Cancel</button>
          <button type="button" className="btn btn-save" onClick={() => void saveIncome()}>
            {editingIncomeId ? 'Save changes' : 'Add income'}
          </button>
        </div>
        {incomeError && (
          <p className="login-error household-inline-error edit-card-panel-error">{incomeError}</p>
        )}
      </Modal>

      {/* Mappings Section */}
      <h2 className="mappings-page-section-title">Category Mappings</h2>
      <p className="hint">
        These are merchant-to-category rules. When you confirm or edit
        a transaction's category, the merchant pattern is saved here. Future uploads will
        auto-match these patterns.
      </p>

      {mappings.length === 0 ? (
        <p className="empty-state">
          No custom mappings yet. Confirm or edit transaction categories from the Transactions tab to build rules here.
        </p>
      ) : (
        (() => {
          // Group mappings by card
          const byCard = new Map<string, Mapping[]>();
          const ungrouped: Mapping[] = [];
          for (const m of mappings) {
            if (m.cardProfileId) {
              if (!byCard.has(m.cardProfileId)) byCard.set(m.cardProfileId, []);
              byCard.get(m.cardProfileId)!.push(m);
            } else {
              ungrouped.push(m);
            }
          }
          const groups: { key: string; label: string; items: Mapping[] }[] = [];
          for (const [profileId, items] of byCard) {
            const profile = cardProfiles.find((p) => p.id === profileId);
            groups.push({
              key: profileId,
              label: profile ? `${profile.cardLabel} (${profile.bankName})` : 'Unknown Card',
              items,
            });
          }
          if (ungrouped.length > 0) {
            groups.push({ key: '__general__', label: 'General', items: ungrouped });
          }

          const toggleGroup = (key: string) => {
            setExpandedMappingGroups((prev) => {
              const next = new Set(prev);
              if (next.has(key)) next.delete(key); else next.add(key);
              return next;
            });
          };

          return groups.map((group) => {
            const isExpanded = expandedMappingGroups.has(group.key);
            return (
              <div key={group.key} className="mappings-card-group">
                <button
                  type="button"
                  className="mappings-card-group-header"
                  onClick={() => toggleGroup(group.key)}
                  aria-expanded={isExpanded}
                >
                  <span className="mappings-card-group-chevron" data-expanded={isExpanded}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="9 6 15 12 9 18" />
                    </svg>
                  </span>
                  <span className="mappings-card-group-label">{group.label}</span>
                  <span className="mappings-card-group-count">{group.items.length} mapping{group.items.length !== 1 ? 's' : ''}</span>
                </button>
                {isExpanded && (
                  <div className="table-wrapper">
                    <table className="transactions-table mappings-rules-table">
                      <thead>
                        <tr>
                          <th>Merchant Pattern</th>
                          <th>Category</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {group.items.map((m) => (
                          <tr key={m.id}>
                            <td className="mapping-pattern-cell">
                              <code className="mapping-pattern-badge">{m.merchantPattern}</code>
                            </td>
                            <td className="mapping-category-cell">
                              <span
                                className={`category-badge cat-${m.category.toLowerCase().replace(/[^a-z]/g, '-')}`}
                              >
                                {m.category}
                              </span>
                            </td>
                            <td className="mapping-cell-actions">
                              <button type="button" className="btn btn-xs" onClick={() => startEditMapping(m)}>
                                Edit
                              </button>
                              <button
                                type="button"
                                className="btn btn-xs btn-destructive"
                                onClick={() => setDeleteTarget({ kind: 'mapping', id: m.id })}
                              >
                                Remove
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          });
        })()
      )}

      <Modal
        open={editingCardId !== null}
        onClose={cancelEditCard}
        title="Editing this card"
        description="Re-upload statements after changing parser settings for them to take effect."
      >
        <ModalBodyPanel>
          <div className="edit-card-panel-fields">
            <label className="edit-card-field">
              <span className="edit-card-field-label">Card</span>
              <input
                type="text"
                className="household-input"
                value={editCardLabel}
                onChange={(e) => setEditCardLabel(e.target.value)}
              />
            </label>
            <label className="edit-card-field">
              <span className="edit-card-field-label">Bank</span>
              <input
                type="text"
                className="household-input"
                value={editBankName}
                onChange={(e) => setEditBankName(e.target.value)}
              />
            </label>
            <label className="edit-card-field">
              <span className="edit-card-field-label">Cardholders</span>
              <input
                type="text"
                className="household-input"
                placeholder="Comma-separated names, e.g. Max Blamauer, Kathryn Peddar"
                value={editCardholders}
                onChange={(e) => setEditCardholders(e.target.value)}
              />
            </label>
            <label className="edit-card-field">
              <span className="edit-card-field-label">Statement patterns</span>
              <input
                type="text"
                className="household-input"
                placeholder="Exact text from PDF, e.g. MR MAX BLAMAUER, MRS KATHRYN PEDDAR"
                value={editCardholderPatterns}
                onChange={(e) => setEditCardholderPatterns(e.target.value)}
              />
              <span className="edit-card-field-hint">The exact names as printed on the statement, used to split transactions by cardholder.</span>
            </label>
            <label className="joint-card-toggle">
              <input
                type="checkbox"
                checked={editHasSections}
                onChange={(e) => setEditHasSections(e.target.checked)}
              />
              <span>Statement has separate sections per cardholder</span>
            </label>
          </div>
        </ModalBodyPanel>
        <div className="edit-card-panel-actions">
          <button type="button" className="btn" onClick={cancelEditCard}>
            Cancel
          </button>
          <button type="button" className="btn btn-save" onClick={() => void saveEditCard()}>
            Save changes
          </button>
        </div>
        {editCardError && (
          <p className="login-error household-inline-error edit-card-panel-error">{editCardError}</p>
        )}
      </Modal>

      <Modal
        open={deleteTarget !== null}
        onClose={() => !deleteBusy && setDeleteTarget(null)}
        title="Are you sure?"
        description="This action cannot be undone."
        closeOnBackdropClick={!deleteBusy}
        showCloseButton={!deleteBusy}
      >
        <ModalBodyPanel>
          <p className="modal-confirm-detail">{deleteDetailLine}</p>
        </ModalBodyPanel>
        <div className="edit-card-panel-actions">
          <button type="button" className="btn" disabled={deleteBusy} onClick={() => setDeleteTarget(null)}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-destructive"
            disabled={deleteBusy}
            onClick={() => void confirmDelete()}
          >
            {deleteBusy ? 'Removing…' : 'Remove'}
          </button>
        </div>
      </Modal>

      <Modal
        open={editingMappingId !== null}
        onClose={cancelEditMapping}
        title="Edit mapping"
        description="Pattern is saved lowercase; descriptions match if they include this text."
      >
        <ModalBodyPanel>
          <div className="edit-card-panel-fields">
            <label className="edit-card-field">
              <span className="edit-card-field-label">Merchant pattern</span>
              <input
                type="text"
                className="household-input"
                value={editMappingPattern}
                onChange={(e) => setEditMappingPattern(e.target.value)}
              />
            </label>
            <label className="edit-card-field">
              <span className="edit-card-field-label">Category</span>
              <FilterSelect
                className="filter-pill mapping-category-select"
                value={editMappingCategory}
                onChange={setEditMappingCategory}
                options={categorySelectOptions}
              />
            </label>
          </div>
        </ModalBodyPanel>
        <div className="edit-card-panel-actions">
          <button type="button" className="btn" onClick={cancelEditMapping}>
            Cancel
          </button>
          <button type="button" className="btn btn-save" onClick={() => void saveEditMapping()}>
            Save changes
          </button>
        </div>
        {editMappingError && (
          <p className="login-error household-inline-error edit-card-panel-error">{editMappingError}</p>
        )}
      </Modal>

      {/* Account Section */}
      <h2 className="mappings-page-section-title">Account</h2>
      <p className="hint">Signed in as {userName}.</p>

      <div className="table-wrapper">
        <table className="transactions-table fixed-expenses-table">
          <thead>
            <tr>
              <th>Setting</th>
              <th>Value</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="mapping-cell-primary"><strong>Household</strong></td>
              <td className="mapping-cell-meta">{householdName}</td>
              <td className="mapping-cell-actions"></td>
            </tr>
            {inviteCode && (
              <tr>
                <td className="mapping-cell-primary"><strong>Invite code</strong></td>
                <td className="mapping-cell-meta">{inviteCode}</td>
                <td className="mapping-cell-actions">
                  <button
                    type="button"
                    className="btn btn-xs"
                    onClick={() => {
                      navigator.clipboard.writeText(inviteCode);
                      setCodeCopied(true);
                      setTimeout(() => setCodeCopied(false), 2500);
                    }}
                  >
                    Copy
                  </button>
                </td>
              </tr>
            )}
            <tr>
              <td className="mapping-cell-primary"><strong>Sign out</strong></td>
              <td className="mapping-cell-meta"></td>
              <td className="mapping-cell-actions">
                <button type="button" className="btn btn-xs" onClick={onLogout}>
                  Sign out
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Delete Account — always at the very bottom */}
      <div className="danger-card">
        <h3 className="danger-card-title">Delete Account</h3>
        <p className="danger-card-desc">
          Permanently remove your account and all of its data. This action is not reversible, so please continue with caution.
        </p>
        <div className="danger-card-actions">
          <button type="button" className="btn btn-xs btn-destructive" onClick={() => setShowDeleteConfirm(true)}>
            Delete Account
          </button>
        </div>
      </div>

      <Modal
        open={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
        title="Delete account"
        description="This action cannot be undone. All your data will be permanently deleted."
      >
        <ModalBodyPanel>
          <p style={{ margin: '0 0 16px', fontSize: 14, color: 'var(--text-muted)' }}>
            Are you sure you want to delete your account? This will permanently remove all your household data, statements, transactions, and settings.
          </p>
          {memberCount > 1 && (
            <p style={{ margin: '0 0 16px', fontSize: 14, color: 'var(--red)', fontWeight: 600 }}>
              Warning: Your household has {memberCount} members. Deleting will remove all shared data for everyone in the household.
            </p>
          )}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-xs" onClick={() => setShowDeleteConfirm(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-xs btn-destructive"
              onClick={() => {
                setShowDeleteConfirm(false);
                onDeleteAccount();
              }}
            >
              Delete account
            </button>
          </div>
        </ModalBodyPanel>
      </Modal>

      {codeCopied && <div className="toast">Invite code copied to clipboard</div>}
    </div>
  );
}
