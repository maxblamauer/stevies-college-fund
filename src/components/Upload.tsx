import { useCallback, useState } from 'react';
import { useDropzone } from 'react-dropzone';

const API = '/api';

interface Props {
  onUploaded: () => void;
}

export function Upload({ onUploaded }: Props) {
  const [status, setStatus] = useState<'idle' | 'uploading' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const [fileName, setFileName] = useState('');

  const onDrop = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      setStatus('uploading');
      setFileName(files[0].name);
      setMessage('');

      const formData = new FormData();
      formData.append('file', files[0]);

      try {
        const res = await fetch(`${API}/statements/upload`, {
          method: 'POST',
          body: formData,
        });
        const data = await res.json();

        if (!res.ok) {
          setStatus('error');
          setMessage(data.error || 'Upload failed');
          return;
        }

        setStatus('success');
        setMessage(`${data.transactionCount} transactions imported`);
        setTimeout(onUploaded, 800);
      } catch {
        setStatus('error');
        setMessage('Failed to connect to server');
      }
    },
    [onUploaded]
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
      <p className="upload-hint">Upload a BMO credit card statement PDF</p>

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
