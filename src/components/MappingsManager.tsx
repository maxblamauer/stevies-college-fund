import { useCallback, useEffect, useState } from 'react';
import { collection, getDocs, deleteDoc, doc, orderBy, query, addDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../firebase';
import { useDropzone } from 'react-dropzone';
import { parseStatement, extractText } from '../lib/parser';
import { extractMerchantPattern } from '../lib/categorize';
import type { CardProfile } from '../types';

interface Mapping {
  id: string;
  merchantPattern: string;
  category: string;
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

  const deleteMapping = async (id: string) => {
    await deleteDoc(doc(db, 'households', householdId, 'categoryMappings', id));
    fetchMappings();
  };

  const deleteCard = async (id: string) => {
    if (!confirm('Remove this card profile?')) return;
    await deleteDoc(doc(db, 'households', householdId, 'cardProfiles', id));
    fetchCardProfiles();
  };

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
      await addDoc(collection(db, 'households', householdId, 'cardProfiles'), profile);

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

        await addDoc(mappingsCol, { merchantPattern: pattern, category });
        count++;
      }

      setAddCardResult(`${profile.bankName} card added with ${count} new mappings.`);
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
    setNewCardLabel('');
    setAddCardError('');
    setAddCardResult('');
    setAddCardStep('label');
  };

  return (
    <div className="mappings-page">
      {/* Card Profiles Section */}
      <h2>Cards</h2>
      <p className="hint">
        Card profiles tell the parser how to read each credit card's statement format.
      </p>

      {cardProfiles.length === 0 && addCardStep === 'idle' ? (
        <p className="empty-state">
          No cards set up yet. Add a card to enable smart statement parsing.
        </p>
      ) : (
        <table className="mappings-table">
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
                <td><strong>{p.cardLabel}</strong></td>
                <td>{p.bankName}</td>
                <td>{p.cardholders.join(', ') || '—'}</td>
                <td>
                  <button className="btn btn-xs btn-danger" onClick={() => deleteCard(p.id)}>
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {addCardStep === 'idle' && (
        <button type="button" className="btn btn-save add-card-btn" onClick={startAddCard}>
          + Add Card
        </button>
      )}

      {addCardStep === 'label' && (
        <div className="add-card-inline">
          <input
            type="text"
            className="household-input"
            placeholder="e.g. TD Visa"
            value={newCardLabel}
            onChange={(e) => setNewCardLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && newCardLabel.trim()) {
                setAddCardStep('upload');
              }
            }}
            autoFocus
          />
          <div className="household-actions">
            <button type="button" className="btn" onClick={() => setAddCardStep('idle')}>Cancel</button>
            <button
              type="button"
              className="btn btn-save"
              onClick={() => {
                if (!newCardLabel.trim()) { setAddCardError('Give your card a name'); return; }
                setAddCardError('');
                setAddCardStep('upload');
              }}
            >
              Next
            </button>
          </div>
          {addCardError && <p className="login-error household-inline-error">{addCardError}</p>}
        </div>
      )}

      {addCardStep === 'upload' && (
        <div className="add-card-inline">
          <p className="hint">Upload a statement for <strong>{newCardLabel}</strong></p>
          <div
            {...getRootProps()}
            className={`dropzone add-card-dropzone ${isDragActive ? 'active' : ''}`}
          >
            <input {...getInputProps()} />
            <div className="dropzone-content">
              <p>{isDragActive ? 'Drop here...' : 'Drag & drop a statement PDF'}</p>
            </div>
          </div>
          <button type="button" className="btn" onClick={() => setAddCardStep('idle')}>Cancel</button>
          {addCardError && <p className="login-error household-inline-error">{addCardError}</p>}
        </div>
      )}

      {addCardStep === 'processing' && (
        <div className="add-card-inline onboarding-processing">
          <div className="upload-spinner" />
          <p>Analyzing statement format and merchants...</p>
        </div>
      )}

      {addCardStep === 'done' && (
        <div className="add-card-inline">
          <p className="add-card-success">{addCardResult}</p>
          <button type="button" className="btn" onClick={() => setAddCardStep('idle')}>Done</button>
        </div>
      )}

      {/* Mappings Section */}
      <h2 style={{ marginTop: 32 }}>Category Mappings</h2>
      <p className="hint">
        These are merchant-to-category rules. When you confirm or edit
        a transaction's category, the merchant pattern is saved here. Future uploads will
        auto-match these patterns.
      </p>

      {mappings.length === 0 ? (
        <p className="empty-state">
          No custom mappings yet. Confirm or edit transaction categories to build your mapping rules.
        </p>
      ) : (
        <table className="mappings-table">
          <thead>
            <tr>
              <th>Merchant Pattern</th>
              <th>Category</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {mappings.map((m) => (
              <tr key={m.id}>
                <td><code>{m.merchantPattern}</code></td>
                <td>{m.category}</td>
                <td>
                  <button className="btn btn-xs btn-danger" onClick={() => deleteMapping(m.id)}>
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
