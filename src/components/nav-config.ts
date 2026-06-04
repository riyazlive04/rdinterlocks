import { IconName } from "./icons";

export type NavItem = {
  id: string;
  label: string;
  href: string;
  icon: IconName;
  matches?: string[];
};

export const primaryNav: NavItem[] = [
  { id: "home", label: "Dashboard", href: "/", icon: "Home" },
  {
    id: "production",
    label: "Production",
    href: "/production",
    icon: "Brick",
    matches: ["/production"],
  },
  {
    id: "sales",
    label: "Clients & Sales",
    href: "/clients",
    icon: "Receipt",
    matches: ["/clients"],
  },
  {
    id: "tipper",
    label: "Tipper",
    href: "/tipper",
    icon: "Truck",
    matches: ["/tipper"],
  },
  { id: "mason", label: "Mason", href: "/mason", icon: "Hammer", matches: ["/mason"] },
  {
    id: "loading",
    label: "Loading",
    href: "/loading",
    icon: "Box",
    matches: ["/loading"],
  },
  {
    id: "expense",
    label: "Expense",
    href: "/expense",
    icon: "Tag",
    matches: ["/expense"],
  },
  {
    id: "employees",
    label: "Employees",
    href: "/employees",
    icon: "Users",
    matches: ["/employees"],
  },
  { id: "cash", label: "Cashbook", href: "/cash", icon: "Cash", matches: ["/cash"] },
  {
    id: "reports",
    label: "Reports",
    href: "/reports",
    icon: "Chart",
    matches: ["/reports"],
  },
  {
    id: "vehicles",
    label: "Vehicles & EMI",
    href: "/vehicles",
    icon: "Truck",
    matches: ["/vehicles"],
  },
  {
    id: "guide",
    label: "App guide",
    href: "/guide",
    icon: "Phone",
    matches: ["/guide"],
  },
  {
    id: "settings",
    label: "Settings",
    href: "/settings",
    icon: "Settings",
    matches: ["/settings"],
  },
];

// Mobile bottom nav — 5 most-used. Everything else lives behind a "More" sheet.
export const mobileNav: NavItem[] = [
  { id: "home", label: "Home", href: "/", icon: "Home" },
  { id: "production", label: "Production", href: "/production", icon: "Brick", matches: ["/production"] },
  { id: "sales", label: "Sales", href: "/clients", icon: "Receipt", matches: ["/clients"] },
  { id: "cash", label: "Cash", href: "/cash", icon: "Cash", matches: ["/cash"] },
  { id: "more", label: "More", href: "/menu", icon: "Menu", matches: ["/menu"] },
];

export function isNavActive(item: NavItem, pathname: string) {
  if (item.href === "/" && pathname === "/") return true;
  if (item.matches?.some((m) => pathname.startsWith(m))) return true;
  return false;
}
