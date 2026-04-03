import { useCallback, useRef, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { signOut } from 'firebase/auth';
import { collection, addDoc, writeBatch, doc, Timestamp, query, where, getDocs } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { auth, db, functions } from '../firebase';
import { parseStatement, extractText } from '../lib/parser';
import { extractMerchantPattern } from '../lib/categorize';
import type { CardProfile } from '../types';
import { ThemeToggleButton } from './ui/ThemeToggleButton';
import stevieLogoWithText from '../assets/stevie-logo-with-text.png';
import stevieLogoRedBadge from '../assets/stevie-logo-login-note-open.png';

interface Props {
  householdId: string;
  onComplete: () => void;
}

type Step = 'label' | 'upload' | 'processing' | 'saving' | 'done';

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

export function OnboardingMappingSetup({ householdId, onComplete }: Props) {
  const [step, setStep] = useState<Step>('label');
  const [cardLabel, setCardLabel] = useState('');
  const [error, setError] = useState('');
  const [logoRedBadge, setLogoRedBadge] = useState(false);
  const [savedCount, setSavedCount] = useState(0);
  const [savedBank, setSavedBank] = useState('');
  /** After a successful Firestore write, revisiting upload must not duplicate docs. */
  const hasPersistedMappingRef = useRef(false);

  const onDrop = useCallback(async (files: File[]) => {
    if (files.length === 0) return;
    if (hasPersistedMappingRef.current) {
      setError('');
      setStep('done');
      return;
    }
    setError('');
    setStep('processing');

    try {
      const buffer = await files[0].arrayBuffer();
      // Save raw bytes upfront — pdfjs detaches the ArrayBuffer after each use
      const fileBytes = new Uint8Array(buffer);

      // Extract raw text for Claude to analyze format
      const pdfText = await extractText(new Uint8Array(fileBytes));

      // Parse with empty mappings to get merchant descriptions
      const parsed = await parseStatement(new Uint8Array(fileBytes), []);

      const merchantMap = new Map<string, string>();
      for (const txn of parsed.transactions) {
        if (txn.isCredit) continue;
        const pattern = extractMerchantPattern(txn.description);
        if (pattern && !merchantMap.has(pattern)) {
          merchantMap.set(pattern, txn.description);
        }
      }

      if (merchantMap.size === 0) {
        setError('No merchant transactions found in this statement. Try a different file.');
        setStep('upload');
        return;
      }

      // One-time AI call: analyze format + categorize merchants
      const descriptions = Array.from(merchantMap.values());
      const generateMappings = httpsCallable<
        { descriptions: string[]; pdfText: string },
        GenerateResult
      >(functions, 'generateMappings');

      const result = await generateMappings({ descriptions, pdfText });

      // Save everything
      setStep('saving');

      // Save card profile
      const profile: Omit<CardProfile, 'id'> = {
        cardLabel: cardLabel.trim(),
        bankName: result.data.profile.bankName || 'Unknown',
        cardholders: result.data.profile.cardholders || [],
        cardholderPatterns: result.data.profile.cardholderPatterns || [],
        hasSections: result.data.profile.hasSections ?? false,
        useTwoDateFormat: result.data.profile.useTwoDateFormat ?? true,
        creditIndicator: result.data.profile.creditIndicator || 'CR',
      };
      await addDoc(collection(db, 'households', householdId, 'cardProfiles'), profile);

      // Build a lookup from Claude's response: lowercase description snippet → category
      const claudeCategories = new Map<string, string>();
      for (const m of result.data.mappings) {
        const key = m.merchantPattern?.toLowerCase().trim();
        if (key && m.category) {
          claudeCategories.set(key, m.category);
        }
      }

      // Save mappings using OUR extractMerchantPattern (consistent with how the categorizer matches)
      // but with Claude's category assignments
      const mappingsCol = collection(db, 'households', householdId, 'categoryMappings');
      const seen = new Set<string>();
      let count = 0;

      for (const [pattern, desc] of merchantMap) {
        if (seen.has(pattern)) continue;
        seen.add(pattern);

        // Find the best matching Claude category for this merchant
        let category = 'Other';
        const descLower = desc.toLowerCase();
        const patternWords = pattern.split(/\s+/);

        for (const [claudePattern, claudeCategory] of claudeCategories) {
          // Try multiple matching strategies
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

      // Now re-parse the statement with the new mappings + profile so transactions get correct categories
      const savedMappingsSnap = await getDocs(collection(db, 'households', householdId, 'categoryMappings'));
      const savedMappings = savedMappingsSnap.docs.map((d) => d.data() as { merchantPattern: string; category: string });

      // Re-parse with new mappings for correct categories; fall back to initial parse if profile-aware parse finds nothing
      let reParsed = await parseStatement(new Uint8Array(fileBytes), savedMappings, profile as CardProfile);
      if (reParsed.transactions.length === 0) {
        reParsed = await parseStatement(new Uint8Array(fileBytes), savedMappings);
      }

      // Check for duplicate statement
      const existingSnap = reParsed.statementDate
        ? await getDocs(
            query(
              collection(db, 'households', householdId, 'statements'),
              where('statementDate', '==', reParsed.statementDate)
            )
          )
        : null;

      if ((!existingSnap || existingSnap.empty) && reParsed.transactions.length > 0) {
        // Save statement
        const stmtRef = await addDoc(collection(db, 'households', householdId, 'statements'), {
          filename: 'onboarding-statement.pdf',
          statementDate: reParsed.statementDate,
          periodStart: reParsed.periodStart,
          periodEnd: reParsed.periodEnd,
          totalBalance: reParsed.totalBalance,
          uploadedAt: Timestamp.now(),
        });

        // Save transactions in batches of 500
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
            });
          }
          await batch.commit();
        }
      }

      hasPersistedMappingRef.current = true;
      setSavedCount(count);
      setSavedBank(profile.bankName);
      setStep('done');
    } catch (err) {
      console.error('Onboarding mapping error:', err);
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
      setStep('upload');
    }
  }, [householdId, cardLabel]);

  const switchGoogleAccount = async () => {
    setError('');
    try {
      await signOut(auth);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not sign out');
    }
  };

  const proceedToUpload = () => {
    if (!cardLabel.trim()) {
      setError('Give your card a name');
      return;
    }
    setError('');
    setStep('upload');
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'application/pdf': ['.pdf'] },
    maxFiles: 1,
    disabled: step !== 'upload',
  });

  return (
    <div className="login-container">
      <ThemeToggleButton />
      <div className="household-layout">
        <div
          className={`household-card onboarding-mapping-card${step === 'done' ? ' onboarding-mapping-card--done' : ''}`}
        >
          <div className="household-card-body">
            <div className="household-card-header">
              <button
                type="button"
                className="onboarding-logo-btn"
                onClick={() => setLogoRedBadge((v) => !v)}
                aria-pressed={logoRedBadge}
                aria-label={logoRedBadge ? 'Show green wordmark logo' : 'Show red wordmark logo'}
              >
                <div className="household-logo-wrap">
                  <img
                    src={logoRedBadge ? stevieLogoRedBadge : stevieLogoWithText}
                    alt=""
                    className="household-brand-logo"
                    width={256}
                    height={256}
                  />
                </div>
              </button>
              <h1 className="household-title">
                {step === 'done' ? 'All Set!' : 'Set Up Your Card'}
              </h1>
            </div>

            {step === 'label' && (
              <>
                <p className="login-subtitle household-subtitle">
                  Add a name for your credit card
                </p>
                <input
                  type="text"
                  className="household-input"
                  placeholder="e.g. BMO Mastercard"
                  value={cardLabel}
                  onChange={(e) => setCardLabel(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && proceedToUpload()}
                  autoFocus
                />
                {error && <p className="login-error household-inline-error">{error}</p>}
                <div className="household-actions household-actions--single-primary">
                  <button type="button" className="btn btn-save" onClick={proceedToUpload}>
                    Add
                  </button>
                </div>
              </>
            )}

            {step === 'upload' && (
              <>
                <p className="login-subtitle household-subtitle">
                  Upload a statement for{' '}
                  {cardLabel.trim() ? <strong>{cardLabel}</strong> : 'this card'} and we&apos;ll automatically
                  set up your merchant categories and card format. This only happens once per card.
                </p>
                <div
                  {...getRootProps()}
                  className={`dropzone onboarding-dropzone ${isDragActive ? 'active' : ''}`}
                >
                  <input {...getInputProps()} />
                  <div className="dropzone-content">
                    <div className="dropzone-icon">
                      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                        <polyline points="17 8 12 3 7 8" />
                        <line x1="12" y1="3" x2="12" y2="15" />
                      </svg>
                    </div>
                    <p>{isDragActive ? 'Drop the PDF here...' : 'Drag & drop a credit card statement PDF'}</p>
                  </div>
                </div>
                {error && <p className="login-error household-inline-error">{error}</p>}
              </>
            )}

            {step === 'processing' && (
              <div className="onboarding-processing">
                <div className="upload-spinner" />
                <p>Analyzing your statement...</p>
                <p className="hint">Setting up card format and merchant categories. This only happens once per card.</p>
              </div>
            )}

            {step === 'saving' && (
              <div className="onboarding-processing">
                <div className="upload-spinner" />
                <p>Saving your card profile and mappings...</p>
              </div>
            )}

            {step === 'done' && (
              <>
                <div className="onboarding-done">
                  <p>
                    {savedBank} card set up with {savedCount} merchant mappings.
                    You can adjust these anytime in the Mappings tab.
                  </p>
                </div>
                <div className="household-actions">
                  <button type="button" className="btn btn-save" onClick={onComplete}>
                    Get Started
                  </button>
                </div>
              </>
            )}

            {error &&
              (step === 'processing' || step === 'saving' || step === 'done') && (
                <p className="login-error household-inline-error">{error}</p>
              )}
          </div>

          {(step === 'label' || step === 'upload') && (
            <div className="household-card-footer">
              <button type="button" className="household-setup-account-back" onClick={() => void switchGoogleAccount()}>
                Use a different Google account
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
