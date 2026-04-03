import { useCallback, useEffect, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { collection, addDoc, getDocs, deleteDoc, doc, query, where, writeBatch, Timestamp, orderBy } from 'firebase/firestore';
import { db } from '../firebase';
import { parseStatement } from '../lib/parser';
import { reconcileBillingPeriod } from '../lib/statementPeriod';
import type { CategoryMapping } from '../lib/categorize';
import type { CardProfile } from '../types';

interface Props {
  /** Called after a successful upload with the new statement document id (for deep-linking Transactions). */
  onUploaded: (newStatementId?: string) => void;
  householdId: string;
}

interface StatementInfo {
  id: string;
  statementDate: string;
  periodStart: string;
  periodEnd: string;
  totalBalance: number;
  filename: string;
}

function formatStmtDate(dateStr: string): string {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const [, m, d] = dateStr.split('-');
  return `${months[parseInt(m, 10) - 1]} ${d}`;
}

function fmtMoney(n: number): string {
  return n.toLocaleString('en-CA', { style: 'currency', currency: 'CAD' });
}

export function Upload({ onUploaded, householdId }: Props) {
  const [status, setStatus] = useState<'idle' | 'uploading' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const [fileName, setFileName] = useState('');
  const [statements, setStatements] = useState<StatementInfo[]>([]);
  const [cardProfiles, setCardProfiles] = useState<CardProfile[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState('');

  const fetchStatements = useCallback(async () => {
    const snap = await getDocs(
      query(collection(db, 'households', householdId, 'statements'), orderBy('statementDate', 'desc'))
    );
    setStatements(snap.docs.map((d) => ({ id: d.id, ...d.data() } as StatementInfo)));
  }, [householdId]);

  const fetchCardProfiles = useCallback(async () => {
    const snap = await getDocs(collection(db, 'households', householdId, 'cardProfiles'));
    const profiles = snap.docs.map((d) => ({ id: d.id, ...d.data() } as CardProfile));
    setCardProfiles(profiles);
    if (profiles.length === 1) setSelectedProfileId(profiles[0].id!);
  }, [householdId]);

  useEffect(() => {
    fetchStatements();
    fetchCardProfiles();
  }, [fetchStatements, fetchCardProfiles]);

  const onDrop = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      setStatus('uploading');
      setFileName(files[0].name);
      setMessage('');

      try {
        // Read file as Uint8Array
        const buffer = await files[0].arrayBuffer();
        const data = new Uint8Array(buffer);

        // Load household's category mappings
        const mappingsSnap = await getDocs(collection(db, 'households', householdId, 'categoryMappings'));
        const mappings: CategoryMapping[] = mappingsSnap.docs.map((doc) => doc.data() as CategoryMapping);

        // Find selected card profile (if any)
        const selectedProfile = cardProfiles.find((p) => p.id === selectedProfileId);

        // Parse the PDF using card profile for format-aware parsing
        const parsed = await parseStatement(data, mappings, selectedProfile);

        // Check for duplicate
        const existingSnap = await getDocs(
          query(
            collection(db, 'households', householdId, 'statements'),
            where('statementDate', '==', parsed.statementDate)
          )
        );
        if (!existingSnap.empty) {
          setStatus('error');
          setMessage('Statement already uploaded');
          return;
        }
        // Save statement
        const stmtRef = await addDoc(collection(db, 'households', householdId, 'statements'), {
          filename: files[0].name,
          statementDate: parsed.statementDate,
          periodStart: parsed.periodStart,
          periodEnd: parsed.periodEnd,
          totalBalance: parsed.totalBalance,
          uploadedAt: Timestamp.now(),
        });

        // Save transactions in batches of 500 (Firestore limit)
        const txnCol = collection(db, 'households', householdId, 'transactions');
        for (let i = 0; i < parsed.transactions.length; i += 500) {
          const batch = writeBatch(db);
          const chunk = parsed.transactions.slice(i, i + 500);
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

        setStatus('success');
        setMessage(`${parsed.transactions.length} transactions imported`);
        setTimeout(async () => {
          await fetchStatements();
          onUploaded(stmtRef.id);
        }, 800);
      } catch (err) {
        console.error('Parse error:', err);
        setStatus('error');
        setMessage(err instanceof Error ? err.message : 'Failed to parse statement');
      }
    },
    [onUploaded, householdId, fetchStatements]
  );

  const deleteStatement = async (id: string) => {
    if (!confirm('Delete this statement and all its transactions?')) return;
    const txnSnap = await getDocs(
      query(collection(db, 'households', householdId, 'transactions'), where('statementId', '==', id))
    );
    const deletePromises = txnSnap.docs.map((d) => deleteDoc(d.ref));
    await Promise.all(deletePromises);
    await deleteDoc(doc(db, 'households', householdId, 'statements', id));
    await fetchStatements();
    onUploaded();
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'application/pdf': ['.pdf'] },
    maxFiles: 1,
    disabled: status === 'uploading',
  });

  return (
    <div className="upload-page">
      <h2>Upload Statement</h2>
      <p className="upload-hint">Upload a credit card statement PDF</p>

      {cardProfiles.length > 1 && (
        <div className="card-profile-select">
          <label htmlFor="card-select">Card: </label>
          <select
            id="card-select"
            value={selectedProfileId}
            onChange={(e) => setSelectedProfileId(e.target.value)}
          >
            <option value="">Select a card...</option>
            {cardProfiles.map((p) => (
              <option key={p.id} value={p.id!}>
                {p.cardLabel} ({p.bankName})
              </option>
            ))}
          </select>
        </div>
      )}

      <div
        {...getRootProps()}
        className={`dropzone ${isDragActive ? 'active' : ''} ${status}`}
      >
        <input {...getInputProps()} />

        {status === 'idle' && (
          <div className="dropzone-content">
            <div className="dropzone-icon">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
            </div>
            <p>{isDragActive ? 'Drop the PDF here...' : 'Drag & drop a PDF here, or click to select'}</p>
          </div>
        )}

        {status === 'uploading' && (
          <div className="dropzone-content">
            <div className="upload-spinner" />
            <p className="upload-filename">{fileName}</p>
            <p>Parsing and categorizing transactions...</p>
          </div>
        )}

        {status === 'success' && (
          <div className="dropzone-content">
            <div className="upload-check">
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <p>{message}</p>
          </div>
        )}

        {status === 'error' && (
          <div className="dropzone-content">
            <p className="error-text">{message}</p>
            <p className="upload-retry">Click or drop to try again</p>
          </div>
        )}
      </div>

      <div className="statements-list">
        <h3>Upload History</h3>
        {statements.length === 0 ? (
          <p className="empty-state">No statements uploaded yet.</p>
        ) : (
          <table className="statements-table">
            <thead>
              <tr><th>Date</th><th>Period</th><th>Balance</th><th>File</th><th></th></tr>
            </thead>
            <tbody>
              {statements.map((s) => {
                const r = reconcileBillingPeriod(s.periodStart, s.periodEnd);
                return (
                  <tr key={s.id}>
                    <td>{formatStmtDate(s.statementDate)}</td>
                    <td>{r.periodStart} to {r.periodEnd}</td>
                    <td>{fmtMoney(s.totalBalance)}</td>
                    <td>{s.filename}</td>
                    <td><button className="btn btn-xs btn-danger" onClick={() => deleteStatement(s.id)}>Delete</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
