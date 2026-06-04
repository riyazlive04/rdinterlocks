// RD Interlock — Workers & Wages screen

function WorkersScreen() {
  const workers = [
    { name: 'Lal Singh', tag: 'Senior · 6yr', today: 320, week: 1820, advance: 800, status: 'present' },
    { name: 'Mohan Kumar', tag: 'Brick layer', today: 280, week: 1640, advance: 0, status: 'present' },
    { name: 'Suresh Patel', tag: 'Brick layer', today: 410, week: 2210, advance: 1500, status: 'present' },
    { name: 'Karan Devji', tag: 'Trainee', today: 240, week: 1320, advance: 0, status: 'present' },
    { name: 'Vikram Yadav', tag: 'Brick layer', today: 0, week: 1180, advance: 600, status: 'absent' },
    { name: 'Babu Lal', tag: 'Helper', today: 0, week: 720, advance: 0, status: 'leave' },
  ];

  return (
    <div className="rd" style={{ width: 360, height: 780, position: 'relative', background: rdColors.paper, overflow: 'hidden' }}>
      <PhoneStatus/>
      <div style={{ padding: '4px 18px 14px', display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 17, fontWeight: 700, color: rdColors.ink, letterSpacing: -0.3 }}>Workers & Wages</div>
          <div style={{ fontSize: 11, color: rdColors.slate500 }}>Week of 5–11 May</div>
        </div>
        <div style={{ width: 38, height: 38, borderRadius: 12, background: rdColors.ink, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <I.Plus size={18} color="#fff" stroke={2.2}/>
        </div>
      </div>

      {/* Settlement card */}
      <div style={{ margin: '0 18px 14px', borderRadius: 18,
        background: `linear-gradient(135deg, ${rdColors.navy900} 0%, #14305E 100%)`,
        color: '#fff', padding: 16, position: 'relative', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: 0.5, textTransform: 'uppercase', color: 'rgba(255,255,255,.65)' }}>Saturday Settlement</div>
            <div style={{ marginTop: 6, display: 'flex', alignItems: 'baseline', gap: 6 }}>
              <span className="display num" style={{ fontFamily: 'var(--rd-font-display)', fontSize: 32, fontWeight: 700, letterSpacing: -0.8 }}>₹26,200</span>
              <span style={{ fontSize: 12, color: 'rgba(255,255,255,.65)' }}>· 14 workers</span>
            </div>
          </div>
        </div>
        <div style={{ marginTop: 14, display: 'flex', gap: 8 }}>
          <div style={{ flex: 1, padding: '8px 10px', background: 'rgba(255,255,255,.08)', borderRadius: 10 }}>
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,.6)' }}>Earned</div>
            <div className="num" style={{ fontSize: 14, fontWeight: 700 }}>₹31,400</div>
          </div>
          <div style={{ flex: 1, padding: '8px 10px', background: 'rgba(255,255,255,.08)', borderRadius: 10 }}>
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,.6)' }}>Advances</div>
            <div className="num" style={{ fontSize: 14, fontWeight: 700, color: rdColors.orange }}>−₹5,200</div>
          </div>
          <div style={{ flex: 1, padding: '8px 10px', background: 'rgba(255,255,255,.08)', borderRadius: 10 }}>
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,.6)' }}>Days left</div>
            <div className="num" style={{ fontSize: 14, fontWeight: 700 }}>3</div>
          </div>
        </div>
      </div>

      {/* Tab strip */}
      <div style={{ padding: '0 18px 12px' }}>
        <div style={{ display: 'flex', gap: 6 }}>
          {[
            { k: 'All', n: 14, sel: true },
            { k: 'Present', n: 11 },
            { k: 'Absent', n: 2 },
            { k: 'Leave', n: 1 },
          ].map(t => (
            <div key={t.k} style={{
              padding: '7px 12px', borderRadius: 999,
              background: t.sel ? rdColors.ink : '#fff',
              color: t.sel ? '#fff' : rdColors.slate700,
              border: t.sel ? 'none' : '1px solid rgba(15,23,42,.08)',
              fontSize: 12, fontWeight: 600,
            }}>{t.k} <span style={{ opacity: 0.7, marginLeft: 2 }}>· {t.n}</span></div>
          ))}
        </div>
      </div>

      {/* List */}
      <div style={{ padding: '0 18px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {workers.map(w => (
          <div key={w.name} style={{ background: '#fff', borderRadius: 14, padding: 12, border: '1px solid rgba(15,23,42,.06)', display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ position: 'relative' }}>
              <Avatar name={w.name} size={40}/>
              <div style={{ position: 'absolute', bottom: -2, right: -2, width: 12, height: 12, borderRadius: '50%',
                background: w.status === 'present' ? rdColors.success : w.status === 'absent' ? rdColors.danger : rdColors.warning,
                border: '2px solid #fff' }}/>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: rdColors.ink }}>{w.name}</div>
              <div style={{ fontSize: 10, color: rdColors.slate500, marginTop: 1 }}>{w.tag}</div>
              <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                <span className="num" style={{ fontSize: 10, fontWeight: 600, color: rdColors.slate700, padding: '2px 6px', background: rdColors.slate100, borderRadius: 4 }}>Today {w.today}</span>
                <span className="num" style={{ fontSize: 10, fontWeight: 600, color: rdColors.navy800, padding: '2px 6px', background: rdColors.navy50, borderRadius: 4 }}>Week {w.week}</span>
                {w.advance > 0 && <span className="num" style={{ fontSize: 10, fontWeight: 600, color: rdColors.orange, padding: '2px 6px', background: rdColors.orange50, borderRadius: 4 }}>Adv ₹{w.advance}</span>}
              </div>
            </div>
            <I.Chevron size={16} color={rdColors.slate400}/>
          </div>
        ))}
      </div>

      <div style={{ height: 100 }}/>
      <BottomNav active="workers"/>
    </div>
  );
}

window.WorkersScreen = WorkersScreen;
