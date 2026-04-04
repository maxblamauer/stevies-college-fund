import { useCallback, useEffect, useMemo, useState } from 'react';
import { collection, getDocs, deleteDoc, doc, orderBy, query, addDoc, updateDoc, writeBatch, where, Timestamp } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../firebase';
import { useDropzone } from 'react-dropzone';
import { parseStatement, extractText } from '../lib/parser';
import { extractMerchantPattern } from '../lib/categorize';
import { FilterSelect } from './ui/FilterSelect';
import { Modal, ModalBodyPanel } from './ui/Modal';
import type { CardProfile } from '../types';
import { CATEGORIES } from '../types';

interface Mapping {
  id: string;
  merchantPattern: string;
  category: string;
  cardProfileId?: string;
}

interface Props {
  householdId: string;
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

export function MappingsManager({ householdId }: Props) {
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

  const [deleteTarget, setDeleteTarget] = useState<
    { kind: 'card'; id: string } | { kind: 'mapping'; id: string } | null
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

  useEffect(() => {
    fetchMappings();
    fetchCardProfiles();
  }, [fetchMappings, fetchCardProfiles]);

  const deleteMappingDoc = async (id: string) => {
    await deleteDoc(doc(db, 'households', householdId, 'categoryMappings', id));
    fetchMappings();
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
    const m = mappings.find((x) => x.id === deleteTarget.id);
    return m
      ? `The mapping “${m.merchantPattern}” → ${m.category} will be removed.`
      : 'This mapping will be removed.';
  }, [deleteTarget, cardProfiles, mappings]);

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

  return (
    <div className="mappings-page">
      {/* Card Profiles Section */}
      <h2>Credit Cards</h2>
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
    </div>
  );
}
