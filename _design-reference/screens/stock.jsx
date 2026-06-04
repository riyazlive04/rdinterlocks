// RD Interlock — Stock Lifecycle pipeline screen

function StockScreen() {
  const stages = [
    { k: 'Produced',   v: 4820, c: '#F26A1F', age: 'Today',     batches: 1 },
    { k: 'Drying',     v: 12300, c: '#C97A18', age: '1–3 days',  batches: 3, alert: 'Batch B-12 ready to move' },
    { k: 'Curing',     v: 9100,  c: '#1F8FB3', age: '4–10 days', batches: 2 },
    { k: 'Ready',      v: 38420, c: '#2F8F5A', age: 'Sellable',  batches: 4 },
  ];
  return (
    <div className="rd" style={{ width: 360, height: 780, position: 'relative', background: rdColors.paper, overflow: 'hidden' }}>
      <PhoneStatus/>
      <div style={{ padding: '4px 18px 14px', display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 17, fontWeight: 700, color: rdColors.ink, letterSpacing: -0.3 }}>Stock pipeline</div>
          <div style={{ fontSize: 11, color: rdColors.slate500 }}>64,640 bricks across 4 stages</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ width: 38, height: 38, borderRadius: 12, background: '#fff', border: '1px solid rgba(15,23,42,.08)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <I.Filter size={16} color={rdColors.slate700}/>
          </div>
          <div style={{ width: 38, height: 38, borderRadius: 12, background: '#fff', border: '1px solid rgba(15,23,42,.08)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <I.More size={16} color={rdColors.slate700}/>
          </div>
        </div>
      </div>

      {/* Pipeline cards */}
      <div style={{ padding: '0 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {stages.map((s, i) => {
          const pct = (s.v / 64640) * 100;
          return (
            <div key={s.k} style={{
              background: '#fff', borderRadius: 16, padding: 14,
              border: '1px solid rgba(15,23,42,.06)', position: 'relative',
              borderLeft: `4px solid ${s.c}`,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 44, height: 44, borderRadius: 12, background: s.c + '18',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <div style={{ width: 14, height: 14, borderRadius: 4, background: s.c }}/>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                    <span style={{ fontSize: 14, fontWeight: 700, color: rdColors.ink }}>{s.k}</span>
                    <span className="num display" style={{ fontFamily: 'var(--rd-font-display)', fontSize: 18, fontWeight: 700, color: s.c, letterSpacing: -0.3 }}>{s.v.toLocaleString()}</span>
                  </div>
                  <div style={{ fontSize: 11, color: rdColors.slate500, marginTop: 2 }}>{s.batches} batch{s.batches > 1 ? 'es' : ''} · {s.age}</div>
                </div>
              </div>
              <div style={{ marginTop: 10, height: 4, background: rdColors.slate100, borderRadius: 2, overflow: 'hidden' }}>
                <div style={{ width: pct + '%', height: '100%', background: s.c, borderRadius: 2 }}/>
              </div>
              {s.alert && (
                <div style={{ marginTop: 10, padding: '8px 10px', background: rdColors.orange50,
                  borderRadius: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <I.Flag size={14} color={rdColors.orange}/>
                  <span style={{ fontSize: 11, fontWeight: 600, color: rdColors.orange }}>{s.alert}</span>
                  <I.ArrowRight size={12} color={rdColors.orange} style={{ marginLeft: 'auto' }}/>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Aging */}
      <div style={{ padding: '14px 18px 0' }}>
        <SectionHead title="Drying — by age" sub="Tap a batch to advance"/>
        <div style={{ background: '#fff', borderRadius: 16, padding: 12, border: '1px solid rgba(15,23,42,.06)' }}>
          {[
            { id: 'B-12', d: 3, q: 4200, ready: true },
            { id: 'B-11', d: 2, q: 5100 },
            { id: 'B-10', d: 1, q: 3000 },
          ].map(b => (
            <div key={b.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 4px', borderTop: b.id !== 'B-12' ? '1px solid rgba(15,23,42,.05)' : 'none' }}>
              <div className="mono" style={{ fontFamily: 'var(--rd-font-mono)', fontSize: 11, fontWeight: 600, color: rdColors.slate600, width: 38 }}>{b.id}</div>
              <div style={{ flex: 1, height: 6, background: rdColors.slate100, borderRadius: 3, position: 'relative', overflow: 'hidden' }}>
                <div style={{ width: (b.d / 3) * 100 + '%', height: '100%', background: b.ready ? rdColors.success : '#C97A18', borderRadius: 3 }}/>
              </div>
              <span className="num" style={{ fontSize: 11, fontWeight: 600, color: rdColors.slate700, width: 40, textAlign: 'right' }}>{b.q.toLocaleString()}</span>
              <Pill tone={b.ready ? 'success' : 'warning'}>{b.ready ? 'Ready' : `${b.d}d`}</Pill>
            </div>
          ))}
        </div>
      </div>

      <div style={{ height: 110 }}/>
      <BottomNav active="stock"/>
    </div>
  );
}

window.StockScreen = StockScreen;
