import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { collection, addDoc, getDocs, deleteDoc, doc, query, where, writeBatch, Timestamp, orderBy } from 'firebase/firestore';
import { db } from '../firebase';
import { parseStatement } from '../lib/parser';
import type { CategoryMapping } from '../lib/categorize';
import { reconcileBillingPeriod } from '../lib/statementPeriod';
import { Modal, ModalBodyPanel } from './ui/Modal';
import type { CardProfile } from '../types';

interface Props {
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
  cardProfileId?: string;
  status?: string;
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
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [expandedUploadGroups, setExpandedUploadGroups] = useState<Set<string>>(new Set());
  const [uploadModalCardId, setUploadModalCardId] = useState<string | null>(null);
  const uploadAccordionInitForHouseholdRef = useRef<string | null>(null);

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

  useEffect(() => {
    uploadAccordionInitForHouseholdRef.current = null;
    setExpandedUploadGroups(new Set());
  }, [householdId]);

  useEffect(() => {
    if (cardProfiles.length === 0) return;
    if (uploadAccordionInitForHouseholdRef.current !== householdId) {
      uploadAccordionInitForHouseholdRef.current = householdId;
      const next = new Set<string>(cardProfiles.map((p) => p.id!).filter(Boolean));
      if (statements.some((s) => !s.cardProfileId)) next.add('__general__');
      setExpandedUploadGroups(next);
      return;
    }
    setExpandedUploadGroups((prev) => {
      let changed = false;
      const next = new Set(prev);
      for (const p of cardProfiles) {
        if (p.id && !next.has(p.id)) { next.add(p.id); changed = true; }
      }
      if (statements.some((s) => !s.cardProfileId) && !next.has('__general__')) {
        next.add('__general__'); changed = true;
      }
      return changed ? next : prev;
    });
  }, [householdId, cardProfiles, statements]);

  const onDrop = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      setStatus('uploading');
      setFileName(files[0].name);
      setMessage('');

      try {
        const buffer = await files[0].arrayBuffer();
        const data = new Uint8Array(buffer);

        const mappingsSnap = await getDocs(collection(db, 'households', householdId, 'categoryMappings'));
        const mappings: CategoryMapping[] = mappingsSnap.docs.map((doc) => doc.data() as CategoryMapping);
        const selectedProfile = cardProfiles.find((p) => p.id === selectedProfileId);
        const parsed = await parseStatement(data, mappings, selectedProfile);

        // Check for duplicate finalized statement
        const existingSnap = await getDocs(
          query(collection(db, 'households', householdId, 'statements'), where('statementDate', '==', parsed.statementDate))
        );
        const existingFinalized = existingSnap.docs.filter((d) => d.data().status !== 'in-progress');
        if (existingFinalized.length > 0) {
          setStatus('error');
          setMessage('Statement already uploaded');
          return;
        }

        // Reconcile any in-progress statements for this period
        const allInProgressSnap = await getDocs(
          query(collection(db, 'households', householdId, 'statements'), where('status', '==', 'in-progress'))
        );
        const overlapping = allInProgressSnap.docs.filter((d) => {
          const data = d.data();
          if (selectedProfileId && data.cardProfileId !== selectedProfileId) return false;
          if (!selectedProfileId && data.cardProfileId) return false;
          const ipStart = data.periodStart;
          const ipEnd = data.periodEnd;
          if (!ipStart || !ipEnd) return false;
          return ipStart <= parsed.periodEnd && ipEnd >= parsed.periodStart;
        });

        let reconciledCount = 0;
        const inProgressIds = new Set([
          ...existingSnap.docs.filter((d) => d.data().status === 'in-progress').map((d) => d.id),
          ...overlapping.map((d) => d.id),
        ]);

        if (inProgressIds.size > 0) {
          const allTxnSnap = await getDocs(collection(db, 'households', householdId, 'transactions'));
          const inProgressTxns = allTxnSnap.docs.filter((d) => inProgressIds.has(d.data().statementId));
          reconciledCount = inProgressTxns.length;
          for (const txnDoc of inProgressTxns) await deleteDoc(txnDoc.ref);
          for (const stmtId of inProgressIds) await deleteDoc(doc(db, 'households', householdId, 'statements', stmtId));
        }

        const stmtRef = await addDoc(collection(db, 'households', householdId, 'statements'), {
          filename: files[0].name,
          statementDate: parsed.statementDate,
          periodStart: parsed.periodStart,
          periodEnd: parsed.periodEnd,
          totalBalance: parsed.totalBalance,
          uploadedAt: Timestamp.now(),
          status: 'finalized',
          ...(selectedProfileId ? { cardProfileId: selectedProfileId } : {}),
        });

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
              source: 'pdf',
              ...(selectedProfileId ? { cardProfileId: selectedProfileId } : {}),
            });
          }
          await batch.commit();
        }

        setStatus('success');
        const reconMsg = reconciledCount > 0 ? ` (reconciled ${reconciledCount} in-progress transactions)` : '';
        setMessage(`${parsed.transactions.length} transactions imported${reconMsg}`);
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
    [onUploaded, householdId, fetchStatements, selectedProfileId, cardProfiles]
  );

  const deleteDetailLine = useMemo(() => {
    if (!deleteTargetId) return '';
    const s = statements.find((x) => x.id === deleteTargetId);
    if (!s) return 'This statement and all of its transactions will be permanently removed.';
    const r = reconcileBillingPeriod(s.periodStart, s.periodEnd);
    return `"${s.filename}" (${formatStmtDate(s.statementDate)} · ${r.periodStart} to ${r.periodEnd}) and all of its transactions will be permanently removed.`;
  }, [deleteTargetId, statements]);

  const confirmDeleteStatement = async () => {
    if (!deleteTargetId) return;
    setDeleteBusy(true);
    try {
      const id = deleteTargetId;
      const txnSnap = await getDocs(
        query(collection(db, 'households', householdId, 'transactions'), where('statementId', '==', id))
      );
      await Promise.all(txnSnap.docs.map((d) => deleteDoc(d.ref)));
      await deleteDoc(doc(db, 'households', householdId, 'statements', id));
      setDeleteTargetId(null);
      await fetchStatements();
      onUploaded();
    } catch (err) {
      console.error('Delete statement error:', err);
    } finally {
      setDeleteBusy(false);
    }
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'application/pdf': ['.pdf'] },
    maxFiles: 1,
    disabled: status === 'uploading',
  });

  const uploadModalCard = uploadModalCardId ? cardProfiles.find((p) => p.id === uploadModalCardId) : null;

  const openUploadModal = (profileId: string) => {
    setSelectedProfileId(profileId);
    setUploadModalCardId(profileId);
    setStatus('idle');
    setMessage('');
  };

  const closeUploadModal = () => {
    if (status === 'uploading') return;
    setUploadModalCardId(null);
  };

  return (
    <div className="upload-page">
      <h2>Statements</h2>

      {cardProfiles.length === 0 ? (
        <p className="empty-state">No cards set up yet. Add a card from the Settings tab to start uploading statements.</p>
      ) : (
        (() => {
          const byCard = new Map<string, StatementInfo[]>();
          const ungrouped: StatementInfo[] = [];
          for (const s of statements) {
            if (s.cardProfileId) {
              if (!byCard.has(s.cardProfileId)) byCard.set(s.cardProfileId, []);
              byCard.get(s.cardProfileId)!.push(s);
            } else {
              ungrouped.push(s);
            }
          }

          const toggleGroup = (key: string) => {
            setExpandedUploadGroups((prev) => {
              const next = new Set(prev);
              if (next.has(key)) next.delete(key); else next.add(key);
              return next;
            });
          };

          return (
            <>
              {cardProfiles.map((profile) => {
                const stmts = byCard.get(profile.id!) || [];
                const isExpanded = expandedUploadGroups.has(profile.id!);
                return (
                  <div key={profile.id} className="mappings-card-group">
                    <button
                      type="button"
                      className="mappings-card-group-header"
                      onClick={() => toggleGroup(profile.id!)}
                      aria-expanded={isExpanded}
                    >
                      <span className="mappings-card-group-chevron" data-expanded={isExpanded}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="9 6 15 12 9 18" />
                        </svg>
                      </span>
                      <span className="mappings-card-group-label">{profile.cardLabel} ({profile.bankName})</span>
                      <span className="mappings-card-group-count">{stmts.length} statement{stmts.length !== 1 ? 's' : ''}</span>
                    </button>
                    {isExpanded && (
                      <table className="statements-table">
                        <thead>
                          <tr><th>Date</th><th>Period</th><th>Balance</th><th>File</th><th></th></tr>
                        </thead>
                        <tbody>
                          {stmts.map((s) => {
                            const r = reconcileBillingPeriod(s.periodStart, s.periodEnd);
                            return (
                              <tr key={s.id}>
                                <td className="stmt-cell-date">{formatStmtDate(s.statementDate)}</td>
                                <td className="stmt-cell-period">{r.periodStart} to {r.periodEnd}</td>
                                <td className="stmt-cell-balance">{fmtMoney(s.totalBalance)}</td>
                                <td className="stmt-cell-file">{s.filename}</td>
                                <td className="mapping-cell-actions">
                                  <button
                                    type="button"
                                    className="btn btn-xs btn-destructive"
                                    onClick={() => setDeleteTargetId(s.id)}
                                  >
                                    Remove
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                          <tr>
                            <td colSpan={5} className="table-action-row">
                              <button
                                type="button"
                                className="btn btn-xs btn-save"
                                onClick={() => openUploadModal(profile.id!)}
                              >
                                + Upload
                              </button>
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    )}
                  </div>
                );
              })}
              {ungrouped.length > 0 && (
                <div className="mappings-card-group">
                  <button
                    type="button"
                    className="mappings-card-group-header"
                    onClick={() => toggleGroup('__general__')}
                    aria-expanded={expandedUploadGroups.has('__general__')}
                  >
                    <span className="mappings-card-group-chevron" data-expanded={expandedUploadGroups.has('__general__')}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="9 6 15 12 9 18" />
                      </svg>
                    </span>
                    <span className="mappings-card-group-label">Other Statements</span>
                    <span className="mappings-card-group-count">{ungrouped.length} statement{ungrouped.length !== 1 ? 's' : ''}</span>
                  </button>
                  {expandedUploadGroups.has('__general__') && (
                    <table className="statements-table">
                      <thead>
                        <tr><th>Date</th><th>Period</th><th>Balance</th><th>File</th><th></th></tr>
                      </thead>
                      <tbody>
                        {ungrouped.map((s) => {
                          const r = reconcileBillingPeriod(s.periodStart, s.periodEnd);
                          return (
                            <tr key={s.id}>
                              <td className="stmt-cell-date">{formatStmtDate(s.statementDate)}</td>
                              <td className="stmt-cell-period">{r.periodStart} to {r.periodEnd}</td>
                              <td className="stmt-cell-balance">{fmtMoney(s.totalBalance)}</td>
                              <td className="stmt-cell-file">{s.filename}</td>
                              <td className="mapping-cell-actions">
                                <button
                                  type="button"
                                  className="btn btn-xs btn-destructive"
                                  onClick={() => setDeleteTargetId(s.id)}
                                >
                                  Remove
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </>
          );
        })()
      )}

      <Modal
        open={uploadModalCardId !== null}
        onClose={closeUploadModal}
        title={uploadModalCard ? `Upload to ${uploadModalCard.cardLabel}` : 'Upload Statement'}
        description="Drop or select a credit card statement PDF."
        closeOnBackdropClick={status !== 'uploading'}
        showCloseButton={status !== 'uploading'}
      >
        <ModalBodyPanel>
          <div
            {...getRootProps()}
            className={`dropzone upload-modal-dropzone ${isDragActive ? 'active' : ''} ${status}`}
          >
            <input {...getInputProps()} />
            {status === 'idle' && (
              <div className="dropzone-content">
                <div className="dropzone-icon">
                  <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="17 8 12 3 7 8" />
                    <line x1="12" y1="3" x2="12" y2="15" />
                  </svg>
                </div>
                <p>{isDragActive ? 'Drop the PDF here...' : 'Drag & drop a PDF, or click to select'}</p>
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
        </ModalBodyPanel>
        {status === 'success' && (
          <div className="edit-card-panel-actions">
            <button type="button" className="btn btn-save" onClick={closeUploadModal}>Done</button>
          </div>
        )}
      </Modal>

      <Modal
        open={deleteTargetId !== null}
        onClose={() => !deleteBusy && setDeleteTargetId(null)}
        title="Are you sure?"
        description="This action cannot be undone."
        closeOnBackdropClick={!deleteBusy}
        showCloseButton={!deleteBusy}
      >
        <ModalBodyPanel>
          <p className="modal-confirm-detail">{deleteDetailLine}</p>
        </ModalBodyPanel>
        <div className="edit-card-panel-actions">
          <button type="button" className="btn" disabled={deleteBusy} onClick={() => setDeleteTargetId(null)}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-destructive"
            disabled={deleteBusy}
            onClick={() => void confirmDeleteStatement()}
          >
            {deleteBusy ? 'Deleting…' : 'Remove'}
          </button>
        </div>
      </Modal>
    </div>
  );
}
