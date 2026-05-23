import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Camera, Plus, Shirt, Sparkles, Trash2, Heart, Wand2, Upload, Search, RefreshCcw } from 'lucide-react';
import './styles.css';

const STORAGE_KEY = 'style-ai-free-pieces-v3';
const OUTFIT_HISTORY_KEY = 'style-ai-free-history-v1';

const CATEGORIES = ['T-Shirt', 'Shirt', 'Hoodie', 'Pullover', 'Jacke', 'Hose', 'Chino', 'Jeans', 'Shorts', 'Schuhe', 'Accessoire'];
const STYLES = ['Casual', 'Smart Casual', 'Sportlich', 'Minimalistisch', 'Streetwear', 'Business Casual'];
const SEASONS = ['Ganzjährig', 'Sommer', 'Winter', 'Übergang'];
const OCCASIONS = ['Alltag', 'Date', 'Office', 'Gym', 'Festival', 'Abend', 'Reise'];

function load(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
function save(key, value) { localStorage.setItem(key, JSON.stringify(value)); }

async function fileToCompressedDataUrl(file, max = 900, quality = 0.72) {
  const img = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
  const ratio = Math.min(max / img.width, max / img.height, 1);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.width * ratio);
  canvas.height = Math.round(img.height * ratio);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', quality);
}

function detectDominantColor(dataUrl) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const size = 48;
      canvas.width = size; canvas.height = size;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, size, size);
      const data = ctx.getImageData(0, 0, size, size).data;
      let r=0,g=0,b=0,count=0;
      for (let i=0; i<data.length; i+=16) {
        const rr=data[i], gg=data[i+1], bb=data[i+2], aa=data[i+3];
        if (aa < 128) continue;
        if (rr > 235 && gg > 235 && bb > 235) continue;
        r+=rr; g+=gg; b+=bb; count++;
      }
      if (!count) return resolve({ name: 'Weiß', hex: '#f8fafc', tone: 'hell' });
      r=Math.round(r/count); g=Math.round(g/count); b=Math.round(b/count);
      resolve(classifyColor(r,g,b));
    };
    img.onerror = () => resolve({ name: 'Unbekannt', hex: '#9ca3af', tone: 'neutral' });
    img.src = dataUrl;
  });
}
function classifyColor(r,g,b) {
  const max=Math.max(r,g,b), min=Math.min(r,g,b), brightness=(r+g+b)/3;
  const hex = '#' + [r,g,b].map(x=>x.toString(16).padStart(2,'0')).join('');
  if (brightness < 45) return { name:'Schwarz', hex, tone:'dunkel' };
  if (brightness > 215 && max-min < 25) return { name:'Weiß', hex, tone:'hell' };
  if (max-min < 28) return { name: brightness > 140 ? 'Grau' : 'Dunkelgrau', hex, tone: brightness > 140 ? 'neutral' : 'dunkel' };
  if (b > r + 25 && b > g + 15) return { name:'Blau/Navy', hex, tone:'dunkel' };
  if (r > g + 35 && r > b + 35) return { name:'Rot/Bordeaux', hex, tone:'warm' };
  if (g > r + 20 && g > b + 10) return { name:'Grün/Olive', hex, tone:'erdig' };
  if (r > 150 && g > 120 && b < 90) return { name:'Beige/Braun', hex, tone:'erdig' };
  return { name:'Gemischt', hex, tone:'neutral' };
}

function autoCategory(name) {
  const n = name.toLowerCase();
  if (n.includes('jeans')) return 'Jeans';
  if (n.includes('chino')) return 'Chino';
  if (n.includes('hose') || n.includes('pants')) return 'Hose';
  if (n.includes('shoe') || n.includes('sneaker') || n.includes('schuh')) return 'Schuhe';
  if (n.includes('hoodie')) return 'Hoodie';
  if (n.includes('jacke') || n.includes('jacket')) return 'Jacke';
  if (n.includes('shirt')) return 'T-Shirt';
  return 'T-Shirt';
}

function scoreCombo(top, bottom, shoes, occasion) {
  let score = 60;
  const neutral = ['Schwarz','Weiß','Grau','Dunkelgrau','Blau/Navy','Beige/Braun'];
  [top,bottom,shoes].forEach(p => { if (neutral.some(n => p.colorName?.includes(n))) score += 6; });
  if (top.colorTone !== bottom.colorTone) score += 10;
  if (occasion === 'Office' || occasion === 'Date') {
    if (bottom.category === 'Chino' || bottom.category === 'Jeans') score += 8;
    if (top.style === 'Smart Casual' || top.style === 'Minimalistisch') score += 8;
  }
  if (occasion === 'Gym' && (top.style === 'Sportlich' || bottom.style === 'Sportlich')) score += 16;
  if (top.favorite) score += 3; if (bottom.favorite) score += 3; if (shoes.favorite) score += 3;
  return Math.min(99, score);
}

function generateOutfit(pieces, occasion) {
  const tops = pieces.filter(p => ['T-Shirt','Shirt','Hoodie','Pullover','Jacke'].includes(p.category));
  const bottoms = pieces.filter(p => ['Hose','Chino','Jeans','Shorts'].includes(p.category));
  const shoes = pieces.filter(p => p.category === 'Schuhe');
  if (!tops.length || !bottoms.length || !shoes.length) return null;
  const combos = [];
  for (const t of tops) for (const b of bottoms) for (const s of shoes) combos.push({ top:t, bottom:b, shoes:s, score: scoreCombo(t,b,s,occasion) });
  combos.sort((a,b)=>b.score-a.score);
  return combos[0];
}

function App() {
  const [pieces, setPieces] = useState(() => load(STORAGE_KEY, []));
  const [history, setHistory] = useState(() => load(OUTFIT_HISTORY_KEY, []));
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('Alle');
  const [occasion, setOccasion] = useState('Alltag');
  const [outfit, setOutfit] = useState(null);
  const [draft, setDraft] = useState({ name:'', category:'T-Shirt', style:'Casual', season:'Ganzjährig', image:'', colorName:'', colorHex:'#9ca3af', colorTone:'neutral' });
  const fileRef = useRef(null);

  useEffect(()=>save(STORAGE_KEY, pieces), [pieces]);
  useEffect(()=>save(OUTFIT_HISTORY_KEY, history), [history]);

  const filtered = useMemo(() => pieces.filter(p => (category==='Alle'||p.category===category) && (p.name.toLowerCase().includes(query.toLowerCase()) || p.category.toLowerCase().includes(query.toLowerCase()) || p.colorName.toLowerCase().includes(query.toLowerCase()))), [pieces, query, category]);

  async function onFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const image = await fileToCompressedDataUrl(file);
    const color = await detectDominantColor(image);
    const baseName = file.name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ');
    setDraft(d => ({ ...d, image, name: baseName || 'Neues Piece', category: autoCategory(baseName), colorName: color.name, colorHex: color.hex, colorTone: color.tone }));
  }

  function addPiece() {
    if (!draft.image) return alert('Bitte erst ein Bild hochladen.');
    const piece = { ...draft, id: crypto.randomUUID(), createdAt: new Date().toISOString(), favorite:false };
    setPieces(prev => [piece, ...prev]);
    setDraft({ name:'', category:'T-Shirt', style:'Casual', season:'Ganzjährig', image:'', colorName:'', colorHex:'#9ca3af', colorTone:'neutral' });
    if (fileRef.current) fileRef.current.value = '';
  }

  function makeOutfit() {
    const result = generateOutfit(pieces, occasion);
    setOutfit(result);
    if (result) setHistory(h => [{ id: crypto.randomUUID(), occasion, createdAt: new Date().toISOString(), score: result.score, names: [result.top.name, result.bottom.name, result.shoes.name] }, ...h].slice(0, 20));
  }

  function clearAll() { if (confirm('Alle gespeicherten Pieces löschen?')) setPieces([]); }

  return <div className="app">
    <header className="hero">
      <div><p className="eyebrow">kostenlos · lokal · mobile</p><h1>Style AI Free</h1><p>Speichere deine Pieces und generiere Outfits ohne API-Kosten.</p></div>
      <button className="ghost" onClick={clearAll}><RefreshCcw size={18}/> Reset</button>
    </header>

    <main className="grid">
      <section className="card add-card">
        <h2><Camera size={20}/> Piece erfassen</h2>
        <input ref={fileRef} className="hidden" type="file" accept="image/*" capture="environment" onChange={onFile}/>
        <button className="upload" onClick={()=>fileRef.current?.click()}><Upload/> Foto aufnehmen / hochladen</button>
        {draft.image && <img className="preview" src={draft.image} alt="Preview"/>}
        <label>Name<input value={draft.name} onChange={e=>setDraft({...draft, name:e.target.value})} placeholder="z.B. Weißes Uniqlo Shirt"/></label>
        <div className="row"><label>Kategorie<select value={draft.category} onChange={e=>setDraft({...draft, category:e.target.value})}>{CATEGORIES.map(c=><option key={c}>{c}</option>)}</select></label><label>Style<select value={draft.style} onChange={e=>setDraft({...draft, style:e.target.value})}>{STYLES.map(s=><option key={s}>{s}</option>)}</select></label></div>
        <div className="row"><label>Saison<select value={draft.season} onChange={e=>setDraft({...draft, season:e.target.value})}>{SEASONS.map(s=><option key={s}>{s}</option>)}</select></label><label>Farbe<input value={draft.colorName} onChange={e=>setDraft({...draft, colorName:e.target.value})}/></label></div>
        <button className="primary" onClick={addPiece}><Plus size={18}/> Speichern</button>
      </section>

      <section className="card outfit-card">
        <h2><Wand2 size={20}/> Outfit Generator</h2>
        <label>Anlass<select value={occasion} onChange={e=>setOccasion(e.target.value)}>{OCCASIONS.map(o=><option key={o}>{o}</option>)}</select></label>
        <button className="primary" onClick={makeOutfit}><Sparkles size={18}/> Beste Kombi finden</button>
        {!outfit && <p className="hint">Du brauchst mindestens Oberteil, Hose und Schuhe.</p>}
        {outfit && <div className="outfit">
          <div className="score">{outfit.score}% Match</div>
          {[outfit.top, outfit.bottom, outfit.shoes].map(p => <div className="mini" key={p.id}><img src={p.image}/><div><b>{p.name}</b><span>{p.category} · {p.colorName}</span></div></div>)}
          <p className="hint">Ausgewählt nach Farbe, Anlass, Kategorie und Favoriten.</p>
        </div>}
      </section>
    </main>

    <section className="toolbar">
      <div className="search"><Search size={18}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Suchen..."/></div>
      <select value={category} onChange={e=>setCategory(e.target.value)}><option>Alle</option>{CATEGORIES.map(c=><option key={c}>{c}</option>)}</select>
    </section>

    <section className="wardrobe">
      {filtered.map(p => <article className="piece" key={p.id}>
        <img src={p.image} alt={p.name}/>
        <div className="piece-body"><div className="piece-title"><b>{p.name}</b><button onClick={()=>setPieces(prev=>prev.map(x=>x.id===p.id?{...x,favorite:!x.favorite}:x))}><Heart size={17} fill={p.favorite?'currentColor':'none'}/></button></div><span>{p.category} · {p.style}</span><div className="color"><i style={{background:p.colorHex}}/> {p.colorName}</div><button className="danger" onClick={()=>setPieces(prev=>prev.filter(x=>x.id!==p.id))}><Trash2 size={16}/> Löschen</button></div>
      </article>)}
      {!filtered.length && <div className="empty"><Shirt size={40}/><p>Noch keine Pieces gespeichert.</p></div>}
    </section>
  </div>;
}

createRoot(document.getElementById('root')).render(<App/>);
