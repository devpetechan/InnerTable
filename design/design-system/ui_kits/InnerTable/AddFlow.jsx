import React from 'react';
import { Button } from '../../components/buttons/Button';

const DotIcon = ({ color = 'var(--color-accent)' }) => (
  <span style={{ width: 11, height: 11, border: `1.7px solid ${color}`, borderRadius: '50% 50% 50% 2px', boxSizing: 'border-box', transform: 'rotate(-45deg)', display: 'inline-block', flex: 'none' }} />
);

function Dots({ step }) {
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
      {[1, 2, 3].slice(0, step === 1 ? 2 : 3).map(n => (
        <span key={n} style={{ width: 7, height: 7, borderRadius: '50%', background: n === step ? 'var(--color-accent)' : '#DED8D0' }} />
      ))}
    </div>
  );
}

/**
 * Guided multi-step add flow (6b). `initialStep` = 1 for the FAB entry point
 * (new place), 2 for "Add your take" on an existing card (place pre-filled & locked).
 */
export function AddFlow({ place: initialPlace, initialStep = 1, onCancel, onDone }) {
  const [step, setStep] = React.useState(initialStep);
  const [place, setPlace] = React.useState(initialPlace || '');
  const [intent, setIntent] = React.useState(null); // 'try' | 'been'
  const [tryNote, setTryNote] = React.useState('');
  const [rating, setRating] = React.useState(4);
  const [verdict, setVerdict] = React.useState('recommend'); // 'recommend' | 'pass'
  const [note, setNote] = React.useState('');
  const [detailsOpen, setDetailsOpen] = React.useState(false);
  const locked = !!initialPlace;

  const shellStyle = {
    display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--color-paper)', fontFamily: 'var(--font-ui)',
  };
  const headerStyle = { flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px' };
  const bodyStyle = { flex: 1, overflowY: 'auto', padding: '8px 20px 20px', display: 'flex', flexDirection: 'column', gap: 16 };
  const footerStyle = { flex: 'none', padding: '14px 20px 22px', borderTop: '1px solid var(--color-divider)' };
  const labelStyle = { fontSize: 12.5, fontWeight: 600, color: 'var(--color-secondary)', marginBottom: 7 };
  const inputStyle = { border: '1px solid var(--color-border-input)', background: '#fff', borderRadius: 11, padding: '13px 14px', fontSize: 14.5, color: 'var(--color-ink)' };

  if (step === 1) {
    return (
      <div style={shellStyle}>
        <div style={headerStyle}>
          <button onClick={onCancel} style={{ border: 'none', background: 'transparent', color: 'var(--color-muted)', fontFamily: 'inherit', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
          <Dots step={1} />
          <span style={{ width: 48 }} />
        </div>
        <div style={bodyStyle}>
          <div style={{ fontWeight: 800, fontSize: 23, color: 'var(--color-ink)', letterSpacing: '-0.02em' }}>What’s the place?</div>
          <div>
            <div style={{ ...inputStyle, display: 'flex', alignItems: 'center', gap: 10, border: '1.5px solid var(--color-accent)', boxShadow: '0 0 0 3px var(--color-accent-ring)' }}>
              <DotIcon />
              <input value={place} onChange={e => setPlace(e.target.value)} placeholder="Search a restaurant or bar…" style={{ border: 'none', outline: 'none', font: 'inherit', fontSize: 15, flex: 1, background: 'transparent' }} />
            </div>
            {place && (
              <div style={{ marginTop: 6, border: '1px solid var(--color-border-card)', background: '#fff', borderRadius: 11, boxShadow: 'var(--shadow-sheet)', overflow: 'hidden' }}>
                <div onClick={() => setPlace(place)} style={{ display: 'flex', gap: 11, alignItems: 'center', padding: '12px 14px', background: 'var(--color-accent-soft)', cursor: 'pointer' }}>
                  <DotIcon />
                  <div><div style={{ fontWeight: 600, fontSize: 14, color: 'var(--color-ink)' }}>{place}</div><div style={{ fontSize: 11.5, color: 'var(--color-muted)' }}>Suggested address · Neighborhood</div></div>
                </div>
              </div>
            )}
          </div>
          <div style={{ fontSize: 12.5, color: 'var(--color-faint)', textAlign: 'center' }}>Search any restaurant or bar — we’ll grab the address.</div>
        </div>
        <div style={footerStyle}>
          <Button variant="primary" style={{ width: '100%' }} disabled={!place} onClick={() => setStep(2)}>Next</Button>
        </div>
      </div>
    );
  }

  if (step === 2) {
    const wantSelected = intent === 'try';
    const beenSelected = intent === 'been';
    return (
      <div style={shellStyle}>
        <div style={headerStyle}>
          <button onClick={() => (locked ? onCancel() : setStep(1))} style={{ border: 'none', background: 'transparent', color: 'var(--color-muted)', fontFamily: 'inherit', fontSize: 20, cursor: 'pointer', padding: '0 6px' }}>{locked ? '✕' : '‹'}</button>
          <Dots step={2} />
          <span style={{ width: 48 }} />
        </div>
        <div style={bodyStyle}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, border: '1px solid var(--color-border-card)', background: '#fff', borderRadius: 12, padding: '12px 14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <DotIcon color="var(--color-muted)" />
              <div><div style={{ fontWeight: 700, fontSize: 14.5, color: 'var(--color-ink)' }}>{place || 'Untitled place'}</div></div>
            </div>
            {!locked && <button onClick={() => setStep(1)} style={{ border: 'none', background: 'transparent', color: 'var(--color-accent)', fontWeight: 600, fontSize: 12.5, cursor: 'pointer' }}>Edit</button>}
          </div>

          <div style={{ fontWeight: 800, fontSize: 20, color: 'var(--color-ink)', letterSpacing: '-0.02em' }}>Have you been?</div>

          <div onClick={() => setIntent('try')} style={{
            border: wantSelected ? '1.5px solid var(--color-accent)' : '1px solid var(--color-border-card)',
            background: wantSelected ? 'var(--color-accent-soft)' : '#fff', borderRadius: 14, padding: 15, cursor: 'pointer',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 13 }}>
              <span style={{ width: 44, height: 44, borderRadius: 12, background: 'var(--status-try-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>
                <span style={{ width: 15, height: 15, border: '2px solid var(--status-try-dot)', borderRadius: '50% 50% 50% 3px', boxSizing: 'border-box', transform: 'rotate(-45deg)' }} />
              </span>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 15.5, color: 'var(--color-ink)' }}>Want to try</div>
                <div style={{ fontSize: 12.5, color: 'var(--color-muted)', marginTop: 2 }}>Just saving it for later.</div>
              </div>
              {wantSelected && <span style={{ width: 20, height: 20, borderRadius: '50%', background: 'var(--color-accent)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700 }}>✓</span>}
            </div>
            {wantSelected && (
              <div style={{ marginTop: 13, borderTop: '1px solid #EAD9D0', paddingTop: 13 }}>
                <textarea value={tryNote} onChange={e => setTryNote(e.target.value)} placeholder="Add a note (optional)…" style={{ ...inputStyle, width: '100%', boxSizing: 'border-box', minHeight: 40, resize: 'vertical', fontFamily: 'inherit' }} />
              </div>
            )}
          </div>

          <div onClick={() => { setIntent('been'); setStep(3); }} style={{ display: 'flex', alignItems: 'center', gap: 13, border: '1px solid var(--color-border-card)', background: '#fff', borderRadius: 14, padding: 15, cursor: 'pointer' }}>
            <span style={{ width: 44, height: 44, borderRadius: 12, background: 'var(--color-accent-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none', color: 'var(--color-accent)', fontSize: 22, lineHeight: 0 }}>★</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: 15.5, color: 'var(--color-ink)' }}>I’ve been</div>
              <div style={{ fontSize: 12.5, color: 'var(--color-muted)', marginTop: 2 }}>Share a rating &amp; a take.</div>
            </div>
            <span style={{ color: '#C7BEB3', fontSize: 20 }}>›</span>
          </div>
        </div>
        <div style={footerStyle}>
          <Button variant="primary" style={{ width: '100%' }} disabled={!wantSelected} onClick={onDone}>Save to Want to Try</Button>
        </div>
      </div>
    );
  }

  // step 3 — review (I've been)
  return (
    <div style={shellStyle}>
      <div style={headerStyle}>
        <button onClick={() => (locked ? onCancel() : setStep(2))} style={{ border: 'none', background: 'transparent', color: 'var(--color-muted)', fontFamily: 'inherit', fontSize: 20, cursor: 'pointer', padding: '0 6px' }}>{locked ? '✕' : '‹'}</button>
        <Dots step={3} />
        <span style={{ width: 48 }} />
      </div>
      <div style={bodyStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <DotIcon color="var(--color-muted)" />
          <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--color-ink)' }}>{place || 'Untitled place'}</div>
        </div>

        <div>
          <div style={labelStyle}>Your rating</div>
          <div style={{ display: 'flex', gap: 10, fontSize: 36, lineHeight: 1, color: 'var(--color-accent)' }}>
            {[1, 2, 3, 4, 5].map(n => (
              <span key={n} onClick={() => setRating(n)} style={{ cursor: 'pointer', color: n <= rating ? 'var(--rating-filled)' : 'var(--rating-empty)' }}>★</span>
            ))}
          </div>
        </div>

        <div>
          <div style={labelStyle}>Your call</div>
          <div style={{ display: 'flex', gap: 10 }}>
            <div onClick={() => setVerdict('recommend')} style={{
              flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, cursor: 'pointer',
              border: verdict === 'recommend' ? '1.5px solid var(--status-rec-dot)' : '1px solid var(--color-border-input)',
              background: verdict === 'recommend' ? 'var(--status-rec-bg)' : '#fff',
              color: verdict === 'recommend' ? 'var(--status-rec-text)' : 'var(--color-muted)',
              fontWeight: 700, fontSize: 14, padding: 13, borderRadius: 12,
            }}>{verdict === 'recommend' && <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--status-rec-dot)' }} />}Recommend</div>
            <div onClick={() => setVerdict('pass')} style={{
              flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, cursor: 'pointer',
              border: verdict === 'pass' ? '1.5px solid var(--status-pass-dot)' : '1px solid var(--color-border-input)',
              background: verdict === 'pass' ? 'var(--status-pass-bg)' : '#fff',
              color: verdict === 'pass' ? 'var(--status-pass-text)' : 'var(--color-muted)',
              fontWeight: 700, fontSize: 14, padding: 13, borderRadius: 12,
            }}>Hard pass</div>
          </div>
        </div>

        <div>
          <div style={labelStyle}>Note <span style={{ color: 'var(--color-faint)', fontWeight: 500 }}>(optional)</span></div>
          <textarea value={note} onChange={e => setNote(e.target.value)} placeholder="What should they order?" style={{ ...inputStyle, width: '100%', boxSizing: 'border-box', minHeight: 44, resize: 'vertical', fontFamily: 'inherit' }} />
        </div>

        <button onClick={() => setDetailsOpen(o => !o)} style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', cursor: 'pointer',
          border: '1px dashed #D8CFC4', background: detailsOpen ? '#FBF9F5' : 'transparent', borderRadius: 11, padding: 14,
          color: detailsOpen ? 'var(--color-ink)' : 'var(--color-secondary)', fontFamily: 'inherit', fontWeight: detailsOpen ? 700 : 600, fontSize: 13.5,
        }}>
          <span>{detailsOpen ? 'Details' : <>Add cuisine, price &amp; detailed ratings <span style={{ color: 'var(--color-faint)', fontWeight: 500 }}>(optional)</span></>}</span>
          <span style={{ color: '#B8AFA4', fontSize: 15 }}>{detailsOpen ? '▾' : '▸'}</span>
        </button>

        {detailsOpen && (
          <>
            <div>
              <div style={labelStyle}>Cuisine <span style={{ color: 'var(--color-faint)', fontWeight: 500 }}>(optional)</span></div>
              <input placeholder="e.g. Italian" style={{ ...inputStyle, width: '100%', boxSizing: 'border-box' }} />
            </div>
            <div>
              <div style={labelStyle}>Price <span style={{ color: 'var(--color-faint)', fontWeight: 500 }}>(optional)</span></div>
              <div style={{ display: 'flex', gap: 8 }}>
                {['$', '$$', '$$$', '$$$$'].map(p => (
                  <span key={p} style={{ flex: 1, textAlign: 'center', border: p === '$$' ? '1.5px solid var(--color-accent)' : '1px solid var(--color-border-input)', background: p === '$$' ? 'var(--color-accent-soft)' : '#fff', borderRadius: 10, padding: 10, fontWeight: p === '$$' ? 700 : 600, fontSize: 14, color: p === '$$' ? 'var(--color-ink)' : 'var(--color-muted)' }}>{p}</span>
                ))}
              </div>
            </div>
            <div>
              <div style={{ ...labelStyle, marginBottom: 4 }}>Detailed ratings <span style={{ color: 'var(--color-faint)', fontWeight: 500 }}>(optional)</span></div>
              {['Food quality', 'Service', 'Value', 'Ambiance'].map((label, i) => (
                <div key={label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '9px 0', borderBottom: i < 3 ? '1px solid var(--color-divider)' : 'none' }}>
                  <span style={{ fontSize: 14, color: 'var(--color-ink)' }}>{label}</span>
                  <div style={{ display: 'flex', gap: 4, fontSize: 17, color: 'var(--rating-filled)' }}>
                    {[1,2,3,4,5].map(n => <span key={n} style={{ color: n <= (5 - i % 2) ? 'var(--rating-filled)' : 'var(--rating-empty)' }}>★</span>)}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
      <div style={footerStyle}>
        <Button variant="primary" style={{ width: '100%' }} onClick={onDone}>Share take</Button>
      </div>
    </div>
  );
}
