// RD Interlock — Dashboard screen (mobile, 360x780)

const screenW = 360, screenH = 780;

function DashboardScreen() {
  return (
    <div className="rd" style={{
      width: screenW, height: screenH, position: 'relative',
      background: rdColors.paper, overflow: 'hidden',
      fontFamily: 'var(--rd-font-ui)',
    }}>
      <PhoneStatus/>

      {/* Header */}
      <div style={{ padding: '4px 18px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Avatar name="Ramesh Devji" size={40} tone={rdColors.navy900}/>
          <div style={{ lineHeight: 1.2 }}>
            <div style={{ fontSize: 11, color: rdColors.slate500, fontWeight: 500 }}>Wednesday · May 6</div>
            <div style={{ fontSize: 16, color: rdColors.ink, fontWeight: 700, letterSpacing: -0.2 }}>Hi, Ramesh</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ width: 38, height: 38, borderRadius: 12, background: '#fff', border: '1px solid rgba(15,23,42,.08)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <I.Search size={18} color={rdColors.slate700}/>
          </div>
          <div style={{ width: 38, height: 38, borderRadius: 12, background: '#fff', border: '1px solid rgba(15,23,42,.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
            <I.Bell size={18} color={rdColors.slate700}/>
            <div style={{ position: 'absolute', top: 8, right: 8, width: 7, height: 7, borderRadius: '50%', background: rdColors.orange, border: '2px solid #fff' }}/>
          </div>
        </div>
      </div>

      {/* Hero KPI — Today's production */}
      <div style={{ margin: '0 18px 14px', borderRadius: 22, overflow: 'hidden', position: 'relative',
        background: `linear-gradient(135deg, ${rdColors.navy900} 0%, #14305E 60%, #1B3F7A 100%)`,
        color: '#fff', padding: 18,
        boxShadow: '0 12px 28px rgba(14,33,67,.28)',
      }}>
        {/* decorative bricks */}
        <svg width="160" height="160" viewBox="0 0 160 160" style={{ position: 'absolute', right: -20, top: -20, opacity: 0.07 }}>
          <g fill="#fff">
            <rect x="0"  y="0"  width="36" height="22" rx="2"/>
            <rect x="40" y="0"  width="36" height="22" rx="2"/>
            <rect x="80" y="0"  width="36" height="22" rx="2"/>
            <rect x="20" y="26" width="36" height="22" rx="2"/>
            <rect x="60" y="26" width="36" height="22" rx="2"/>
            <rect x="100" y="26" width="36" height="22" rx="2"/>
            <rect x="0"  y="52" width="36" height="22" rx="2"/>
            <rect x="40" y="52" width="36" height="22" rx="2"/>
            <rect x="80" y="52" width="36" height="22" rx="2"/>
          </g>
        </svg>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'relative' }}>
          <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: 1, textTransform: 'uppercase', color: 'rgba(255,255,255,.7)' }}>Production today</span>
          <Pill tone="orange">LIVE</Pill>
        </div>
        <div style={{ marginTop: 10, display: 'flex', alignItems: 'baseline', gap: 6, position: 'relative' }}>
          <span className="display num" style={{ fontFamily: 'var(--rd-font-display)', fontSize: 48, fontWeight: 700, lineHeight: 1, letterSpacing: -1 }}>4,820</span>
          <span style={{ fontSize: 14, fontWeight: 500, color: 'rgba(255,255,255,.7)' }}>bricks</span>
        </div>
        <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 10, position: 'relative' }}>
          <div style={{ flex: 1, height: 6, background: 'rgba(255,255,255,.15)', borderRadius: 3, overflow: 'hidden' }}>
            <div style={{ width: '74%', height: '100%', background: rdColors.orange, borderRadius: 3 }}/>
          </div>
          <span className="num" style={{ fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,.85)' }}>74% of 6,500</span>
        </div>

        <div style={{ marginTop: 14, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, position: 'relative' }}>
          {[
            ['Workers', '11', '/14'],
            ['Avg/hr', '602', 'b'],
            ['Wage today', '₹3,820', null],
          ].map(([k,v,sfx])=>(
            <div key={k} style={{ background: 'rgba(255,255,255,.08)', borderRadius: 12, padding: '8px 10px' }}>
              <div style={{ fontSize: 9, fontWeight: 600, letterSpacing: 0.5, textTransform: 'uppercase', color: 'rgba(255,255,255,.6)' }}>{k}</div>
              <div className="num" style={{ marginTop: 2, fontSize: 16, fontWeight: 700 }}>{v}<span style={{ fontSize: 11, color: 'rgba(255,255,255,.6)', marginLeft: 2, fontWeight: 500 }}>{sfx}</span></div>
            </div>
          ))}
        </div>
      </div>

      {/* KPI grid */}
      <div style={{ padding: '0 18px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
        <KPI label="Ready Stock" value="38,420" suffix="bricks" tone="paper" delta="↑ 2.1k" deltaDir="up"
          icon={<I.Stack size={18} color={rdColors.navy600}/>}
          sub="Across 4 stacks"
        />
        <KPI label="Cash Balance" value="₹1.42L" tone="cream"
          icon={<I.Cash size={18} color={rdColors.orange}/>}
          sub="Updated 2h ago"
          sparkline={<Spark values={[8,10,7,12,11,15,14]} color={rdColors.orange}/>}
        />
        <KPI label="Pending Pay" value="₹18,400" tone="paper"
          icon={<I.Receipt size={18} color={rdColors.slate600}/>}
          sub="6 customers · oldest 12d"
        />
        <KPI label="Wage Settle" value="₹26,200" tone="paper"
          icon={<I.Workers size={18} color={rdColors.slate600}/>}
          sub="Sat · 14 workers"
        />
      </div>

      {/* Stock pipeline strip */}
      <SectionHead title="Stock pipeline" action="View all"/>
      <div style={{ padding: '0 18px', marginBottom: 16 }}>
        <div style={{ background: '#fff', borderRadius: 18, padding: 14, border: '1px solid rgba(15,23,42,.06)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 0, alignItems: 'center' }}>
            {[
              { k: 'Produced', v: '4.8k', c: '#F26A1F' },
              { k: 'Drying',   v: '12.3k', c: '#C97A18' },
              { k: 'Curing',   v: '9.1k',  c: '#1F8FB3' },
              { k: 'Ready',    v: '38.4k', c: '#2F8F5A' },
            ].map((s, i, arr) => (
              <React.Fragment key={s.k}>
                <div style={{ textAlign: 'center', position: 'relative' }}>
                  <div style={{
                    width: 36, height: 36, borderRadius: 10, margin: '0 auto',
                    background: s.c + '18', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    border: `2px solid ${s.c}`,
                  }}>
                    <div style={{ width: 10, height: 10, borderRadius: 3, background: s.c }}/>
                  </div>
                  <div className="num" style={{ marginTop: 6, fontSize: 14, fontWeight: 700, color: rdColors.ink }}>{s.v}</div>
                  <div style={{ fontSize: 10, color: rdColors.slate500, fontWeight: 500 }}>{s.k}</div>
                </div>
                {i < arr.length - 1 && (
                  <div style={{ position: 'absolute' }}/>
                )}
              </React.Fragment>
            ))}
          </div>
          {/* connecting line */}
          <div style={{ position: 'relative', height: 0, marginTop: -42 }}>
            <div style={{ position: 'absolute', left: '12.5%', right: '12.5%', height: 2, background: 'repeating-linear-gradient(90deg, rgba(15,23,42,.18) 0 4px, transparent 4px 8px)' }}/>
          </div>
        </div>
      </div>

      {/* Activity */}
      <SectionHead title="Recent activity" action="See log"/>
      <div style={{ padding: '0 18px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {[
          { icon: 'Truck',  t: 'Dispatched 4,200 bricks', s: 'to Suresh Builders · ₹18,900', tone: 'navy', time: '14m' },
          { icon: 'Plus',   t: 'Production entry · Lal',   s: '320 bricks · Type A',          tone: 'orange', time: '1h' },
          { icon: 'Cash',   t: 'Cash received',            s: 'from Manjit Singh · ₹12,000',  tone: 'success', time: '3h' },
        ].map((a, i) => {
          const Ic = I[a.icon];
          const bg = a.tone === 'navy' ? rdColors.navy50 : a.tone === 'orange' ? rdColors.orange50 : '#DCFCE7';
          const fg = a.tone === 'navy' ? rdColors.navy800 : a.tone === 'orange' ? rdColors.orange : '#166534';
          return (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 12, background: '#fff', borderRadius: 14, border: '1px solid rgba(15,23,42,.06)' }}>
              <div style={{ width: 36, height: 36, borderRadius: 10, background: bg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Ic size={18} color={fg}/>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: rdColors.ink }}>{a.t}</div>
                <div style={{ fontSize: 11, color: rdColors.slate500, marginTop: 1 }}>{a.s}</div>
              </div>
              <div style={{ fontSize: 11, color: rdColors.slate400, fontWeight: 500 }}>{a.time}</div>
            </div>
          );
        })}
      </div>

      <div style={{ height: 110 }}/>
      <BottomNav active="home"/>
    </div>
  );
}

window.DashboardScreen = DashboardScreen;
