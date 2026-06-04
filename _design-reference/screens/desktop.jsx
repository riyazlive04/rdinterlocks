// RD Interlock — Desktop owner dashboard (1280×800)

function DesktopDashboard() {
  return (
    <div className="rd" style={{
      width: 1280, height: 800, background: rdColors.slate50,
      display: 'flex', overflow: 'hidden',
    }}>
      {/* Sidebar */}
      <div style={{ width: 240, background: '#fff', borderRight: '1px solid rgba(15,23,42,.06)', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '20px 22px 22px' }}>
          <BrandMark size={32}/>
        </div>
        <div style={{ padding: '0 14px', display: 'flex', flexDirection: 'column', gap: 2 }}>
          {[
            { k: 'Dashboard',  i: 'Home',   active: true },
            { k: 'Daily entry',i: 'Plus' },
            { k: 'Stock',      i: 'Stack' },
            { k: 'Workers',    i: 'Workers' },
            { k: 'Dispatch',   i: 'Truck' },
            { k: 'Cashbook',   i: 'Cash' },
            { k: 'Reports',    i: 'Chart' },
          ].map(it => {
            const Ic = I[it.i];
            return (
              <div key={it.k} style={{
                padding: '10px 12px', borderRadius: 10,
                display: 'flex', alignItems: 'center', gap: 10,
                background: it.active ? rdColors.ink : 'transparent',
                color: it.active ? '#fff' : rdColors.slate700,
                fontSize: 13, fontWeight: it.active ? 600 : 500,
              }}>
                <Ic size={17} color={it.active ? '#fff' : rdColors.slate600}/>
                <span>{it.k}</span>
                {it.active && <span style={{ marginLeft: 'auto', width: 5, height: 5, borderRadius: '50%', background: rdColors.orange }}/>}
              </div>
            );
          })}
        </div>
        <div style={{ marginTop: 'auto', padding: 14 }}>
          <div style={{ padding: 12, background: rdColors.orange50, borderRadius: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: rdColors.orange, letterSpacing: 0.5, textTransform: 'uppercase' }}>Saturday Settle</div>
            <div className="num" style={{ marginTop: 4, fontSize: 18, fontWeight: 700, color: rdColors.ink }}>₹26,200</div>
            <div style={{ fontSize: 10, color: rdColors.slate500, marginTop: 1 }}>3 days remaining</div>
          </div>
        </div>
      </div>

      {/* Main */}
      <div style={{ flex: 1, padding: '22px 28px', overflow: 'auto' }}>
        {/* Top bar */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 22 }}>
          <div>
            <div style={{ fontSize: 11, color: rdColors.slate500, fontWeight: 500 }}>Wednesday · 6 May 2026</div>
            <div className="display" style={{ fontFamily: 'var(--rd-font-display)', fontSize: 26, fontWeight: 700, color: rdColors.ink, letterSpacing: -0.5 }}>Good morning, Ramesh</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', background: '#fff', borderRadius: 10, border: '1px solid rgba(15,23,42,.06)', minWidth: 240 }}>
              <I.Search size={15} color={rdColors.slate500}/>
              <span style={{ fontSize: 13, color: rdColors.slate400 }}>Search workers, customers, batches…</span>
            </div>
            <div style={{ width: 38, height: 38, borderRadius: 10, background: '#fff', border: '1px solid rgba(15,23,42,.06)', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
              <I.Bell size={17} color={rdColors.slate700}/>
              <div style={{ position: 'absolute', top: 8, right: 9, width: 7, height: 7, borderRadius: '50%', background: rdColors.orange, border: '2px solid #fff' }}/>
            </div>
            <div style={{ padding: '6px 12px 6px 6px', background: '#fff', borderRadius: 999, border: '1px solid rgba(15,23,42,.06)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <Avatar name="Ramesh Devji" size={26} tone={rdColors.navy900}/>
              <span style={{ fontSize: 12, fontWeight: 600, color: rdColors.ink }}>Ramesh</span>
              <I.ChevronDown size={12} color={rdColors.slate500}/>
            </div>
          </div>
        </div>

        {/* KPI row */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 18 }}>
          <KPI label="Production today" value="4,820" suffix="bricks" tone="navy" delta="↑ 6.4%"
            icon={<I.Brick size={20} color="#fff"/>}
            sub="Workers: 11 of 14 · Avg 602/hr"
            sparkline={<Spark values={[3,5,4,6,7,9,8]} color={rdColors.orange}/>}
          />
          <KPI label="Ready stock" value="38,420" suffix="bricks" tone="paper" delta="↑ 2.1k"
            icon={<I.Stack size={18} color={rdColors.navy600}/>}
            sub="4 stacks · Type A 28k, Type B 10k"/>
          <KPI label="Cash balance" value="₹1.42L" tone="cream"
            icon={<I.Cash size={18} color={rdColors.orange}/>}
            sub="In ₹2.46L  ·  Out ₹1.04L"
            sparkline={<Spark values={[8,10,7,12,11,15,14]} color={rdColors.orange}/>}/>
          <KPI label="Pending payments" value="₹18,400" tone="paper" delta="↓ 4.2k" deltaDir="up"
            icon={<I.Receipt size={18} color={rdColors.slate600}/>}
            sub="6 customers · oldest 12d"/>
        </div>

        {/* Two-column */}
        <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 14 }}>
          {/* Big chart */}
          <div style={{ background: '#fff', borderRadius: 16, padding: 18, border: '1px solid rgba(15,23,42,.06)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: rdColors.ink, letterSpacing: -0.2 }}>Production this week</div>
                <div style={{ fontSize: 11, color: rdColors.slate500, marginTop: 2 }}>Stacked by brick type · vs last week dotted</div>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                {['Day','Week','Month'].map((p,i)=>(
                  <div key={p} style={{ padding: '5px 10px', borderRadius: 8, fontSize: 11, fontWeight: 600,
                    background: i===1 ? rdColors.slate100 : 'transparent', color: i===1?rdColors.ink:rdColors.slate500 }}>{p}</div>
                ))}
              </div>
            </div>

            {/* SVG chart */}
            <svg width="100%" height="240" viewBox="0 0 700 240" style={{ marginTop: 16 }}>
              {/* gridlines */}
              {[0,1,2,3,4].map(i => (
                <line key={i} x1="40" x2="690" y1={20 + i*44} y2={20 + i*44} stroke="#E2E8F0" strokeWidth="1" strokeDasharray={i===4?'0':'2 4'}/>
              ))}
              {[0,1,2,3,4].map(i => (
                <text key={i} x="32" y={24 + i*44} fontSize="9" fill="#94A3B8" fontFamily="var(--rd-font-mono)" textAnchor="end">{(6 - i*1.5).toFixed(1)}k</text>
              ))}
              {/* bars */}
              {(() => {
                const days = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
                const data = [
                  [2200, 2100, 2400, 2600, 2300, 3100, 0],   // type A
                  [1500, 1300, 1700, 1900, 1600, 2300, 0],   // type B
                  [1100, 1200, 1300, 1400, 1300, 1800, 0],   // paver
                ];
                const last = [4500, 4200, 4900, 5100, 4600, 6800, 5000];
                const colors = [rdColors.orange, rdColors.navy600, '#1F8FB3'];
                const xStep = 92, x0 = 60;
                const yScale = (v) => 196 - (v / 6500) * 176;
                return (
                  <g>
                    {/* dotted last week */}
                    <polyline points={last.map((v,i)=>`${x0 + i*xStep + 18},${yScale(v)}`).join(' ')}
                      fill="none" stroke="#94A3B8" strokeWidth="1.4" strokeDasharray="3 4"/>
                    {/* bars */}
                    {days.map((d, i) => {
                      const x = x0 + i*xStep;
                      let yCursor = 196;
                      return (
                        <g key={d}>
                          {data.map((row, ri) => {
                            const v = row[i]; if (!v) return null;
                            const h = (v / 6500) * 176;
                            yCursor -= h;
                            return <rect key={ri} x={x + 6} y={yCursor} width="36" height={h - 1.5} fill={colors[ri]} rx={ri === data.length-1 ? 4 : 0} ry={ri === data.length-1 ? 4 : 0} opacity={i === 5 ? 1 : 0.85}/>;
                          })}
                          <text x={x + 24} y="218" fontSize="10" fill={i === 5 ? rdColors.ink : rdColors.slate500} fontWeight={i === 5 ? 700 : 500} textAnchor="middle">{d}</text>
                          {i === 5 && (
                            <g>
                              <rect x={x - 8} y={yCursor - 38} width="64" height="28" rx="6" fill={rdColors.ink}/>
                              <text x={x + 24} y={yCursor - 22} fontSize="10" fill="rgba(255,255,255,.6)" textAnchor="middle">Sat · top</text>
                              <text x={x + 24} y={yCursor - 12} fontSize="11" fill="#fff" fontWeight="700" textAnchor="middle" fontFamily="var(--rd-font-mono)">7,200</text>
                            </g>
                          )}
                        </g>
                      );
                    })}
                  </g>
                );
              })()}
            </svg>

            <div style={{ display: 'flex', gap: 18, marginTop: 6, paddingLeft: 40 }}>
              {[
                { c: rdColors.orange, t: 'Type A · Standard', n: '14,600' },
                { c: rdColors.navy600, t: 'Type B · Heavy', n: '10,300' },
                { c: '#1F8FB3', t: 'Paver', n: '8,100' },
                { c: '#94A3B8', t: 'Last week', n: 'dotted' },
              ].map(l => (
                <div key={l.t} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div style={{ width: 8, height: 8, borderRadius: 2, background: l.c }}/>
                  <span style={{ fontSize: 11, color: rdColors.slate600, fontWeight: 500 }}>{l.t}</span>
                  <span className="num" style={{ fontSize: 11, color: rdColors.slate400 }}>{l.n}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Pipeline */}
          <div style={{ background: '#fff', borderRadius: 16, padding: 18, border: '1px solid rgba(15,23,42,.06)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: rdColors.ink, letterSpacing: -0.2 }}>Stock pipeline</div>
              <span style={{ fontSize: 11, fontWeight: 600, color: rdColors.navy600 }}>Manage →</span>
            </div>
            <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
              {[
                { k: 'Produced', v: 4820, c: '#F26A1F', age: 'Today',     pct: 7 },
                { k: 'Drying',   v: 12300, c: '#C97A18', age: '1–3 days', pct: 19 },
                { k: 'Curing',   v: 9100, c: '#1F8FB3', age: '4–10 days', pct: 14 },
                { k: 'Ready',    v: 38420, c: '#2F8F5A', age: 'Sellable', pct: 60 },
              ].map(s => (
                <div key={s.k}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ width: 8, height: 8, borderRadius: 2, background: s.c }}/>
                      <span style={{ fontSize: 12, fontWeight: 600, color: rdColors.ink }}>{s.k}</span>
                      <span style={{ fontSize: 10, color: rdColors.slate500 }}>{s.age}</span>
                    </div>
                    <span className="num" style={{ fontSize: 13, fontWeight: 700, color: rdColors.ink, fontFamily: 'var(--rd-font-mono)' }}>{s.v.toLocaleString()}</span>
                  </div>
                  <div style={{ marginTop: 4, height: 6, background: rdColors.slate100, borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{ width: s.pct + '%', height: '100%', background: s.c }}/>
                  </div>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 16, padding: 12, background: rdColors.orange50, borderRadius: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
              <I.Flag size={14} color={rdColors.orange}/>
              <span style={{ fontSize: 12, fontWeight: 600, color: rdColors.orange }}>Batch B-12 ready to move from Drying</span>
              <I.ArrowRight size={14} color={rdColors.orange} style={{ marginLeft: 'auto' }}/>
            </div>
          </div>
        </div>

        {/* Bottom row */}
        <div style={{ marginTop: 14, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          {/* Activity */}
          <div style={{ background: '#fff', borderRadius: 16, padding: 18, border: '1px solid rgba(15,23,42,.06)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: rdColors.ink }}>Live activity</div>
              <span style={{ fontSize: 11, fontWeight: 600, color: rdColors.slate500 }}>Last 24h</span>
            </div>
            {[
              { icon: 'Truck',  t: 'Dispatched 4,200 bricks',  s: 'Suresh Builders · ₹18,900',  time: '14m', tone: 'navy' },
              { icon: 'Plus',   t: 'Production · Lal Singh',   s: '320 bricks · Type A',         time: '1h',  tone: 'orange' },
              { icon: 'Cash',   t: 'Payment received',         s: 'Manjit Singh · ₹12,000',     time: '3h',  tone: 'success' },
              { icon: 'Workers',t: 'Babu Lal marked leave',    s: 'Half day · approved',         time: '5h',  tone: 'slate' },
            ].map((a, i) => {
              const Ic = I[a.icon];
              const tones = {
                navy:    { bg: rdColors.navy50, fg: rdColors.navy800 },
                orange:  { bg: rdColors.orange50, fg: rdColors.orange },
                success: { bg: '#DCFCE7', fg: '#166534' },
                slate:   { bg: rdColors.slate100, fg: rdColors.slate600 },
              };
              const t = tones[a.tone];
              return (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderTop: i ? '1px solid rgba(15,23,42,.05)' : 'none' }}>
                  <div style={{ width: 32, height: 32, borderRadius: 9, background: t.bg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Ic size={16} color={t.fg}/>
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: rdColors.ink }}>{a.t}</div>
                    <div style={{ fontSize: 11, color: rdColors.slate500 }}>{a.s}</div>
                  </div>
                  <span style={{ fontSize: 11, color: rdColors.slate400, fontFamily: 'var(--rd-font-mono)' }}>{a.time}</span>
                </div>
              );
            })}
          </div>

          {/* Workers leaderboard */}
          <div style={{ background: '#fff', borderRadius: 16, padding: 18, border: '1px solid rgba(15,23,42,.06)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: rdColors.ink }}>Top workers · this week</div>
              <span style={{ fontSize: 11, fontWeight: 600, color: rdColors.navy600 }}>Wage settle →</span>
            </div>
            {[
              { n: 'Suresh Patel', q: 2210, w: 2652, pct: 100 },
              { n: 'Lal Singh',    q: 1820, w: 2184, pct: 82 },
              { n: 'Mohan Kumar',  q: 1640, w: 1968, pct: 74 },
              { n: 'Karan Devji',  q: 1320, w: 1584, pct: 60 },
              { n: 'Vikram Yadav', q: 1180, w: 1416, pct: 53 },
            ].map((w, i) => (
              <div key={w.n} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderTop: i ? '1px solid rgba(15,23,42,.05)' : 'none' }}>
                <span className="num" style={{ width: 18, fontSize: 11, fontWeight: 600, color: rdColors.slate400, textAlign: 'center' }}>{i+1}</span>
                <Avatar name={w.n} size={28}/>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: rdColors.ink }}>{w.n}</div>
                  <div style={{ marginTop: 4, height: 4, background: rdColors.slate100, borderRadius: 2, overflow: 'hidden' }}>
                    <div style={{ width: w.pct + '%', height: '100%', background: i === 0 ? rdColors.orange : rdColors.navy600, borderRadius: 2 }}/>
                  </div>
                </div>
                <span className="num" style={{ fontSize: 12, fontWeight: 700, color: rdColors.ink, fontFamily: 'var(--rd-font-mono)' }}>{w.q.toLocaleString()}</span>
                <span className="num" style={{ fontSize: 11, color: rdColors.slate500, width: 56, textAlign: 'right' }}>₹{w.w}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

window.DesktopDashboard = DesktopDashboard;
