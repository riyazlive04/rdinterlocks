// RD Interlock — Reports + Worker Detail bottom sheet + Empty/Onboarding

function ReportsScreen() {
  // Stacked bar data: production by day x worker
  const days = ['Mo','Tu','We','Th','Fr','Sa','Su'];
  const data = [
    [820, 760, 940, 1020, 880, 1180, 0],
    [620, 540, 680, 720, 600,  880, 0],
    [480, 510, 520, 560, 540,  720, 0],
  ];
  const colors = [rdColors.orange, rdColors.navy600, '#1F8FB3'];
  const totals = days.map((_, i) => data.reduce((s, row) => s + row[i], 0));
  const max = Math.max(...totals);

  return (
    <div className="rd" style={{ width: 360, height: 780, position: 'relative', background: rdColors.paper, overflow: 'hidden' }}>
      <PhoneStatus/>
      <div style={{ padding: '4px 18px 14px', display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 17, fontWeight: 700, color: rdColors.ink, letterSpacing: -0.3 }}>Reports</div>
          <div style={{ fontSize: 11, color: rdColors.slate500 }}>This week vs last</div>
        </div>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 999, background: '#fff', border: '1px solid rgba(15,23,42,.08)' }}>
          <I.Calendar size={14} color={rdColors.slate700}/>
          <span style={{ fontSize: 12, fontWeight: 600, color: rdColors.slate700 }}>Week</span>
          <I.ChevronDown size={12} color={rdColors.slate500}/>
        </div>
      </div>

      {/* Period toggles */}
      <div style={{ padding: '0 18px 14px' }}>
        <div style={{ background: rdColors.slate100, borderRadius: 12, padding: 4, display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 4 }}>
          {['Day','Week','Month','Year'].map((p, i) => (
            <div key={p} style={{
              textAlign: 'center', padding: '8px 0', borderRadius: 9,
              background: i === 1 ? '#fff' : 'transparent',
              boxShadow: i === 1 ? '0 1px 3px rgba(15,23,42,.08)' : 'none',
              fontSize: 12, fontWeight: i === 1 ? 600 : 500,
              color: i === 1 ? rdColors.ink : rdColors.slate500,
            }}>{p}</div>
          ))}
        </div>
      </div>

      {/* Big number */}
      <div style={{ padding: '0 18px 14px' }}>
        <div style={{ background: '#fff', borderRadius: 18, padding: 16, border: '1px solid rgba(15,23,42,.06)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: 0.5, textTransform: 'uppercase', color: rdColors.slate500 }}>Total bricks made</span>
            <Pill tone="success">↑ 12.4%</Pill>
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 4 }}>
            <span className="display num" style={{ fontFamily: 'var(--rd-font-display)', fontSize: 36, fontWeight: 700, color: rdColors.ink, letterSpacing: -0.8 }}>26,420</span>
            <span style={{ fontSize: 12, color: rdColors.slate500 }}>vs 23,500 last wk</span>
          </div>

          {/* stacked bars */}
          <div style={{ marginTop: 16, height: 140, display: 'flex', alignItems: 'flex-end', gap: 8, justifyContent: 'space-between' }}>
            {days.map((d, i) => (
              <div key={d} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                <div style={{
                  width: '100%', maxWidth: 28,
                  height: (totals[i] / max) * 110, minHeight: totals[i] ? 4 : 0,
                  borderRadius: 4, overflow: 'hidden',
                  display: 'flex', flexDirection: 'column-reverse',
                  background: totals[i] ? 'transparent' : rdColors.slate100,
                }}>
                  {data.map((row, ri) => (
                    <div key={ri} style={{
                      height: totals[i] ? (row[i] / totals[i]) * 100 + '%' : 0,
                      background: colors[ri],
                      opacity: i === 5 ? 1 : 0.85,
                    }}/>
                  ))}
                </div>
                <span style={{ fontSize: 10, color: i === 5 ? rdColors.ink : rdColors.slate500, fontWeight: i === 5 ? 700 : 500 }}>{d}</span>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 12, marginTop: 12, justifyContent: 'center' }}>
            {[
              { c: rdColors.orange, t: 'Type A' },
              { c: rdColors.navy600, t: 'Type B' },
              { c: '#1F8FB3', t: 'Paver' },
            ].map(l => (
              <div key={l.t} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <div style={{ width: 8, height: 8, borderRadius: 2, background: l.c }}/>
                <span style={{ fontSize: 10, color: rdColors.slate600, fontWeight: 500 }}>{l.t}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Insights */}
      <div style={{ padding: '0 18px' }}>
        <SectionHead title="Insights" sub="Auto-generated from this week"/>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {[
            { tone: 'success', icon: 'ArrowUp', t: 'Saturday was your best day', s: '5,220 bricks · 22% above weekly average' },
            { tone: 'warning', icon: 'Clock',   t: 'Drying batch B-12 is overdue', s: 'Move to curing — saves 1 day cycle' },
            { tone: 'info',    icon: 'Workers', t: 'Suresh leads production',     s: '2,210 bricks this week · ₹2,652 wage' },
          ].map((it, i) => {
            const Ic = I[it.icon];
            const tones = {
              success: { bg: '#DCFCE7', fg: '#166534' },
              warning: { bg: rdColors.orange50, fg: rdColors.orange },
              info:    { bg: rdColors.navy50, fg: rdColors.navy800 },
            };
            const t = tones[it.tone];
            return (
              <div key={i} style={{ display: 'flex', gap: 12, padding: 12, background: '#fff', borderRadius: 14, border: '1px solid rgba(15,23,42,.06)' }}>
                <div style={{ width: 32, height: 32, borderRadius: 9, background: t.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <Ic size={16} color={t.fg}/>
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: rdColors.ink, lineHeight: 1.3 }}>{it.t}</div>
                  <div style={{ fontSize: 11, color: rdColors.slate500, marginTop: 2 }}>{it.s}</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div style={{ height: 100 }}/>
      <BottomNav active="home"/>
    </div>
  );
}

// Worker detail view as a "bottom sheet" — shown in a phone with the dashboard dimmed behind
function WorkerSheetScreen() {
  return (
    <div className="rd" style={{ width: 360, height: 780, position: 'relative', overflow: 'hidden' }}>
      {/* Backdrop: faint dashboard */}
      <div style={{ position: 'absolute', inset: 0, background: rdColors.paper, filter: 'blur(2px)' }}>
        <PhoneStatus/>
        <div style={{ padding: 18, opacity: 0.5 }}>
          <div style={{ fontSize: 17, fontWeight: 700 }}>Workers & Wages</div>
          <div style={{ marginTop: 16, height: 80, background: '#fff', borderRadius: 16 }}/>
          <div style={{ marginTop: 10, height: 80, background: '#fff', borderRadius: 16 }}/>
          <div style={{ marginTop: 10, height: 80, background: '#fff', borderRadius: 16 }}/>
        </div>
      </div>
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(11,18,32,.45)' }}/>

      {/* Sheet */}
      <div style={{
        position: 'absolute', bottom: 0, left: 0, right: 0,
        background: '#fff', borderTopLeftRadius: 28, borderTopRightRadius: 28,
        padding: '14px 0 28px',
        boxShadow: '0 -12px 40px rgba(11,18,32,.25)',
      }}>
        <div style={{ width: 44, height: 4, borderRadius: 2, background: rdColors.slate300, margin: '0 auto 18px' }}/>

        <div style={{ padding: '0 22px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <Avatar name="Suresh Patel" size={56} tone={rdColors.navy900}/>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 18, fontWeight: 700, color: rdColors.ink, letterSpacing: -0.3 }}>Suresh Patel</div>
              <div style={{ fontSize: 11, color: rdColors.slate500 }}>Brick layer · joined Mar 2023</div>
              <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                <Pill tone="navy">@ ₹1.20/brick</Pill>
                <Pill tone="success">Present</Pill>
              </div>
            </div>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: rdColors.slate100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <I.Phone size={16} color={rdColors.navy900}/>
            </div>
          </div>

          {/* Stat row */}
          <div style={{ marginTop: 18, display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8 }}>
            {[
              { l: 'Today',   v: '410',   s: 'bricks' },
              { l: 'Week',    v: '2,210', s: 'bricks' },
              { l: 'Earned',  v: '₹2,652',s: 'this wk' },
            ].map(s => (
              <div key={s.l} style={{ padding: 10, background: rdColors.slate50, borderRadius: 12 }}>
                <div style={{ fontSize: 10, color: rdColors.slate500, fontWeight: 600, letterSpacing: 0.5, textTransform: 'uppercase' }}>{s.l}</div>
                <div className="num display" style={{ fontFamily: 'var(--rd-font-display)', fontSize: 18, fontWeight: 700, color: rdColors.ink, letterSpacing: -0.3, marginTop: 2 }}>{s.v}</div>
                <div style={{ fontSize: 10, color: rdColors.slate500 }}>{s.s}</div>
              </div>
            ))}
          </div>

          {/* Daily timeline */}
          <div style={{ marginTop: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
              <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: 0.5, textTransform: 'uppercase', color: rdColors.slate500 }}>Last 7 days</span>
              <span style={{ fontSize: 11, color: rdColors.slate500 }}>Avg 316/day</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 60 }}>
              {[280, 320, 410, 290, 380, 410, 120].map((v, i) => (
                <div key={i} style={{ flex: 1, height: (v/420)*100 + '%',
                  background: i === 6 ? rdColors.slate200 : i === 2 || i === 5 ? rdColors.orange : rdColors.navy600,
                  borderRadius: 4, position: 'relative' }}>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
              {['Mo','Tu','We','Th','Fr','Sa','Su'].map((d, i) => (
                <span key={d} style={{ fontSize: 10, color: rdColors.slate500, fontWeight: i === 5 ? 700 : 500, flex: 1, textAlign: 'center' }}>{d}</span>
              ))}
            </div>
          </div>

          {/* Wage preview */}
          <div style={{ marginTop: 16, padding: 14, borderRadius: 14,
            background: `linear-gradient(135deg, ${rdColors.orange50} 0%, #fff 100%)`,
            border: '1px solid ' + rdColors.orange100 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: 0.5, textTransform: 'uppercase', color: rdColors.orange }}>Saturday wage preview</span>
              <span style={{ fontSize: 10, color: rdColors.slate500 }}>3 days left</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 6 }}>
              <div className="display num" style={{ fontFamily: 'var(--rd-font-display)', fontSize: 26, fontWeight: 700, color: rdColors.ink, letterSpacing: -0.5 }}>₹1,152</div>
              <div style={{ fontSize: 11, color: rdColors.slate500 }}>₹2,652 earned − ₹1,500 advance</div>
            </div>
          </div>

          {/* Actions */}
          <div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <div style={{ padding: 12, background: rdColors.slate100, borderRadius: 12, textAlign: 'center', fontSize: 13, fontWeight: 600, color: rdColors.slate700 }}>Give advance</div>
            <div style={{ padding: 12, background: rdColors.ink, color: '#fff', borderRadius: 12, textAlign: 'center', fontSize: 13, fontWeight: 600 }}>Mark attendance</div>
          </div>
        </div>
      </div>
    </div>
  );
}

window.ReportsScreen = ReportsScreen;
window.WorkerSheetScreen = WorkerSheetScreen;
