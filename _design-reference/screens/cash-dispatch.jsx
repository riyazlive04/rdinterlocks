// RD Interlock — Cashbook + Dispatch screens

function CashbookScreen() {
  const entries = [
    { d: '6 May', day: 'Today', items: [
      { t: 'Suresh Builders', s: 'Dispatch · 4,200 bricks', a: 18900, dir: 'in', cat: 'sales' },
      { t: 'Diesel — JCB',    s: '60 L · ₹95', a: -5700, dir: 'out', cat: 'fuel' },
      { t: 'Mohan — advance', s: 'Worker advance', a: -1500, dir: 'out', cat: 'wages' },
    ]},
    { d: '5 May', day: 'Yesterday', items: [
      { t: 'Manjit Singh',    s: 'Cash payment', a: 12000, dir: 'in', cat: 'sales' },
      { t: 'Cement — 8 bags', s: 'Raw material', a: -3200, dir: 'out', cat: 'material' },
    ]},
  ];
  const catColors = { sales: rdColors.success, fuel: rdColors.warning, wages: rdColors.orange, material: rdColors.navy600 };

  return (
    <div className="rd" style={{ width: 360, height: 780, position: 'relative', background: rdColors.paper, overflow: 'hidden' }}>
      <PhoneStatus/>
      <div style={{ padding: '4px 18px 14px', display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 17, fontWeight: 700, color: rdColors.ink, letterSpacing: -0.3 }}>Cashbook</div>
          <div style={{ fontSize: 11, color: rdColors.slate500 }}>May · running balance</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ width: 38, height: 38, borderRadius: 12, background: '#fff', border: '1px solid rgba(15,23,42,.08)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <I.Calendar size={16} color={rdColors.slate700}/>
          </div>
          <div style={{ width: 38, height: 38, borderRadius: 12, background: rdColors.ink, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <I.Plus size={18} color="#fff" stroke={2.2}/>
          </div>
        </div>
      </div>

      {/* Balance card with passbook feel */}
      <div style={{ margin: '0 18px 14px', padding: 16, borderRadius: 18,
        background: `radial-gradient(120% 100% at 0% 0%, ${rdColors.orange50} 0%, #fff 60%)`,
        border: '1px solid rgba(15,23,42,.06)' }}>
        <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: 0.5, textTransform: 'uppercase', color: rdColors.slate500 }}>Cash in hand</div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 4 }}>
          <span className="display num" style={{ fontFamily: 'var(--rd-font-display)', fontSize: 38, fontWeight: 700, color: rdColors.ink, letterSpacing: -1 }}>₹1,42,300</span>
          <Pill tone="success">↑ 6.2k today</Pill>
        </div>
        <div style={{ marginTop: 14, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div style={{ padding: 10, background: '#fff', borderRadius: 12, border: '1px solid rgba(15,23,42,.05)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <I.ArrowDown size={12} color={rdColors.success}/>
              <span style={{ fontSize: 10, fontWeight: 600, color: rdColors.slate500, textTransform: 'uppercase', letterSpacing: 0.5 }}>In · this month</span>
            </div>
            <div className="num" style={{ marginTop: 4, fontSize: 17, fontWeight: 700, color: rdColors.ink }}>₹2,46,500</div>
          </div>
          <div style={{ padding: 10, background: '#fff', borderRadius: 12, border: '1px solid rgba(15,23,42,.05)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <I.ArrowUp size={12} color={rdColors.danger}/>
              <span style={{ fontSize: 10, fontWeight: 600, color: rdColors.slate500, textTransform: 'uppercase', letterSpacing: 0.5 }}>Out · this month</span>
            </div>
            <div className="num" style={{ marginTop: 4, fontSize: 17, fontWeight: 700, color: rdColors.ink }}>₹1,04,200</div>
          </div>
        </div>
      </div>

      {/* Quick category chips */}
      <div style={{ padding: '0 18px 12px', display: 'flex', gap: 6, overflowX: 'auto' }}>
        {['All','Sales','Wages','Fuel','Material','Other'].map((c,i)=>(
          <div key={c} style={{
            padding: '6px 12px', borderRadius: 999,
            background: i === 0 ? rdColors.ink : '#fff',
            color: i === 0 ? '#fff' : rdColors.slate700,
            border: i === 0 ? 'none' : '1px solid rgba(15,23,42,.08)',
            fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap',
          }}>{c}</div>
        ))}
      </div>

      {/* Ledger */}
      <div style={{ padding: '0 18px' }}>
        {entries.map(grp => (
          <div key={grp.d} style={{ marginBottom: 10 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', padding: '4px 4px 8px' }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: rdColors.slate500, textTransform: 'uppercase', letterSpacing: 0.5 }}>{grp.day} · {grp.d}</span>
            </div>
            <div style={{ background: '#fff', borderRadius: 14, border: '1px solid rgba(15,23,42,.06)', overflow: 'hidden' }}>
              {grp.items.map((it, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 12, borderTop: i ? '1px solid rgba(15,23,42,.05)' : 'none' }}>
                  <div style={{ width: 4, alignSelf: 'stretch', borderRadius: 2, background: catColors[it.cat] }}/>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: rdColors.ink }}>{it.t}</div>
                    <div style={{ fontSize: 11, color: rdColors.slate500, marginTop: 1 }}>{it.s}</div>
                  </div>
                  <div className="num" style={{ fontSize: 14, fontWeight: 700, color: it.dir === 'in' ? rdColors.success : rdColors.ink }}>
                    {it.dir === 'in' ? '+' : '−'}₹{Math.abs(it.a).toLocaleString()}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div style={{ height: 100 }}/>
      <BottomNav active="cash"/>
    </div>
  );
}

function DispatchScreen() {
  return (
    <div className="rd" style={{ width: 360, height: 780, position: 'relative', background: rdColors.paper, overflow: 'hidden' }}>
      <PhoneStatus/>
      <div style={{ padding: '4px 18px 14px', display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ width: 38, height: 38, borderRadius: 12, background: '#fff', border: '1px solid rgba(15,23,42,.08)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <I.ChevronLeft size={18} color={rdColors.ink}/>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 17, fontWeight: 700, color: rdColors.ink, letterSpacing: -0.3 }}>New Dispatch</div>
          <div style={{ fontSize: 11, color: rdColors.slate500 }}>Step 2 of 3</div>
        </div>
        <Pill tone="dark">Draft</Pill>
      </div>

      {/* Stepper */}
      <div style={{ padding: '0 18px 14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {[1,2,3].map(s => (
            <React.Fragment key={s}>
              <div style={{ width: 22, height: 22, borderRadius: 11,
                background: s <= 2 ? rdColors.orange : '#fff',
                border: s <= 2 ? 'none' : '1px solid rgba(15,23,42,.15)',
                color: s <= 2 ? '#fff' : rdColors.slate500,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 11, fontWeight: 700,
              }}>{s < 2 ? '✓' : s}</div>
              {s < 3 && <div style={{ flex: 1, height: 2, background: s < 2 ? rdColors.orange : rdColors.slate200, borderRadius: 1 }}/>}
            </React.Fragment>
          ))}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: 10, color: rdColors.slate500, fontWeight: 600 }}>
          <span>Customer</span><span style={{ color: rdColors.orange }}>Bricks & Truck</span><span>Payment</span>
        </div>
      </div>

      {/* Customer card */}
      <div style={{ padding: '0 18px 12px' }}>
        <div style={{ background: '#fff', padding: 14, borderRadius: 14, border: '1px solid rgba(15,23,42,.06)', display: 'flex', alignItems: 'center', gap: 12 }}>
          <Avatar name="Suresh Builders" size={40} tone={rdColors.navy900}/>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: rdColors.ink }}>Suresh Builders</div>
            <div style={{ fontSize: 11, color: rdColors.slate500 }}>Sector 14, Jaipur · ₹4,200 due</div>
          </div>
          <I.Pencil size={16} color={rdColors.slate400}/>
        </div>
      </div>

      {/* Quantity */}
      <div style={{ padding: '0 18px 12px' }}>
        <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: 0.5, textTransform: 'uppercase', color: rdColors.slate500, marginBottom: 8 }}>Bricks to dispatch</div>
        <div style={{ background: '#fff', borderRadius: 16, padding: 16, border: '1px solid rgba(15,23,42,.06)' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
            <div>
              <div className="display num" style={{ fontFamily: 'var(--rd-font-display)', fontSize: 36, fontWeight: 700, color: rdColors.ink, letterSpacing: -0.8 }}>4,200</div>
              <div style={{ fontSize: 11, color: rdColors.slate500 }}>Type A · @ ₹4.50</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div className="num" style={{ fontSize: 18, fontWeight: 700, color: rdColors.orange }}>₹18,900</div>
              <div style={{ fontSize: 10, color: rdColors.slate500 }}>Total</div>
            </div>
          </div>
          <div style={{ marginTop: 12, height: 8, background: rdColors.slate100, borderRadius: 4, overflow: 'hidden' }}>
            <div style={{ width: '11%', height: '100%', background: rdColors.success, borderRadius: 4 }}/>
          </div>
          <div style={{ fontSize: 10, color: rdColors.slate500, marginTop: 6 }}>11% of 38,420 ready stock</div>
        </div>
      </div>

      {/* Truck */}
      <div style={{ padding: '0 18px 12px' }}>
        <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: 0.5, textTransform: 'uppercase', color: rdColors.slate500, marginBottom: 8 }}>Transport</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <div style={{ padding: 12, background: rdColors.ink, borderRadius: 14, color: '#fff' }}>
            <I.Truck size={20} color="#fff"/>
            <div style={{ fontSize: 13, fontWeight: 700, marginTop: 8 }}>RJ-14 GA 4218</div>
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,.6)' }}>Tata · 6 wheel · own</div>
          </div>
          <div style={{ padding: 12, background: '#fff', borderRadius: 14, border: '1px dashed rgba(15,23,42,.18)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: rdColors.slate500 }}>
            <I.Plus size={20} color={rdColors.slate500}/>
            <div style={{ fontSize: 12, fontWeight: 600, marginTop: 4 }}>Different truck</div>
          </div>
        </div>
      </div>

      {/* Bottom CTA */}
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: '14px 18px 28px',
        background: 'linear-gradient(180deg, rgba(250,250,247,0) 0%, ' + rdColors.paper + ' 30%)' }}>
        <div style={{ background: `linear-gradient(135deg, ${rdColors.orange} 0%, #B8470E 100%)`,
          color: '#fff', borderRadius: 16, padding: '14px 18px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          boxShadow: '0 12px 24px rgba(242,106,31,.4)' }}>
          <span style={{ fontSize: 15, fontWeight: 700 }}>Continue to Payment</span>
          <I.ArrowRight size={20} color="#fff" stroke={2.4}/>
        </div>
      </div>
    </div>
  );
}

window.CashbookScreen = CashbookScreen;
window.DispatchScreen = DispatchScreen;
