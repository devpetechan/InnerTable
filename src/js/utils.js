//  RATINGS — AVERAGE COMPUTATION
// ══════════════════════════════════════════════════
function computeAvgRating(r) {
  if (r.userRatings) {
    const vals = Object.values(r.userRatings).map(u => u.overall || 0).filter(v => v > 0);
    if (vals.length) return { avg: vals.reduce((a,b)=>a+b,0)/vals.length, count: vals.length };
  }
  if (r.rating) return { avg: r.rating, count: 1 };
  return { avg: 0, count: 0 };
}

function computeAvgFactors(r) {
  const factors = ['quality','service','value','ambiance'];
  const result  = {};
  let   hasAny  = false;
  if (r.userRatings) {
    factors.forEach(f => {
      const vals = Object.values(r.userRatings).map(u => u[f]||0).filter(v => v > 0);
      if (vals.length) { result[f] = vals.reduce((a,b)=>a+b,0)/vals.length; hasAny = true; }
    });
  } else if (r.factorRatings) {
    factors.forEach(f => { if (r.factorRatings[f]) { result[f] = r.factorRatings[f]; hasAny = true; } });
  }
  return hasAny ? result : null;
}

// ══════════════════════════════════════════════════

//  HELPERS
// ══════════════════════════════════════════════════
function esc(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// Build a Google Maps URL for a place entry (uses coords if available, falls back to text search)
function buildMapsUrl(r) {
  if (r.lat && r.lng) {
    return `https://maps.google.com/maps?q=${r.lat},${r.lng}`;
  }
  const query = [r.name, r.location].filter(Boolean).join(', ');
  return `https://maps.google.com/maps?q=${encodeURIComponent(query)}`;
}
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3000);
}
function shake(el) {
  el.style.borderColor = 'var(--rust)';
  el.focus();
  setTimeout(() => el.style.borderColor = '', 1200);
}


// ══════════════════════════════════════════════════
