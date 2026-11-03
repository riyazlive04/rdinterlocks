// Build credit, shown at the bottom of every screen. Carries the mobile
// bottom-nav clearance (pb-28) that <main> used to hold, so the last line of a
// page is never hidden behind the nav bar.
export function Footer({ bare = false }: { bare?: boolean }) {
  return (
    <footer
      className={
        bare
          ? "w-full px-4 pt-6 pb-6 text-center"
          : "w-full max-w-screen-xl mx-auto px-4 md:px-8 pt-3 pb-28 md:pb-6"
      }
    >
      <div
        className={
          bare
            ? "text-[11px] text-slate-400"
            : "border-t border-slate-200 pt-3 text-center text-[11px] text-slate-400"
        }
      >
        Developed by{" "}
        <a
          href="https://sirahdigital.in/"
          target="_blank"
          rel="noopener noreferrer"
          className="font-semibold text-slate-500 hover:text-ink underline underline-offset-2"
        >
          Sirah Digital
        </a>
      </div>
    </footer>
  );
}
