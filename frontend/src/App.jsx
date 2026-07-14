import { useCallback, useRef, useState } from 'react';
import './App.css';

const IMAGE_ACCEPT = 'image/png,image/jpeg';
const PDF_ACCEPT = 'application/pdf';

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function FileRow({ file, onRemove }) {
  return (
    <li>
      <span title={file.name}>
        {file.name}
        <span style={{ opacity: 0.6 }}> · {formatBytes(file.size)}</span>
      </span>
      <button type="button" className="link" onClick={onRemove}>
        Remove
      </button>
    </li>
  );
}

function DropPanel({
  title,
  hint,
  badge,
  accept,
  multiple,
  files,
  onAdd,
  onRemove,
  onClear,
  inputId,
}) {
  const inputRef = useRef(null);
  const [drag, setDrag] = useState(false);

  const onDrop = useCallback(
    (e) => {
      e.preventDefault();
      setDrag(false);
      const list = Array.from(e.dataTransfer?.files || []);
      onAdd(list);
    },
    [onAdd]
  );

  return (
    <section className="drop-panel">
      <header>
        <div>
          <h2>{title}</h2>
          <p className="hint">{hint}</p>
        </div>
        <span className={`badge ${badge === 'Optional' ? 'optional' : ''}`}>{badge}</span>
      </header>
      <label
        className={`dropzone ${drag ? 'drag' : ''}`}
        htmlFor={inputId}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={onDrop}
      >
        <input
          ref={inputRef}
          id={inputId}
          className="file-input"
          type="file"
          accept={accept}
          multiple={multiple}
          onChange={(e) => {
            onAdd(Array.from(e.target.files || []));
            e.target.value = '';
          }}
        />
        <strong>Click to browse or drop files</strong>
        <span>{multiple ? 'You can select multiple files.' : 'Single file.'}</span>
      </label>
      {files.length > 0 && (
        <div className="file-list">
          <ul>
            {files.map((f, i) => (
              <FileRow key={`${f.name}-${i}`} file={f} onRemove={() => onRemove(i)} />
            ))}
          </ul>
          <button type="button" className="btn btn-ghost" style={{ marginTop: '0.5rem', width: '100%' }} onClick={onClear}>
            Clear all
          </button>
        </div>
      )}
    </section>
  );
}

function ResultTable({ rows }) {
  if (!rows.length) {
    return <div className="empty-results">No rows returned. Upload images with readable text or add statement PDFs for verification.</div>;
  }

  const verified = rows[0] && 'status' in rows[0];

  if (!verified) {
    return (
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>File</th>
              <th>Date</th>
              <th>Amount</th>
              <th>Account / IBAN</th>
              <th>OCR confidence</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td className="mono">{r.fileName}</td>
                <td>{r.date}</td>
                <td className="mono">{r.amount}</td>
                <td className="mono">{r.ibanOrAccount}</td>
                <td>{r.confidence != null ? `${Number(r.confidence).toFixed(1)}%` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Status</th>
            <th>Image</th>
            <th>Notes</th>
            <th>Extracted</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td>
                <span className={`pill ${r.status === 'MISMATCH' ? 'mismatch' : 'matched'}`}>{r.status}</span>
              </td>
              <td className="mono">{r.file}</td>
              <td>
                {Array.isArray(r.errors) ? r.errors.join(' ') : r.errors || '—'}
                {r.matchedInPdf ? (
                  <div className="mono" style={{ marginTop: '0.35rem', opacity: 0.85 }}>
                    Matched in: {r.matchedInPdf}
                  </div>
                ) : null}
              </td>
              <td className="mono">
                {r.originalData ? (
                  <>
                    {r.originalData.date} · {r.originalData.amount} · {r.originalData.ibanOrAccount}
                  </>
                ) : (
                  '—'
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function App() {
  const [images, setImages] = useState([]);
  const [pdfs, setPdfs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [response, setResponse] = useState(null);

  const addImages = useCallback((incoming) => {
    const allowed = incoming.filter((f) => /image\/(png|jpeg)$/i.test(f.type) || /\.(png|jpe?g)$/i.test(f.name));
    if (allowed.length < incoming.length) {
      setError('Some files were skipped. Transaction images must be PNG or JPEG.');
    } else setError(null);
    setImages((prev) => [...prev, ...allowed]);
  }, []);

  const addPdfs = useCallback((incoming) => {
    const allowed = incoming.filter((f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name));
    if (allowed.length < incoming.length) {
      setError('Some files were skipped. Statements must be PDF.');
    } else setError(null);
    setPdfs((prev) => [...prev, ...allowed]);
  }, []);

  async function runAnalyze() {
    setError(null);
    setResponse(null); // Clear previous results immediately
    if (images.length === 0) {
      setError('Please add at least one transaction image.');
      return;
    }
    const body = new FormData();
    images.forEach((f) => body.append('transactionImages', f));
    pdfs.forEach((f) => body.append('statementPdfs', f));

    setLoading(true);
    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        body,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || data.details || `Server error: ${res.status}`);
        return;
      }
      setResponse(data);
    } catch (e) {
      setError('Could not connect to the server. Please ensure the backend is running on port 5001.');
    } finally {
      setLoading(false);
    }
  }

  function resetForm() {
    setImages([]);
    setPdfs([]);
    setResponse(null);
    setError(null);
  }

  const modeLabel =
    response?.summary?.mode === 'verified_against_statements'
      ? 'OCR + statement verification'
      : 'OCR only (no statement PDFs uploaded)';

  return (
    <div className="app">
      <header className="app-header">
        <h1>Transactions Analyzer</h1>
        <p>
          Upload transaction screenshots for OCR extraction. Optionally add bank statement PDFs to flag rows that do not
          appear consistently in those statements.
        </p>
      </header>

      <div className="panels">
        <DropPanel
          title="Transaction images"
          hint="PNG or JPEG screenshots or photos of transactions."
          badge="Required"
          accept={IMAGE_ACCEPT}
          multiple
          files={images}
          onAdd={addImages}
          onRemove={(i) => setImages((p) => p.filter((_, idx) => idx !== i))}
          onClear={() => setImages([])}
          inputId="tx-images"
        />
        <DropPanel
          title="Statement PDFs"
          hint="One or more PDF statements used to cross-check extracted amounts, dates, and accounts."
          badge="Optional"
          accept={PDF_ACCEPT}
          multiple
          files={pdfs}
          onAdd={addPdfs}
          onRemove={(i) => setPdfs((p) => p.filter((_, idx) => idx !== i))}
          onClear={() => setPdfs([])}
          inputId="stmt-pdfs"
        />
      </div>

      <div className="actions">
        <button type="button" className="btn btn-primary" disabled={loading || images.length === 0} onClick={runAnalyze}>
          {loading ? (
            <>
              <span className="spinner" aria-hidden />
              Analyzing…
            </>
          ) : (
            'Run analysis'
          )}
        </button>
        <button type="button" className="btn btn-ghost" disabled={loading} onClick={resetForm}>
          Reset form
        </button>
        <span className="status-line">
          {images.length} image{images.length !== 1 ? 's' : ''} · {pdfs.length} PDF{pdfs.length !== 1 ? 's' : ''}
        </span>
      </div>

      {error && (
        <div className="alert error" role="alert">
          {error}
        </div>
      )}

      {response?.success && (
        <div className="alert success">
          <strong>Analysis complete.</strong> {modeLabel}.
          <div className="summary-grid">
            <div className="summary-item">
              <div className="label">Images sent</div>
              <div className="value">{response.summary?.transactionImagesUploaded}</div>
            </div>
            <div className="summary-item">
              <div className="label">PDFs sent</div>
              <div className="value">{response.summary?.statementPdfsUploaded}</div>
            </div>
            <div className="summary-item">
              <div className="label">Result rows</div>
              <div className="value">{response.summary?.resultRows}</div>
            </div>
          </div>
        </div>
      )}

      {response?.success && (
        <section className="results" aria-live="polite">
          <h2>Results</h2>
          <ResultTable rows={response.results || []} />
        </section>
      )}
    </div>
  );
}
