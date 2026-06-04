// RD Interlock — Daily Entry screens (the hero)

function DailyEntryV1() {
  const workers = [
    { name: 'Lal Singh', count: 320, active: true },
    { name: 'Mohan Kumar', count: 280, active: true },
    { name: 'Vikram Yadav', count: 0, active: false },
    { name: 'Suresh Patel', count: 410, active: true },
    { name: 'Karan Devji', count: 240, active: true },
    { name: 'Babu Lal', count: 0, active: false },
  ];

  return (
    <div className="rd" style={{
      width: 360, height: 780, position: 'relative',
      background: rdColors.paper, overflow: 'hidden',
    }}>
      <PhoneStatus/>

      {/* Header */}
      <div style={{ padding: '4px 18px 14px', display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ width: 38, height: 38, borderRadius: 12, background: '#fff', border: '1px solid rgba(15,23,42,.08)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <I.ChevronLeft size={18} color={rdColors.ink}/>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 17, fontWeight: 700, color: rdColors.ink, letterSpacing: -0.3 }}>Daily Entry</div>
          <div style={{ fontSize: 11, color: rdColors.slate500 }}>Wed, 6 May · Shift A</div>
        </div>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 10px', borderRadius: 999, background: '#fff', border: '1px solid rgba(15,23,42,.08)' }}>
          <I.Mic size={14} color={rdColors.orange}/>
          <span style={{ fontSize: 11, fontWeight: 600, color: rdColors.slate700 }}>Voice</span>
        </div>
      </div>

      {/* Mode toggle */}
      <div style={{ padding: '0 18px 14px' }}>
        <div style={{ background: rdColors.slate100, borderRadius: 12, padding: 4, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
          <button style={{ all: 'unset', textAlign: 'center', padding: '10px 0', borderRadius: 9, background: '#fff', boxShadow: '0 1px 3px rgba(15,23,42,.08)', fontSize: 13, fontWeight: 600, color: rdColors.ink, cursor: 'pointer' }}>Same count</button>
          <button style={{ all: 'unset', textAlign: 'center', padding: '10px 0', fontSize: 13, fontWeight: 500, color: rdColors.slate500, cursor: 'pointer' }}>Different</button>
        </div>
      </div>

      {/* Brick type chips */}
      <div style={{ padding: '0 18px 14px' }}>
        <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: 0.5, textTransform: 'uppercase', color: rdColors.slate500, marginBottom: 8 }}>Brick type</div>
        <div style={{ display: 'flex', gap: 8, overflowX: 'auto' }}>
          {[
            { k: 'Type A · Standard', sel: true },
            { k: 'Type B · Heavy' },
            { k: 'Paver' },
          ].map(t => (
            <div key={t.k} style={{
              padding: '8px 14px', borderRadius: 999,
              background: t.sel ? rdColors.ink : '#fff',
              color: t.sel ? '#fff' : rdColors.slate700,
              border: t.sel ? 'none' : '1px solid rgba(15,23,42,.08)',
              fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap',
            }}>{t.k}</div>
          ))}
        </div>
      </div>

      {/* Quantity quick buttons */}
      <div style={{ padding: '0 18px 14px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
          <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: 0.5, textTransform: 'uppercase', color: rdColors.slate500 }}>Per worker count</span>
          <span style={{ fontSize: 11, color: rdColors.slate400 }}>tap to set</span>
        </div>
        <div style={{
          background: '#fff', borderRadius: 18, padding: 16,
          border: '1px solid rgba(15,23,42,.06)',
        }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, justifyContent: 'center' }}>
            <span className="display num" style={{ fontFamily: 'var(--rd-font-display)', fontSize: 56, fontWeight: 700, lineHeight: 1, letterSpacing: -1.5, color: rdColors.ink }}>320</span>
            <span style={{ fontSize: 14, color: rdColors.slate500, fontWeight: 500 }}>bricks</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 6, marginTop: 12 }}>
            {[100, 200, 300, 400, 500].map((q, i) => (
              <div key={q} style={{
                padding: '10px 0', borderRadius: 10, textAlign: 'center',
                background: i === 2 ? rdColors.orange : rdColors.slate100,
                color: i === 2 ? '#fff' : rdColors.slate700,
                fontSize: 13, fontWeight: 600,
                border: i === 2 ? 'none' : '1px solid rgba(15,23,42,.06)',
              }}>{q}</div>
            ))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6, marginTop: 6 }}>
            {['−10', '+10', 'Custom'].map((b, i) => (
              <div key={b} style={{
                padding: '8px 0', borderRadius: 10, textAlign: 'center',
                background: '#fff', border: '1px solid rgba(15,23,42,.1)',
                fontSize: 12, fontWeight: 600, color: rdColors.slate700,
              }}>{b}</div>
            ))}
          </div>
        </div>
      </div>

      {/* Worker list — chip selector */}
      <div style={{ padding: '0 18px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
          <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: 0.5, textTransform: 'uppercase', color: rdColors.slate500 }}>Workers · 4 selected</span>
          <span style={{ fontSize: 11, fontWeight: 600, color: rdColors.navy600 }}>Select all</span>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {workers.map(w => (
            <div key={w.name} style={{
              display: 'inline-flex', alignItems: 'center', gap: 8,
              padding: '6px 10px 6px 6px', borderRadius: 999,
              background: w.active ? rdColors.ink : '#fff',
              color: w.active ? '#fff' : rdColors.slate600,
              border: w.active ? 'none' : '1px solid rgba(15,23,42,.1)',
            }}>
              <Avatar name={w.name} size={22}/>
              <span style={{ fontSize: 12, fontWeight: 600 }}>{w.name.split(' ')[0]}</span>
              {w.active && <I.Check size={12} color={rdColors.orange} stroke={2.5}/>}
            </div>
          ))}
        </div>
      </div>

      {/* Bottom CTA */}
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: '14px 18px 28px',
        background: 'linear-gradient(180deg, rgba(250,250,247,0) 0%, ' + rdColors.paper + ' 30%)' }}>
        <div style={{ background: '#fff', borderRadius: 16, padding: 12, marginBottom: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between', border: '1px solid rgba(15,23,42,.06)' }}>
          <div>
            <div style={{ fontSize: 11, color: rdColors.slate500, fontWeight: 500 }}>Total entry</div>
            <div className="num display" style={{ fontFamily: 'var(--rd-font-display)', fontSize: 22, fontWeight: 700, color: rdColors.ink, letterSpacing: -0.5 }}>1,280 <span style={{ fontSize: 12, color: rdColors.slate500, fontWeight: 500 }}>bricks · ₹1,536 wage</span></div>
          </div>
          <Pill tone="success">✓ Auto-saved</Pill>
        </div>
        <div style={{
          background: `linear-gradient(135deg, ${rdColors.orange} 0%, #B8470E 100%)`,
          color: '#fff', borderRadius: 16, padding: '14px 18px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          boxShadow: '0 12px 24px rgba(242,106,31,.4)',
        }}>
          <span style={{ fontSize: 15, fontWeight: 700, letterSpacing: -0.2 }}>Save Entry</span>
          <I.ArrowRight size={20} color="#fff" stroke={2.4}/>
        </div>
      </div>
    </div>
  );
}

// V2: Different worker count mode — keypad-style
function DailyEntryV2() {
  const workers = [
    { name: 'Lal Singh', count: 320, focused: false },
    { name: 'Mohan Kumar', count: 280, focused: false },
    { name: 'Suresh Patel', count: 410, focused: true },
    { name: 'Karan Devji', count: 240, focused: false },
  ];
  return (
    <div className="rd" style={{
      width: 360, height: 780, position: 'relative',
      background: rdColors.ink, overflow: 'hidden',
      color: '#fff',
    }}>
      <PhoneStatus dark/>
      {/* header */}
      <div style={{ padding: '4px 18px 14px', display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ width: 38, height: 38, borderRadius: 12, background: 'rgba(255,255,255,.08)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <I.X size={18} color="#fff"/>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 17, fontWeight: 700, letterSpacing: -0.3 }}>Quick entry</div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,.55)' }}>Different counts mode</div>
        </div>
        <Pill tone="orange">Type A</Pill>
      </div>

      {/* Running total */}
      <div style={{ padding: '0 18px 14px' }}>
        <div style={{ background: 'rgba(255,255,255,.06)', borderRadius: 18, padding: 16, border: '1px solid rgba(255,255,255,.08)' }}>
          <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: 0.5, textTransform: 'uppercase', color: 'rgba(255,255,255,.55)' }}>Running total</div>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 4 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
              <span className="display num" style={{ fontFamily: 'var(--rd-font-display)', fontSize: 42, fontWeight: 700, letterSpacing: -1, lineHeight: 1 }}>1,250</span>
              <span style={{ fontSize: 13, color: 'rgba(255,255,255,.55)' }}>bricks</span>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div className="num" style={{ fontSize: 16, fontWeight: 700, color: rdColors.orange }}>₹1,500</div>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,.5)' }}>wage so far</div>
            </div>
          </div>
        </div>
      </div>

      {/* Active worker — bigger entry */}
      <div style={{ padding: '0 18px 12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
          <Avatar name="Suresh Patel" size={36}/>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 700 }}>Suresh Patel</div>
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,.55)' }}>Worker 3 of 4 · ₹1.20 / brick</div>
          </div>
          <span style={{ fontSize: 11, fontWeight: 600, color: rdColors.orange }}>3/4</span>
        </div>
        <div style={{ background: 'rgba(255,255,255,.06)', borderRadius: 16, padding: 16, textAlign: 'center', border: `2px solid ${rdColors.orange}` }}>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,.55)', fontWeight: 600 }}>Bricks today</div>
          <div className="display num" style={{ fontFamily: 'var(--rd-font-display)', fontSize: 56, fontWeight: 700, lineHeight: 1, letterSpacing: -1.5, marginTop: 4 }}>410</div>
        </div>
      </div>

      {/* Keypad */}
      <div style={{ padding: '0 18px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
          {['1','2','3','4','5','6','7','8','9','⌫','0','✓'].map((k, i) => {
            const isAction = k === '⌫' || k === '✓';
            const isOk = k === '✓';
            return (
              <div key={i} style={{
                height: 50, borderRadius: 14,
                background: isOk ? rdColors.orange : 'rgba(255,255,255,.08)',
                color: isOk ? '#fff' : '#fff',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontFamily: 'var(--rd-font-display)',
                fontSize: 22, fontWeight: 600, letterSpacing: -0.3,
                boxShadow: isOk ? '0 8px 18px rgba(242,106,31,.35)' : 'none',
              }}>{k}</div>
            );
          })}
        </div>
      </div>

      {/* Worker dots */}
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 30, padding: '0 18px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          {workers.map((w, i) => (
            <div key={w.name} style={{ flex: 1, textAlign: 'center', opacity: w.focused ? 1 : 0.5 }}>
              <div style={{ fontSize: 9, color: 'rgba(255,255,255,.6)', fontWeight: 600 }}>{w.name.split(' ')[0]}</div>
              <div className="num" style={{ fontSize: 13, fontWeight: 700, color: w.focused ? rdColors.orange : '#fff' }}>{w.count}</div>
              <div style={{ marginTop: 4, height: 3, borderRadius: 2, background: w.focused ? rdColors.orange : 'rgba(255,255,255,.18)' }}/>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

window.DailyEntryV1 = DailyEntryV1;
window.DailyEntryV2 = DailyEntryV2;
