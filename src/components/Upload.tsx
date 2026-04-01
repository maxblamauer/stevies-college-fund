import { useCallback, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { collection, addDoc, getDocs, doc, query, where, writeBatch, Timestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { parseStatement } from '../lib/parser';
import type { CategoryMapping } from '../lib/categorize';

interface Props {
  onUploaded: () => void;
  householdId: string;
}

export function Upload({ onUploaded, householdId }: Props) {
  const [status, setStatus] = useState<'idle' | 'uploading' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const [fileName, setFileName] = useState('');

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

        // Parse the PDF
        const parsed = await parseStatement(data, mappings);

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
        setTimeout(onUploaded, 800);
      } catch (err) {
        console.error('Parse error:', err);
        setStatus('error');
        setMessage(err instanceof Error ? err.message : 'Failed to parse statement');
      }
    },
    [onUploaded, householdId]
  );

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
    </div>
  );
}
