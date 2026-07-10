import React from 'react';
import { Avatar } from '../../components/avatars/Avatar';
import { Button } from '../../components/buttons/Button';
import { PlaceCard } from '../../components/cards/PlaceCard';

export const PLACES = [
  { name: 'Casa Enrique', metaLine: 'Restaurant · Mexican · $$ · Long Island City', status: 'recommends', people: [{initials:'SM',color:'var(--avatar-4)'},{initials:'AR',color:'var(--avatar-3)'},{initials:'PT',color:'var(--avatar-5)'}], signalText: 'Sam, Ana +3 recommend', rating: 4.7, comments: 4, topTake: { author:'Sam', initials:'SM', color:'var(--avatar-4)', rating:5.0, note:'Best mole in the city — worth the L train. Get the enchiladas.' } },
  { name: 'Attaboy', metaLine: 'Bar · Cocktails · $$$ · Lower East Side', status: 'try', people: [{initials:'AR',color:'var(--avatar-3)'},{initials:'SL',color:'var(--avatar-4)'},{initials:'MK',color:'var(--avatar-1)'}], signalText: '4 friends want to try', googleRating: 4.5, comments: 2 },
  { name: 'Lucia Pizza', metaLine: 'Restaurant · Italian · $$ · Fort Greene', status: 'recommends', people: [{initials:'JD',color:'var(--avatar-2)'},{initials:'AR',color:'var(--avatar-3)'},{initials:'SL',color:'var(--avatar-4)'}], signalText: 'Jordan, Ana +1 recommend', rating: 4.2, comments: 3, topTake: { author:'Jordan', initials:'JD', color:'var(--avatar-2)', rating:4.5, note:'Get the clam pie and a Negroni. Go early — no reservations.' } },
  { name: "Kiki's", metaLine: 'Restaurant · Greek · $$ · Lower East Side', status: 'mixed', people: [{initials:'SM',color:'var(--avatar-4)'},{initials:'PT',color:'var(--avatar-5)'}], signalText: '2 recommend · 2 passed', rating: 2.4, comments: 7, topTake: { author:'Sam', initials:'SM', color:'var(--avatar-4)', isPass:true, note:'90-minute wait and the food was mid. Skip it.' } },
  { name: 'Balthazar', metaLine: 'Restaurant · French · $$$ · SoHo', status: 'recommends', people: [{initials:'PT',color:'var(--avatar-5)'},{initials:'JD',color:'var(--avatar-2)'},{initials:'MK',color:'var(--avatar-1)'}], signalText: 'Priya, Jordan +2 recommend', rating: 4.5, comments: 5, topTake: { author:'Priya', initials:'PT', color:'var(--avatar-5)', rating:4.5, note:'Classic French bistro that never misses. Sit at the bar for oysters.' } },
  { name: 'Bemelmans Bar', metaLine: 'Bar · Cocktails · $$$$ · Upper East Side', status: 'try', people: [{initials:'JD',color:'var(--avatar-2)'},{initials:'PT',color:'var(--avatar-5)'},{initials:'SM',color:'var(--avatar-4)'}], signalText: '3 friends want to try', googleRating: 4.4, comments: 1 },
  { name: 'The Long Island Bar', metaLine: 'Bar · Cocktails · $$ · Cobble Hill', status: 'recommends', people: [{initials:'JD',color:'var(--avatar-2)'},{initials:'MK',color:'var(--avatar-1)'}], signalText: 'Jordan +1 recommend', rating: 4.3, comments: 2, topTake: { author:'Jordan', initials:'JD', color:'var(--avatar-2)', rating:4.3, note:'Great martinis, retro room, never a wait.' } },
];

const TABS = [
  { key: 'all', label: 'All' },
  { key: 'try', label: 'Want to Try' },
  { key: 'recommends', label: 'Recommended' },
];

export function TheList({ onAddPlace, onAddTake }) {
  const [tab, setTab] = React.useState('all');
  const [view, setView] = React.useState('list');

  const filtered = PLACES.filter(p => {
    if (tab === 'all') return true;
    if (tab === 'try') return p.status === 'try';
    return p.status === 'recommends' || p.status === 'mixed';
  });

  return (
    <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--color-paper)', fontFamily: 'var(--font-ui)' }}>

      <div style={{ flex: 'none', padding: '4px 20px 14px', borderBottom: '1px solid var(--color-divider)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontWeight: 800, fontSize: 20, color: 'var(--color-ink)', letterSpacing: '-0.02em' }}>Inner Table</div>
          <Avatar initials="MK" size={32} />
        </div>

        <div style={{ display: 'flex', background: 'var(--color-canvas)', borderRadius: 11, padding: 3, marginTop: 15 }}>
          {TABS.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)} style={{
              flex: 1, border: 'none', fontFamily: 'inherit', fontSize: 12.5, padding: '8px 4px',
              borderRadius: 8, cursor: 'pointer',
              background: tab === t.key ? '#fff' : 'transparent',
              color: tab === t.key ? 'var(--color-ink)' : 'var(--color-muted)',
              fontWeight: tab === t.key ? 700 : 600,
              boxShadow: tab === t.key ? 'var(--shadow-raised)' : 'none',
            }}>{t.label}</button>
          ))}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 }}>
          <div style={{ display: 'flex', background: 'var(--color-canvas)', borderRadius: 9, padding: 3 }}>
            <button onClick={() => setView('list')} style={{
              display: 'inline-flex', alignItems: 'center', gap: 6, border: 'none', fontFamily: 'inherit',
              fontWeight: view === 'list' ? 700 : 600, fontSize: 12, padding: '6px 13px', borderRadius: 7, cursor: 'pointer',
              background: view === 'list' ? '#fff' : 'transparent', color: view === 'list' ? 'var(--color-ink)' : 'var(--color-muted)',
              boxShadow: view === 'list' ? 'var(--shadow-raised)' : 'none',
            }}>List</button>
            <button onClick={() => setView('map')} style={{
              display: 'inline-flex', alignItems: 'center', gap: 6, border: 'none', fontFamily: 'inherit',
              fontWeight: view === 'map' ? 700 : 600, fontSize: 12, padding: '6px 13px', borderRadius: 7, cursor: 'pointer',
              background: view === 'map' ? '#fff' : 'transparent', color: view === 'map' ? 'var(--color-ink)' : 'var(--color-muted)',
              boxShadow: view === 'map' ? 'var(--shadow-raised)' : 'none',
            }}>Map</button>
          </div>
          <Button variant="ghost" size="sm">Filter &amp; sort</Button>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 20px 120px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {view === 'map' ? (
          <div style={{
            border: '1px dashed var(--color-border-card)', borderRadius: 16, padding: '40px 20px',
            textAlign: 'center', color: 'var(--color-muted)', fontSize: 13.5, lineHeight: 1.6,
          }}>
            Map view is a first-class discovery surface for InnerTable — pins for the group's places near you now — not yet designed. Placeholder only.
          </div>
        ) : (
          filtered.map(p => (
            <PlaceCard key={p.name} {...p} onAddTake={() => onAddTake && onAddTake(p)} />
          ))
        )}
      </div>

      <Button variant="fab" icon="+" onClick={onAddPlace} style={{
        position: 'absolute', bottom: 26, left: '50%', transform: 'translateX(-50%)', zIndex: 20,
      }}>Add a place</Button>
    </div>
  );
}
