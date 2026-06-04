// RD Interlock — shared screen components (status bar, bottom nav, KPI card, etc.)

const rdColors = {
  ink: '#0B1220',
  navy900: '#0E2143',
  navy800: '#14305E',
  navy600: '#2659A0',
  navy50: '#EEF3FB',
  orange: '#F26A1F',
  orange50: '#FFF3E8',
  orange100: '#FFE7D4',
  slate900: '#0F172A',
  slate700: '#334155',
  slate600: '#475569',
  slate500: '#64748B',
  slate400: '#94A3B8',
  slate200: '#E2E8F0',
  slate100: '#F1F5F9',
  slate50: '#F8FAFC',
  paper: '#FAFAF7',
  card: '#FFFFFF',
  success: '#10B981',
  warning: '#F59E0B',
  danger: '#DC2626',
};

// Phone status bar — simulates Android system bar at the top of the screen.
function PhoneStatus({ dark = false, time = '8:42' }) {
  const c = dark ? '#fff' : rdColors.ink;
  return (
    <div style={{
      height: 36, padding: '0 18px',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      fontFamily: 'var(--rd-font-ui)', fontSize: 13, fontWeight: 600,
      color: c, fontVariantNumeric: 'tabular-nums',
      background: 'transparent',
    }}>
      <span>{time}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
        <svg width="16" height="11" viewBox="0 0 16 11" fill={c}>
          <rect x="0" y="7" width="3" height="4" rx="0.5"/>
          <rect x="4.5" y="5" width="3" height="6" rx="0.5"/>
          <rect x="9" y="2.5" width="3" height="8.5" rx="0.5"/>
          <rect x="13.5" y="0" width="2.5" height="11" rx="0.5" opacity="0.4"/>
        </svg>
        <svg width="14" height="11" viewBox="0 0 14 11" fill="none" stroke={c} strokeWidth="1.4">
          <path d="M1 4.5a8 8 0 0112 0M3 6.8a5 5 0 018 0M5.5 9a2 2 0 013 0"/>
        </svg>
        <svg width="22" height="11" viewBox="0 0 22 11" fill="none">
          <rect x="0.6" y="0.6" width="18.8" height="9.8" rx="2.2" stroke={c} strokeWidth="1.2"/>
          <rect x="2" y="2" width="14" height="7" rx="1" fill={c}/>
          <rect x="20" y="3.5" width="1.4" height="4" rx="0.7" fill={c}/>
        </svg>
      </div>
    </div>
  );
}

// Phone home indicator
function PhoneHome({ dark = false }) {
  return (
    <div style={{ height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ width: 110, height: 4, borderRadius: 2,
        background: dark ? '#fff' : rdColors.ink, opacity: 0.85 }} />
    </div>
  );
}

// Brand logo block
function BrandMark({ size = 28, color = rdColors.orange, ink = rdColors.navy900 }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{
        width: size, height: size, borderRadius: 7, position: 'relative',
        background: `linear-gradient(135deg, ${color} 0%, #B8470E 100%)`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        boxShadow: '0 2px 6px rgba(242,106,31,.35)',
      }}>
        {/* interlocking-brick mark */}
        <svg width={size*0.62} height={size*0.62} viewBox="0 0 16 16" fill="none">
          <rect x="1.5" y="3" width="6" height="4" rx="0.6" fill="#fff" opacity="0.95"/>
          <rect x="8.5" y="3" width="6" height="4" rx="0.6" fill="#fff" opacity="0.55"/>
          <rect x="1.5" y="9" width="6" height="4" rx="0.6" fill="#fff" opacity="0.55"/>
          <rect x="8.5" y="9" width="6" height="4" rx="0.6" fill="#fff" opacity="0.95"/>
        </svg>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1 }}>
        <span style={{ fontFamily: 'var(--rd-font-display)', fontSize: 16, fontWeight: 700, color: ink, letterSpacing: -0.4 }}>RD Interlock</span>
        <span style={{ fontFamily: 'var(--rd-font-mono)', fontSize: 9, fontWeight: 500, color: rdColors.slate500, letterSpacing: 1, textTransform: 'uppercase', marginTop: 2 }}>Factory OS</span>
      </div>
    </div>
  );
}

// Bottom navigation — 5 slot, orange active pill
function BottomNav({ active = 'home' }) {
  const items = [
    { id: 'home',   label: 'Home',     icon: 'Home' },
    { id: 'stock',  label: 'Stock',    icon: 'Stack' },
    { id: 'entry',  label: 'Entry',    icon: 'Plus', primary: true },
    { id: 'workers',label: 'Workers',  icon: 'Workers' },
    { id: 'cash',   label: 'Cash',     icon: 'Cash' },
  ];
  return (
    <div style={{
      position: 'absolute', left: 0, right: 0, bottom: 0,
      paddingBottom: 28, // home indicator
      background: 'linear-gradient(180deg, rgba(255,255,255,0) 0%, #fff 24%)',
    }}>
      <div style={{
        margin: '0 14px',
        background: '#fff',
        borderRadius: 24,
        boxShadow: '0 8px 28px rgba(15,23,42,.10), 0 1px 2px rgba(15,23,42,.04)',
        border: '1px solid rgba(15,23,42,.05)',
        height: 64,
        display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', alignItems: 'center',
      }}>
        {items.map(it => {
          if (it.primary) {
            return (
              <div key={it.id} style={{ display: 'flex', justifyContent: 'center' }}>
                <div style={{
                  width: 52, height: 52, borderRadius: 26,
                  background: `linear-gradient(135deg, ${rdColors.orange} 0%, #B8470E 100%)`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  boxShadow: '0 8px 18px rgba(242,106,31,.45)',
                  transform: 'translateY(-12px)',
                  border: '4px solid #fff',
                }}>
                  <I.Plus size={24} color="#fff" stroke={2.4}/>
                </div>
              </div>
            );
          }
          const isActive = it.id === active;
          const Ic = I[it.icon];
          return (
            <div key={it.id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
              <Ic size={22} color={isActive ? rdColors.navy900 : rdColors.slate400} stroke={isActive ? 2 : 1.6}/>
              <span style={{ fontSize: 10, fontWeight: isActive ? 600 : 500, color: isActive ? rdColors.navy900 : rdColors.slate500 }}>
                {it.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// KPI card — versatile
function KPI({ label, value, suffix, delta, deltaDir = 'up', tone = 'navy', icon, sub, sparkline }) {
  const tones = {
    navy:   { bg: rdColors.navy900, fg: '#fff', sub: 'rgba(255,255,255,.65)', accent: rdColors.orange },
    paper:  { bg: '#fff', fg: rdColors.ink, sub: rdColors.slate500, accent: rdColors.navy600 },
    orange: { bg: `linear-gradient(135deg, ${rdColors.orange} 0%, #B8470E 100%)`, fg: '#fff', sub: 'rgba(255,255,255,.78)', accent: '#fff' },
    cream:  { bg: rdColors.orange50, fg: rdColors.ink, sub: rdColors.slate600, accent: rdColors.orange },
  };
  const t = tones[tone] || tones.paper;
  return (
    <div style={{
      background: t.bg, color: t.fg, borderRadius: 18,
      padding: 16, position: 'relative', overflow: 'hidden',
      boxShadow: tone === 'paper' ? '0 1px 3px rgba(15,23,42,.06)' : 'none',
      border: tone === 'paper' ? '1px solid rgba(15,23,42,.06)' : 'none',
      minHeight: 116,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: 0.5, textTransform: 'uppercase', color: t.sub }}>{label}</span>
        {icon && <div style={{ opacity: .85 }}>{icon}</div>}
      </div>
      <div style={{ marginTop: 8, display: 'flex', alignItems: 'baseline', gap: 4 }}>
        <span className="display num" style={{ fontFamily: 'var(--rd-font-display)', fontSize: 30, fontWeight: 700, lineHeight: 1, letterSpacing: -0.5 }}>{value}</span>
        {suffix && <span style={{ fontSize: 13, fontWeight: 500, color: t.sub }}>{suffix}</span>}
      </div>
      {sub && <div style={{ marginTop: 6, fontSize: 12, color: t.sub }}>{sub}</div>}
      {delta && (
        <div style={{ marginTop: 10, display: 'inline-flex', alignItems: 'center', gap: 4,
          padding: '3px 8px', borderRadius: 999,
          background: deltaDir === 'up' ? 'rgba(16,185,129,.15)' : 'rgba(220,38,38,.15)',
          color: deltaDir === 'up' ? '#10B981' : '#F87171',
          fontSize: 11, fontWeight: 600,
        }}>
          {deltaDir === 'up' ? '↑' : '↓'} {delta}
        </div>
      )}
      {sparkline && (
        <div style={{ position: 'absolute', right: 12, bottom: 12, opacity: 0.85 }}>
          {sparkline}
        </div>
      )}
    </div>
  );
}

// tiny sparkline
function Spark({ values, color = '#fff', w = 64, h = 22 }) {
  const max = Math.max(...values), min = Math.min(...values);
  const r = max - min || 1;
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * w;
    const y = h - ((v - min) / r) * h;
    return `${x},${y}`;
  }).join(' ');
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" opacity="0.9"/>
    </svg>
  );
}

// Section header
function SectionHead({ title, action, sub }) {
  return (
    <div style={{ padding: '0 18px', display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 12 }}>
      <div>
        <div style={{ fontSize: 16, fontWeight: 700, color: rdColors.ink, letterSpacing: -0.2 }}>{title}</div>
        {sub && <div style={{ fontSize: 12, color: rdColors.slate500, marginTop: 2 }}>{sub}</div>}
      </div>
      {action && <div style={{ fontSize: 12, fontWeight: 600, color: rdColors.navy600 }}>{action}</div>}
    </div>
  );
}

// Status pill
function Pill({ children, tone = 'slate' }) {
  const tones = {
    slate:   { bg: rdColors.slate100, fg: rdColors.slate700 },
    navy:    { bg: rdColors.navy50,   fg: rdColors.navy800 },
    orange:  { bg: rdColors.orange50, fg: rdColors.orange },
    success: { bg: '#DCFCE7', fg: '#166534' },
    warning: { bg: '#FEF3C7', fg: '#92400E' },
    danger:  { bg: '#FEE2E2', fg: '#991B1B' },
    info:    { bg: '#DBEAFE', fg: '#1E40AF' },
    dark:    { bg: rdColors.ink, fg: '#fff' },
  };
  const t = tones[tone] || tones.slate;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '3px 8px', borderRadius: 999,
      background: t.bg, color: t.fg,
      fontSize: 11, fontWeight: 600, letterSpacing: 0.1,
    }}>{children}</span>
  );
}

// Worker avatar
function Avatar({ name, size = 32, tone }) {
  const initials = name.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase();
  const palette = ['#0E2143', '#B8470E', '#1F8FB3', '#2F8F5A', '#7C2D9C', '#C97A18'];
  const c = tone || palette[(name.charCodeAt(0) + name.length) % palette.length];
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: c, color: '#fff',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.36, fontWeight: 600, letterSpacing: 0.2,
      flexShrink: 0,
    }}>{initials}</div>
  );
}

Object.assign(window, {
  rdColors, PhoneStatus, PhoneHome, BrandMark, BottomNav, KPI, Spark, SectionHead, Pill, Avatar,
});
