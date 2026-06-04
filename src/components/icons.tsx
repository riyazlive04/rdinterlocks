import * as React from "react";

type IconProps = {
  size?: number;
  color?: string;
  stroke?: number;
  className?: string;
};

const SVG: React.FC<React.PropsWithChildren<IconProps>> = ({
  size = 20,
  color = "currentColor",
  stroke = 1.6,
  className,
  children,
}) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke={color}
    strokeWidth={stroke}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    {children}
  </svg>
);

export const Icon = {
  Brick: (p: IconProps) => (
    <SVG {...p}>
      <path d="M3 8l9-4 9 4-9 4-9-4z" />
      <path d="M3 8v8l9 4" />
      <path d="M21 8v8l-9 4" />
      <path d="M7.5 6l9 4M16.5 6l-9 4" />
    </SVG>
  ),
  Home: (p: IconProps) => (
    <SVG {...p}>
      <path d="M3 11l9-7 9 7" />
      <path d="M5 10v9h14v-9" />
      <path d="M10 19v-5h4v5" />
    </SVG>
  ),
  Plus: (p: IconProps) => (
    <SVG {...p}>
      <path d="M12 5v14M5 12h14" />
    </SVG>
  ),
  Workers: (p: IconProps) => (
    <SVG {...p}>
      <circle cx="9" cy="8" r="3" />
      <path d="M3 20c0-3 3-5 6-5s6 2 6 5" />
      <circle cx="17" cy="9" r="2.5" />
      <path d="M15 20c0-2.5 2-4 4-4s2 1 2 2" />
    </SVG>
  ),
  Truck: (p: IconProps) => (
    <SVG {...p}>
      <path d="M2 7h11v9H2zM13 10h5l3 3v3h-8z" />
      <circle cx="6" cy="18" r="2" />
      <circle cx="17" cy="18" r="2" />
    </SVG>
  ),
  Stack: (p: IconProps) => (
    <SVG {...p}>
      <rect x="3" y="14" width="18" height="6" rx="1" />
      <rect x="5" y="8" width="14" height="6" rx="1" />
      <rect x="7" y="2" width="10" height="6" rx="1" />
    </SVG>
  ),
  Cash: (p: IconProps) => (
    <SVG {...p}>
      <rect x="2" y="6" width="20" height="13" rx="2" />
      <circle cx="12" cy="12.5" r="3" />
      <path d="M6 9v.01M18 16v.01" />
    </SVG>
  ),
  Chart: (p: IconProps) => (
    <SVG {...p}>
      <path d="M4 19h16" />
      <path d="M7 16V9M12 16V5M17 16v-4" />
    </SVG>
  ),
  Bell: (p: IconProps) => (
    <SVG {...p}>
      <path d="M6 9a6 6 0 1112 0v4l1.5 3h-15L6 13z" />
      <path d="M10 19a2 2 0 004 0" />
    </SVG>
  ),
  Search: (p: IconProps) => (
    <SVG {...p}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M20 20l-3.5-3.5" />
    </SVG>
  ),
  Calendar: (p: IconProps) => (
    <SVG {...p}>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </SVG>
  ),
  Check: (p: IconProps) => (
    <SVG {...p}>
      <path d="M5 12l4 4 10-10" />
    </SVG>
  ),
  ArrowRight: (p: IconProps) => (
    <SVG {...p}>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </SVG>
  ),
  ArrowUp: (p: IconProps) => (
    <SVG {...p}>
      <path d="M12 19V5M5 12l7-7 7 7" />
    </SVG>
  ),
  ArrowDown: (p: IconProps) => (
    <SVG {...p}>
      <path d="M12 5v14M5 12l7 7 7-7" />
    </SVG>
  ),
  Chevron: (p: IconProps) => (
    <SVG {...p}>
      <path d="M9 6l6 6-6 6" />
    </SVG>
  ),
  ChevronLeft: (p: IconProps) => (
    <SVG {...p}>
      <path d="M15 6l-6 6 6 6" />
    </SVG>
  ),
  ChevronDown: (p: IconProps) => (
    <SVG {...p}>
      <path d="M6 9l6 6 6-6" />
    </SVG>
  ),
  More: (p: IconProps) => (
    <SVG {...p}>
      <circle cx="6" cy="12" r="1.4" fill="currentColor" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" />
      <circle cx="18" cy="12" r="1.4" fill="currentColor" />
    </SVG>
  ),
  Filter: (p: IconProps) => (
    <SVG {...p}>
      <path d="M3 5h18M6 12h12M10 19h4" />
    </SVG>
  ),
  Settings: (p: IconProps) => (
    <SVG {...p}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19 12a7 7 0 00-.1-1.2l2-1.5-2-3.5-2.4.9a7 7 0 00-2-1.2L14 3h-4l-.5 2.5a7 7 0 00-2 1.2L5 5.8l-2 3.5 2 1.5A7 7 0 005 12c0 .4 0 .8.1 1.2l-2 1.5 2 3.5 2.4-.9a7 7 0 002 1.2L10 21h4l.5-2.5a7 7 0 002-1.2l2.4.9 2-3.5-2-1.5c.1-.4.1-.8.1-1.2z" />
    </SVG>
  ),
  Phone: (p: IconProps) => (
    <SVG {...p}>
      <path d="M5 4h4l2 5-2 1c1 3 3 5 6 6l1-2 5 2v4c0 1-1 2-2 2A16 16 0 013 6c0-1 1-2 2-2z" />
    </SVG>
  ),
  Pencil: (p: IconProps) => (
    <SVG {...p}>
      <path d="M4 20h4l11-11-4-4L4 16v4z" />
      <path d="M14 6l4 4" />
    </SVG>
  ),
  Trash: (p: IconProps) => (
    <SVG {...p}>
      <path d="M3 6h18" />
      <path d="M5 6v14a2 2 0 002 2h10a2 2 0 002-2V6" />
      <path d="M9 6V4a2 2 0 012-2h2a2 2 0 012 2v2" />
      <path d="M10 11v6M14 11v6" />
    </SVG>
  ),
  X: (p: IconProps) => (
    <SVG {...p}>
      <path d="M6 6l12 12M18 6L6 18" />
    </SVG>
  ),
  Receipt: (p: IconProps) => (
    <SVG {...p}>
      <path d="M5 3h14v18l-3-2-3 2-3-2-3 2-2-1V3z" />
      <path d="M9 8h6M9 12h6M9 16h4" />
    </SVG>
  ),
  Hammer: (p: IconProps) => (
    <SVG {...p}>
      <path d="M14 4l6 6-2 2-6-6 2-2z" />
      <path d="M11 7L4 14l3 3 7-7" />
      <path d="M9 17l-2 2-3-3 2-2" />
    </SVG>
  ),
  Box: (p: IconProps) => (
    <SVG {...p}>
      <path d="M21 8l-9-5-9 5v8l9 5 9-5z" />
      <path d="M3 8l9 5 9-5M12 13v9" />
    </SVG>
  ),
  Building: (p: IconProps) => (
    <SVG {...p}>
      <rect x="4" y="3" width="16" height="18" rx="1" />
      <path d="M8 7h2M14 7h2M8 11h2M14 11h2M8 15h2M14 15h2M10 21v-3h4v3" />
    </SVG>
  ),
  Logout: (p: IconProps) => (
    <SVG {...p}>
      <path d="M9 4H5a2 2 0 00-2 2v12a2 2 0 002 2h4" />
      <path d="M16 17l5-5-5-5" />
      <path d="M21 12H9" />
    </SVG>
  ),
  Download: (p: IconProps) => (
    <SVG {...p}>
      <path d="M12 4v12" />
      <path d="M7 11l5 5 5-5" />
      <path d="M5 20h14" />
    </SVG>
  ),
  Excel: (p: IconProps) => (
    <SVG {...p}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M8 8l8 8M16 8l-8 8" />
    </SVG>
  ),
  Pdf: (p: IconProps) => (
    <SVG {...p}>
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
      <path d="M14 2v6h6" />
      <path d="M9 13h2a1 1 0 010 2H9zM13 13h2v4M14 15h1" />
    </SVG>
  ),
  Tag: (p: IconProps) => (
    <SVG {...p}>
      <path d="M20 12l-8 8a2 2 0 01-3 0L3 14a2 2 0 010-3l8-8h7v7z" />
      <circle cx="15.5" cy="8.5" r="1" fill="currentColor" />
    </SVG>
  ),
  Tools: (p: IconProps) => (
    <SVG {...p}>
      <path d="M14.7 6.3a4 4 0 015.7 5.7l-1.4 1.4-5.7-5.7zM2 22l8-8M14.7 11.3l-9 9-3-3 9-9z" />
    </SVG>
  ),
  Star: (p: IconProps) => (
    <SVG {...p}>
      <path d="M12 2l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17l-5.9 3 1.2-6.5L2.5 8.9 9.1 8z" />
    </SVG>
  ),
  Users: (p: IconProps) => (
    <SVG {...p}>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M3 21c0-4 3-6 6-6s6 2 6 6" />
      <circle cx="17" cy="9" r="2.5" />
      <path d="M15 21c0-3 2-5 4-5s2 1 2 3" />
    </SVG>
  ),
  Mic: (p: IconProps) => (
    <SVG {...p}>
      <rect x="9" y="3" width="6" height="12" rx="3" />
      <path d="M5 11a7 7 0 0014 0M12 18v3" />
    </SVG>
  ),
  Clock: (p: IconProps) => (
    <SVG {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </SVG>
  ),
  Flag: (p: IconProps) => (
    <SVG {...p}>
      <path d="M5 21V4M5 4h11l-2 4 2 4H5" />
    </SVG>
  ),
  Menu: (p: IconProps) => (
    <SVG {...p}>
      <path d="M4 6h16M4 12h16M4 18h16" />
    </SVG>
  ),
};

export type IconName = keyof typeof Icon;
