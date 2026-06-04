// Custom inline icon set for RD Interlock — clean 1.6px stroke, no emoji.
// Each accepts size + color. Designed for 24px, scales gracefully.

const Icon = ({ children, size = 20, color = 'currentColor', stroke = 1.6, fill = 'none', ...rest }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke={color}
    strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" {...rest}>
    {children}
  </svg>
);

const I = {
  // Brick: simple 3D brick mark — RD Interlock signature
  Brick: (p) => (
    <Icon {...p}>
      <path d="M3 8l9-4 9 4-9 4-9-4z"/>
      <path d="M3 8v8l9 4"/>
      <path d="M21 8v8l-9 4"/>
      <path d="M7.5 6l9 4M16.5 6l-9 4"/>
    </Icon>
  ),
  Home: (p) => <Icon {...p}><path d="M3 11l9-7 9 7"/><path d="M5 10v9h14v-9"/><path d="M10 19v-5h4v5"/></Icon>,
  Plus: (p) => <Icon {...p}><path d="M12 5v14M5 12h14"/></Icon>,
  Workers: (p) => <Icon {...p}><circle cx="9" cy="8" r="3"/><path d="M3 20c0-3 3-5 6-5s6 2 6 5"/><circle cx="17" cy="9" r="2.5"/><path d="M15 20c0-2.5 2-4 4-4s2 1 2 2"/></Icon>,
  Truck: (p) => <Icon {...p}><path d="M2 7h11v9H2zM13 10h5l3 3v3h-8z"/><circle cx="6" cy="18" r="2"/><circle cx="17" cy="18" r="2"/></Icon>,
  Stack: (p) => <Icon {...p}><rect x="3" y="14" width="18" height="6" rx="1"/><rect x="5" y="8" width="14" height="6" rx="1"/><rect x="7" y="2" width="10" height="6" rx="1"/></Icon>,
  Cash: (p) => <Icon {...p}><rect x="2" y="6" width="20" height="13" rx="2"/><circle cx="12" cy="12.5" r="3"/><path d="M6 9v.01M18 16v.01"/></Icon>,
  Chart: (p) => <Icon {...p}><path d="M4 19h16"/><path d="M7 16V9M12 16V5M17 16v-4"/></Icon>,
  Bell: (p) => <Icon {...p}><path d="M6 9a6 6 0 1112 0v4l1.5 3h-15L6 13z"/><path d="M10 19a2 2 0 004 0"/></Icon>,
  Search: (p) => <Icon {...p}><circle cx="11" cy="11" r="6.5"/><path d="M20 20l-3.5-3.5"/></Icon>,
  Calendar: (p) => <Icon {...p}><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></Icon>,
  Check: (p) => <Icon {...p}><path d="M5 12l4 4 10-10"/></Icon>,
  ArrowRight: (p) => <Icon {...p}><path d="M5 12h14M13 6l6 6-6 6"/></Icon>,
  ArrowUp: (p) => <Icon {...p}><path d="M12 19V5M5 12l7-7 7 7"/></Icon>,
  ArrowDown: (p) => <Icon {...p}><path d="M12 5v14M5 12l7 7 7-7"/></Icon>,
  Chevron: (p) => <Icon {...p}><path d="M9 6l6 6-6 6"/></Icon>,
  ChevronLeft: (p) => <Icon {...p}><path d="M15 6l-6 6 6 6"/></Icon>,
  ChevronDown: (p) => <Icon {...p}><path d="M6 9l6 6 6-6"/></Icon>,
  More: (p) => <Icon {...p}><circle cx="6" cy="12" r="1.4" fill="currentColor"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/><circle cx="18" cy="12" r="1.4" fill="currentColor"/></Icon>,
  Filter: (p) => <Icon {...p}><path d="M3 5h18M6 12h12M10 19h4"/></Icon>,
  Settings: (p) => <Icon {...p}><circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 00-.1-1.2l2-1.5-2-3.5-2.4.9a7 7 0 00-2-1.2L14 3h-4l-.5 2.5a7 7 0 00-2 1.2L5 5.8l-2 3.5 2 1.5A7 7 0 005 12c0 .4 0 .8.1 1.2l-2 1.5 2 3.5 2.4-.9a7 7 0 002 1.2L10 21h4l.5-2.5a7 7 0 002-1.2l2.4.9 2-3.5-2-1.5c.1-.4.1-.8.1-1.2z"/></Icon>,
  Droplet: (p) => <Icon {...p}><path d="M12 3l5 7a6 6 0 11-10 0z"/></Icon>,
  Sun: (p) => <Icon {...p}><circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2"/></Icon>,
  Flag: (p) => <Icon {...p}><path d="M5 21V4M5 4h11l-2 4 2 4H5"/></Icon>,
  Phone: (p) => <Icon {...p}><path d="M5 4h4l2 5-2 1c1 3 3 5 6 6l1-2 5 2v4c0 1-1 2-2 2A16 16 0 013 6c0-1 1-2 2-2z"/></Icon>,
  Pencil: (p) => <Icon {...p}><path d="M4 20h4l11-11-4-4L4 16v4z"/><path d="M14 6l4 4"/></Icon>,
  X: (p) => <Icon {...p}><path d="M6 6l12 12M18 6L6 18"/></Icon>,
  Mic: (p) => <Icon {...p}><rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0014 0M12 18v3"/></Icon>,
  Receipt: (p) => <Icon {...p}><path d="M5 3h14v18l-3-2-3 2-3-2-3 2-2-1V3z"/><path d="M9 8h6M9 12h6M9 16h4"/></Icon>,
  Pipeline: (p) => <Icon {...p}><circle cx="5" cy="12" r="2"/><circle cx="19" cy="12" r="2"/><path d="M7 12h2M11 12h2M15 12h2"/></Icon>,
  Layers: (p) => <Icon {...p}><path d="M12 3l9 5-9 5-9-5 9-5z"/><path d="M3 13l9 5 9-5M3 18l9 5 9-5"/></Icon>,
  Clock: (p) => <Icon {...p}><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></Icon>,
};

window.I = I;
