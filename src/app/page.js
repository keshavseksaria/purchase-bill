'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

const APP_PIN = process.env.NEXT_PUBLIC_APP_PIN || '1234';

// ─────────────────────────────────────────
// Main App
// ─────────────────────────────────────────
export default function App() {
  const [authed, setAuthed] = useState(false);
  const [view, setView] = useState('entries'); // entries | upload | detail
  const [selectedEntryId, setSelectedEntryId] = useState(null);
  const [toasts, setToasts] = useState([]);

  useEffect(() => {
    if (typeof window !== 'undefined' && sessionStorage.getItem('billsync_auth') === '1') {
      setAuthed(true);
    }
  }, []);

  const addToast = useCallback((message, type = 'info') => {
    const id = Date.now();
    setToasts(t => [...t, { id, message, type }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 4000);
  }, []);

  const navigate = useCallback((view, entryId = null) => {
    setView(view);
    setSelectedEntryId(entryId);
    window.scrollTo(0, 0);
  }, []);

  if (!authed) {
    return <PinGate onSuccess={() => { setAuthed(true); sessionStorage.setItem('billsync_auth', '1'); }} />;
  }

  return (
    <div className="app-shell">
      <Navbar onNavigate={navigate} currentView={view} />
      <main className="main-content">
        {view === 'upload' && (
          <UploadPage addToast={addToast} onDone={(id) => navigate('detail', id)} />
        )}
        {view === 'entries' && (
          <EntriesPage addToast={addToast} onSelect={(id) => navigate('detail', id)} />
        )}
        {view === 'detail' && selectedEntryId && (
          <EntryDetailPage entryId={selectedEntryId} addToast={addToast} onBack={() => navigate('entries')} />
        )}
      </main>
      <div className="toast-container">
        {toasts.map(t => (
          <div key={t.id} className={`toast toast-${t.type}`}>{t.message}</div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────
// PIN Gate
// ─────────────────────────────────────────
function PinGate({ onSuccess }) {
  const [digits, setDigits] = useState(['', '', '', '']);
  const [error, setError] = useState('');
  const refs = [useRef(), useRef(), useRef(), useRef()];

  const handleChange = (idx, val) => {
    if (val.length > 1) val = val.slice(-1);
    if (val && !/^\d$/.test(val)) return;
    const next = [...digits];
    next[idx] = val;
    setDigits(next);
    setError('');

    if (val && idx < 3) refs[idx + 1].current?.focus();
    if (next.every(d => d !== '')) {
      const pin = next.join('');
      if (pin === APP_PIN) {
        onSuccess();
      } else {
        setError('Incorrect PIN');
        setTimeout(() => { setDigits(['', '', '', '']); refs[0].current?.focus(); }, 600);
      }
    }
  };

  const handleKeyDown = (idx, e) => {
    if (e.key === 'Backspace' && !digits[idx] && idx > 0) {
      refs[idx - 1].current?.focus();
    }
  };

  useEffect(() => { refs[0].current?.focus(); }, []);

  return (
    <div className="pin-gate">
      <h1>📄 BillSync</h1>
      <p>Enter PIN to continue</p>
      <div className="pin-input-group">
        {digits.map((d, i) => (
          <input
            key={i}
            ref={refs[i]}
            className="pin-digit"
            type="tel"
            inputMode="numeric"
            maxLength={1}
            value={d}
            onChange={e => handleChange(i, e.target.value)}
            onKeyDown={e => handleKeyDown(i, e)}
            autoComplete="off"
          />
        ))}
      </div>
      {error && <p className="pin-error">{error}</p>}
    </div>
  );
}

// ─────────────────────────────────────────
// Navbar
// ─────────────────────────────────────────
function Navbar({ onNavigate, currentView }) {
  return (
    <nav className="navbar">
      <div className="navbar-brand" onClick={() => onNavigate('entries')} style={{ cursor: 'pointer' }}>
        📄 <span>BillSync</span>
      </div>
      <div className="navbar-actions">
        <button
          className={`btn btn-sm ${currentView === 'entries' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => onNavigate('entries')}
        >
          📋 Entries
        </button>
        <button
          className={`btn btn-sm ${currentView === 'upload' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => onNavigate('upload')}
        >
          📸 Upload
        </button>
      </div>
    </nav>
  );
}

// ─────────────────────────────────────────
// Upload Page
// ─────────────────────────────────────────
function UploadPage({ addToast, onDone }) {
  const [files, setFiles] = useState([]);
  const [previews, setPreviews] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const galleryRef = useRef();
  const cameraRef = useRef();

  const handleFiles = (newFiles) => {
    const imageFiles = Array.from(newFiles).filter(f => f.type.startsWith('image/'));
    if (imageFiles.length === 0) return;
    setFiles(prev => [...prev, ...imageFiles]);
    imageFiles.forEach(file => {
      const reader = new FileReader();
      reader.onload = e => setPreviews(prev => [...prev, { file, url: e.target.result }]);
      reader.readAsDataURL(file);
    });
  };

  const removeFile = (idx) => {
    setFiles(prev => prev.filter((_, i) => i !== idx));
    setPreviews(prev => prev.filter((_, i) => i !== idx));
  };

  const uploadAll = async () => {
    if (files.length === 0 || uploading) return;
    setUploading(true);

    try {
      addToast(`Uploading ${files.length} bill${files.length > 1 ? 's' : ''}...`, 'info');
      
      // Upload all files in parallel (fast)
      const uploadPromises = files.map(async (file, i) => {
        const formData = new FormData();
        formData.append('file', file);
        const res = await fetch('/api/entries', { method: 'POST', body: formData });
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || `Bill ${i + 1} upload failed`);
        }
        return res.json();
      });

      await Promise.all(uploadPromises);
      addToast(`Bills uploaded! AI processing started in background.`, 'success');
      
      // Navigate to entries list immediately so they don't have to wait
      onDone(null);
    } catch (err) {
      addToast(`Upload failed: ${err.message}`, 'error');
      setUploading(false);
    }
  };

  return (
    <div className="upload-container">
      <h1 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Upload Purchase Bills</h1>
      <p style={{ color: 'var(--text-secondary)' }}>Choose how you want to add your bills.</p>

      <div style={{ display: 'flex', gap: 16, marginBottom: 30 }}>
        <button className="btn btn-primary" style={{ flex: 1, padding: '20px 0', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }} onClick={() => cameraRef.current?.click()}>
          <span style={{ fontSize: '2rem' }}>📷</span>
          <span>Take Photo</span>
        </button>
        <button className="btn btn-secondary" style={{ flex: 1, padding: '20px 0', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }} onClick={() => galleryRef.current?.click()}>
          <span style={{ fontSize: '2rem' }}>🖼️</span>
          <span>From Gallery</span>
        </button>
      </div>

      <div
        className={`upload-zone ${dragOver ? 'drag-over' : ''}`}
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={e => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files); }}
      >
        <p>Drag & drop images here</p>
        <input
          ref={galleryRef}
          type="file"
          accept="image/*"
          multiple
          onChange={e => handleFiles(e.target.files)}
          style={{ display: 'none' }}
        />
        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={e => handleFiles(e.target.files)}
          style={{ display: 'none' }}
        />
      </div>

      {previews.length > 0 && (
        <>
          <div className="upload-preview-grid">
            {previews.map((p, i) => (
              <div key={i} className="upload-preview-card">
                <img src={p.url} alt={`Bill ${i + 1}`} />
                <button className="upload-preview-remove" onClick={(e) => { e.stopPropagation(); removeFile(i); }}>✕</button>
              </div>
            ))}
          </div>
          <button
            className="btn btn-primary btn-lg"
            onClick={uploadAll}
            disabled={uploading}
            style={{ width: '100%' }}
          >
            {uploading ? (
              <><span className="spinner" /> Processing...</>
            ) : (
              `📤 Upload & Process ${files.length} Bill${files.length > 1 ? 's' : ''}`
            )}
          </button>
        </>
      )}

      {uploading && (
        <div style={{ marginTop: 20, textAlign: 'center', color: 'var(--text-secondary)' }}>
          <div className="spinner" style={{ marginBottom: 10 }} />
          <p>Uploading to server...</p>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────
// Entries List
// ─────────────────────────────────────────
function EntriesPage({ addToast, onSelect }) {
  const [entries, setEntries] = useState([]);
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);

  const fetchEntries = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/entries?status=${filter}`);
      const data = await res.json();
      setEntries(Array.isArray(data) ? data : []);
    } catch (err) {
      addToast('Failed to load entries', 'error');
    }
    setLoading(false);
  }, [filter, addToast]);

  useEffect(() => { fetchEntries(); }, [fetchEntries]);

  const filters = [
    { key: 'all', label: 'All' },
    { key: 'pending', label: `Pending` },
    { key: 'approved', label: `Approved` },
    { key: 'synced', label: `Synced` },
    { key: 'failed', label: `Failed` },
  ];

  return (
    <div>
      <div className="entries-header">
        <h1>Purchase Entries</h1>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <button className="btn btn-secondary btn-sm" onClick={fetchEntries}>
            🔄 Refresh
          </button>
        </div>
      </div>

      <div className="filter-tabs" style={{ marginBottom: 20 }}>
        {filters.map(f => (
          <button
            key={f.key}
            className={`filter-tab ${filter === f.key ? 'active' : ''}`}
            onClick={() => setFilter(f.key)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="empty-state">
          <div className="spinner spinner-lg" />
          <p style={{ marginTop: 16 }}>Loading entries...</p>
        </div>
      ) : entries.length === 0 ? (
        <div className="empty-state">
          <div className="icon">📋</div>
          <h3>No entries yet</h3>
          <p>Upload your first purchase bill to get started</p>
        </div>
      ) : (
        <div className="entries-grid">
          {entries.map(entry => (
            <div key={entry.id} className="card entry-card" onClick={() => onSelect(entry.id)}>
              <div className="card-body">
                <div className="entry-info">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <h3 style={{ color: (entry.status === 'pending' && !entry.party_name) ? 'var(--text-muted)' : 'inherit', fontSize: '1.1rem' }}>
                      {entry.party_name || entry.party_name_raw || 'Processing...'}
                    </h3>
                    <div className="entry-amount" style={{ margin: 0 }}>
                      {entry.total > 0 ? `₹${Number(entry.total).toLocaleString('en-IN')}` : '—'}
                    </div>
                  </div>
                  
                  <div className="entry-meta" style={{ marginTop: 4 }}>
                    <span>{entry.date || '—'}</span>
                    <span>{entry.supplier_invoice_no || ''}</span>
                  </div>
                  
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span className={`status-badge status-${entry.status}`}>
                        {entry.status === 'pending' && (!entry.party_name || entry.party_name === 'Processing...') ? '⏳ processing' : (
                          <>
                            {entry.status === 'pending' && '⏳'}
                            {entry.status === 'approved' && '✓'}
                            {entry.status === 'synced' && '✅'}
                            {entry.status === 'failed' && '❌'}
                            {' '}{entry.status}
                          </>
                        )}
                      </span>
                      {(entry.status === 'failed' || (entry.status === 'pending' && entry.party_name === 'Processing...')) && (
                        <button 
                          className="btn btn-secondary btn-sm"
                          style={{ padding: '2px 8px', fontSize: '0.65rem' }}
                          onClick={(e) => {
                            e.stopPropagation();
                            fetch(`/api/entries/${entry.id}/process`, { method: 'POST' });
                            addToast('Retrying processing...', 'info');
                          }}
                        >
                          🔄 Retry
                        </button>
                      )}
                    </div>
                    {entry.status === 'pending' && (!entry.party_name || entry.party_name === 'Processing...') && (
                       <span className="spinner spinner-sm" />
                    )}
                  </div>
                  {entry.error_message && (
                    <div style={{ marginTop: 10, padding: 8, background: 'var(--status-failed-bg)', color: 'var(--status-failed)', borderRadius: 4, fontSize: '0.75rem', whiteSpace: 'pre-wrap' }}>
                      <strong>Error:</strong> {entry.error_message}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────
// Entry Detail
// ─────────────────────────────────────────
function EntryDetailPage({ entryId, addToast, onBack }) {
  const [entry, setEntry] = useState(null);
  const [items, setItems] = useState([]);
  const [masterData, setMasterData] = useState({ ledgers: [], stockItems: [] });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [photoZoom, setPhotoZoom] = useState(false);
  const [masterDiscount, setMasterDiscount] = useState('');
  const [selectedIndices, setSelectedIndices] = useState([]);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const [entryRes, masterRes] = await Promise.all([
          fetch(`/api/entries/${entryId}`),
          fetch('/api/master-data'),
        ]);
        const entryData = await entryRes.json();
        const masterDataResp = await masterRes.json();
        
        // Use recalculateTaxes to ensure the total is correct on first load
        const initialItems = entryData.items || [];
        const calculatedEntry = recalculateTaxes(initialItems, entryData.entry);
        
        setEntry(calculatedEntry);
        setItems(initialItems);
        setMasterData(masterDataResp);
      } catch (err) {
        addToast('Failed to load entry', 'error');
      }
      setLoading(false);
    };
    load();
  }, [entryId, addToast]);

  const recalculateTaxes = (currentItems, currentEntry) => {
    const itemsTotal = currentItems.reduce((sum, i) => sum + (parseFloat(i.amount) || 0), 0);
    
    let cgst = parseFloat(currentEntry.cgst) || 0;
    let sgst = parseFloat(currentEntry.sgst) || 0;
    let igst = parseFloat(currentEntry.igst) || 0;

    // Only update GST if it was already present on the bill (or manually entered)
    if (igst > 0) {
      igst = Number((itemsTotal * 0.05).toFixed(2));
    } else if (cgst > 0 || sgst > 0) {
      cgst = Number((itemsTotal * 0.025).toFixed(2));
      sgst = Number((itemsTotal * 0.025).toFixed(2));
    }
    
    const subtotal = itemsTotal + cgst + sgst + igst;
    const rounded = Math.round(subtotal);
    const roundOff = Number((rounded - subtotal).toFixed(2));
    
    return {
      ...currentEntry,
      cgst,
      sgst,
      igst,
      round_off: roundOff,
      total: rounded
    };
  };

  const updateField = (field, value) => {
    setEntry(prev => {
      const next = { ...prev, [field]: value };
      // If manually changing tax or roundoff, we need to update the total
      if (field === 'cgst' || field === 'sgst' || field === 'igst' || field === 'round_off') {
        const itemsTotal = items.reduce((sum, i) => sum + (parseFloat(i.amount) || 0), 0);
        const subtotal = itemsTotal + 
          (parseFloat(field === 'cgst' ? value : next.cgst) || 0) +
          (parseFloat(field === 'sgst' ? value : next.sgst) || 0) +
          (parseFloat(field === 'igst' ? value : next.igst) || 0);
        const round = parseFloat(field === 'round_off' ? value : next.round_off) || 0;
        next.total = Number((subtotal + round).toFixed(2));
      }
      return next;
    });
  };

  const updateItem = (idx, field, value) => {
    setItems(prev => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: value };
      
      // Auto-calculate amount when qty, rate, or discount changes
      if (field === 'actual_qty' || field === 'rate' || field === 'discount') {
        const qty = parseFloat(next[idx].actual_qty) || 0;
        const rate = parseFloat(next[idx].rate) || 0;
        const discountPercent = parseFloat(next[idx].discount) || 0;
        const subtotal = qty * rate;
        next[idx].amount = subtotal - (subtotal * (discountPercent / 100));
      }
      
      setEntry(e => recalculateTaxes(next, e));
      return next;
    });
  };

  const handleMasterDiscountChange = (val) => {
    setMasterDiscount(val);
    const discountPercent = parseFloat(val) || 0;
    setItems(prev => {
      const next = prev.map(item => {
        const qty = parseFloat(item.actual_qty) || 0;
        const rate = parseFloat(item.rate) || 0;
        const subtotal = qty * rate;
        const currentDiscount = val === '' ? 0 : discountPercent;
        return {
          ...item,
          discount: currentDiscount,
          amount: subtotal - (subtotal * (currentDiscount / 100))
        };
      });
      setEntry(e => recalculateTaxes(next, e));
      return next;
    });
  };

  const handleBulkItemName = (itemName) => {
    if (!itemName) return;
    setItems(prev => {
      const next = [...prev];
      const targetIndices = selectedIndices.length > 0 
        ? selectedIndices 
        : Array.from({ length: prev.length }, (_, i) => i);
        
      targetIndices.forEach(idx => {
        next[idx].name_of_item = itemName;
      });
      return next;
    });
    addToast(`Updated ${selectedIndices.length > 0 ? selectedIndices.length : 'all'} items`, 'success');
  };

  const handleBulkBatchSequence = () => {
    if (selectedIndices.length < 2) {
      addToast('Select at least 2 items to fix sequence', 'info');
      return;
    }
    
    setItems(prev => {
      const next = [...prev];
      const sorted = [...selectedIndices].sort((a, b) => a - b);
      const firstIdx = sorted[0];
      const baseBatch = next[firstIdx].batch_no;
      
      if (!baseBatch || baseBatch.length !== 8) {
        addToast('First selected batch must be 8 digits (MMSSYYDD)', 'error');
        return prev;
      }
      
      const mm = baseBatch.slice(0, 2);
      const initialSS = parseInt(baseBatch.slice(2, 4));
      const yy = baseBatch.slice(4, 6);
      const dd = baseBatch.slice(6, 8);
      
      sorted.forEach((idx, i) => {
        const ss = String(initialSS + i).padStart(2, '0');
        next[idx].batch_no = `${mm}${ss}${yy}${dd}`;
      });
      
      return next;
    });
    addToast('Batch sequence updated!', 'success');
  };

  const toggleSelectAll = (checked) => {
    if (checked) {
      setSelectedIndices(items.map((_, i) => i));
    } else {
      setSelectedIndices([]);
    }
  };

  const toggleSelect = (idx) => {
    setSelectedIndices(prev => 
      prev.includes(idx) ? prev.filter(i => i !== idx) : [...prev, idx]
    );
  };

  const addItem = () => {
    setItems(prev => [...prev, {
      id: crypto.randomUUID(),
      bill_item_name: '',
      name_of_item: '',
      batch_no: '',
      actual_qty: 0,
      billed_qty: 0,
      rate: 0,
      discount: 0,
      amount: 0,
      unit: 'No.',
    }]);
  };

  const removeItem = (idx) => {
    setItems(prev => {
      const next = prev.filter((_, i) => i !== idx);
      setEntry(e => recalculateTaxes(next, e));
      return next;
    });
  };

  const save = async (isSilent = false) => {
    setSaving(true);
    try {
      const res = await fetch(`/api/entries/${entryId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entry, items }),
      });
      if (!res.ok) throw new Error('Save failed');
      const data = await res.json();
      setEntry(data.entry);
      setItems(data.items || []);
      if (!isSilent) addToast('Saved successfully!', 'success');
      return true;
    } catch (err) {
      addToast(`Save failed: ${err.message}`, 'error');
      return false;
    } finally {
      setSaving(false);
    }
  };

  const approve = async () => {
    const saved = await save(true); // Silent save before approval
    if (!saved) return;

    try {
      const res = await fetch(`/api/entries/${entryId}/approve`, { method: 'POST' });
      if (!res.ok) throw new Error('Approval failed');
      const data = await res.json();
      setEntry(data.entry);
      addToast('✅ Entry approved! Tally Bridge will pick it up.', 'success');
    } catch (err) {
      addToast(`Approval failed: ${err.message}`, 'error');
    }
  };

  const deleteEntry = async () => {
    if (!confirm('Delete this entry permanently?')) return;
    try {
      await fetch(`/api/entries/${entryId}`, { method: 'DELETE' });
      addToast('Entry deleted', 'info');
      onBack();
    } catch (err) {
      addToast('Delete failed', 'error');
    }
  };

  if (loading || !entry) {
    return (
      <div className="empty-state">
        <div className="spinner spinner-lg" />
        <p style={{ marginTop: 16 }}>Loading entry...</p>
      </div>
    );
  }

  return (
    <>
      <div style={{ marginBottom: 16 }}>
        <button className="btn btn-secondary btn-sm" onClick={onBack}>← Back to entries</button>
      </div>

      <div className="entry-detail">
        {/* Left: Photo */}
        <div className="entry-photo-panel">
          <div className="photo-viewer" onClick={() => setPhotoZoom(true)}>
            {entry.image_url ? (
              <img src={entry.image_url} alt="Purchase Bill" />
            ) : (
              <div className="empty-state" style={{ padding: 40 }}>
                <div className="icon">🖼️</div>
                <p>No image</p>
              </div>
            )}
          </div>
        </div>

        {/* Right: Form */}
        <div className="entry-form-panel">
          {/* Status */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span className={`status-badge status-${entry.status}`}>
              {entry.status}
            </span>
            {entry.error_message && (
              <span style={{ color: 'var(--status-failed)', fontSize: '0.8rem' }}>
                {entry.error_message}
              </span>
            )}
          </div>

          {/* Header Fields */}
          <div className="form-section">
            <div className="form-section-title">Invoice Details</div>
            <div className="form-grid">
              <div className="form-group">
                <label className="form-label">Date</label>
                <input
                  type="date"
                  className="form-input"
                  value={entry.date || ''}
                  onChange={e => updateField('date', e.target.value)}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Supplier Invoice No</label>
                <input
                  className="form-input"
                  value={entry.supplier_invoice_no || ''}
                  onChange={e => updateField('supplier_invoice_no', e.target.value)}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Supplier Invoice Date</label>
                <input
                  type="date"
                  className="form-input"
                  value={entry.supplier_invoice_date || ''}
                  onChange={e => updateField('supplier_invoice_date', e.target.value)}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Party Name</label>
                {masterData.ledgers.length > 0 ? (
                  <select
                    className="form-select"
                    value={entry.party_name || ''}
                    onChange={e => updateField('party_name', e.target.value)}
                  >
                    <option value="">— Select Vendor —</option>
                    {masterData.ledgers.map(l => (
                      <option key={l.name} value={l.name}>{l.name}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    className="form-input"
                    value={entry.party_name || ''}
                    onChange={e => updateField('party_name', e.target.value)}
                    placeholder={entry.party_name_raw || ''}
                  />
                )}
              </div>
            </div>
            {entry.party_name_raw && entry.party_name_raw !== entry.party_name && (
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 8 }}>
                Original Bill Name: &quot;{entry.party_name_raw}&quot;
              </p>
            )}
          </div>

          {/* Items */}
          <div className="form-section">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 12 }}>
              <div className="form-section-title" style={{ marginBottom: 0 }}>Items ({items.length})</div>
              
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                {selectedIndices.length > 0 && (
                  <button className="btn btn-primary btn-sm" onClick={handleBulkBatchSequence}>
                    🔢 Fix Batch Sequence ({selectedIndices.length})
                  </button>
                )}
                
                <select 
                  className="form-input" 
                  style={{ width: 200, fontSize: '0.8rem' }}
                  onChange={e => handleBulkItemName(e.target.value)}
                  value=""
                >
                  <option value="">Set {selectedIndices.length > 0 ? 'Selected' : 'All'} Item Name</option>
                  {masterData.stockItems.map(si => (
                    <option key={si.name} value={si.name}>{si.name}</option>
                  ))}
                </select>

                <div className="form-group" style={{ marginBottom: 0, width: 100 }}>
                  <input
                    className="form-input"
                    placeholder="Disc %"
                    type="number"
                    value={masterDiscount}
                    onChange={e => handleMasterDiscountChange(e.target.value)}
                  />
                </div>
              </div>
            </div>
            <div className="items-table-wrap">
              <table className="items-table">
                <thead>
                  <tr>
                    <th style={{ width: 30 }}>
                      <input 
                        type="checkbox" 
                        onChange={e => toggleSelectAll(e.target.checked)}
                        checked={selectedIndices.length === items.length && items.length > 0}
                      />
                    </th>
                    <th style={{ width: 30 }}>#</th>
                    <th className="item-name-cell">Item Name</th>
                    <th>Batch</th>
                    <th>Qty</th>
                    <th>Rate</th>
                    <th>%</th>
                    <th>Amount</th>
                    <th style={{ width: 36 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item, idx) => (
                    <tr key={item.id || idx} className={selectedIndices.includes(idx) ? 'selected-row' : ''}>
                      <td>
                        <input 
                          type="checkbox" 
                          checked={selectedIndices.includes(idx)}
                          onChange={() => toggleSelect(idx)}
                        />
                      </td>
                      <td style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>{idx + 1}</td>
                      <td className="item-name-cell">
                        {masterData.stockItems.length > 0 ? (
                          <select
                            className="form-input"
                            value={item.name_of_item || ''}
                            onChange={e => updateItem(idx, 'name_of_item', e.target.value)}
                          >
                            <option value="">— Select —</option>
                            {masterData.stockItems.map(s => (
                              <option key={s.name} value={s.name}>{s.name}</option>
                            ))}
                          </select>
                        ) : (
                          <input
                            className="form-input"
                            value={item.name_of_item || ''}
                            onChange={e => updateItem(idx, 'name_of_item', e.target.value)}
                          />
                        )}
                        {item.handwritten_code && item.handwritten_code !== item.name_of_item && (
                          <div className="bill-name" title={item.handwritten_code}>
                            Raw Code: {item.handwritten_code}
                          </div>
                        )}
                      </td>
                      <td>
                        <input
                          className="form-input"
                          value={item.batch_no || ''}
                          onChange={e => updateItem(idx, 'batch_no', e.target.value)}
                          style={{ width: 90 }}
                        />
                      </td>
                      <td>
                        <input
                          className="form-input"
                          type="number"
                          value={item.actual_qty || ''}
                          onChange={e => {
                            updateItem(idx, 'actual_qty', e.target.value);
                            updateItem(idx, 'billed_qty', e.target.value);
                          }}
                          style={{ width: 65 }}
                        />
                      </td>
                      <td>
                        <input
                          className="form-input"
                          type="number"
                          step="0.01"
                          value={item.rate || ''}
                          onChange={e => updateItem(idx, 'rate', e.target.value)}
                          style={{ width: 80 }}
                        />
                      </td>
                      <td>
                        <input
                          className="form-input"
                          type="number"
                          step="0.01"
                          value={item.discount || ''}
                          onChange={e => updateItem(idx, 'discount', e.target.value)}
                          style={{ width: 70 }}
                        />
                      </td>
                      <td style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
                        ₹{Number(item.amount || 0).toLocaleString('en-IN')}
                      </td>
                      <td>
                        <button className="item-row-remove" onClick={() => removeItem(idx)}>✕</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button className="add-item-btn" onClick={addItem}>+ Add Item</button>
          </div>

          {/* Totals */}
          <div className="form-section">
            <div className="form-section-title">Totals</div>
            <div className="totals-grid">
              <div className="form-group">
                <label className="form-label">CGST (2.5%)</label>
                <input
                  className="form-input"
                  type="number"
                  step="0.01"
                  value={entry.cgst || ''}
                  onChange={e => updateField('cgst', e.target.value)}
                />
              </div>
              <div className="form-group">
                <label className="form-label">SGST (2.5%)</label>
                <input
                  className="form-input"
                  type="number"
                  step="0.01"
                  value={entry.sgst || ''}
                  onChange={e => updateField('sgst', e.target.value)}
                />
              </div>
              <div className="form-group">
                <label className="form-label">IGST (5%)</label>
                <input
                  className="form-input"
                  type="number"
                  step="0.01"
                  value={entry.igst || ''}
                  onChange={e => updateField('igst', e.target.value)}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Round Off</label>
                <input
                  className="form-input"
                  type="number"
                  step="0.01"
                  value={entry.round_off || ''}
                  onChange={e => updateField('round_off', e.target.value)}
                />
              </div>
              <div className="total-row grand-total">
                <span>Grand Total</span>
                <span>₹{(entry.total || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Action Bar */}
      <div className="action-bar">
        <div className="action-bar-status">
          <span className={`status-badge status-${entry.status}`}>{entry.status}</span>
          <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
            ₹{(entry.total || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
          </span>
        </div>
        <div className="action-bar-buttons">
          <button className="btn btn-danger btn-sm" onClick={deleteEntry}>🗑️ Delete</button>
          <button className="btn btn-secondary" onClick={save} disabled={saving}>
            {saving ? <><span className="spinner" /> Saving...</> : '💾 Save'}
          </button>
          {(entry.status === 'pending' || entry.status === 'failed') && (
            <button className="btn btn-success" onClick={approve}>
              ✅ Approve & Push to Tally
            </button>
          )}
        </div>
      </div>

      {/* Photo Zoom Modal */}
      {photoZoom && entry.image_url && (
        <div className="photo-modal" onClick={() => setPhotoZoom(false)}>
          <img src={entry.image_url} alt="Bill zoomed" />
        </div>
      )}
    </>
  );
}
