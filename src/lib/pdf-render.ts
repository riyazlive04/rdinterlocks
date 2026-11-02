import fs from "fs";
import os from "os";
import path from "path";
import puppeteer, { type Browser, type Page } from "puppeteer-core";
import chromium from "@sparticuz/chromium";

// Headless-Chromium-based HTML -> PDF rendering, used for the quotation PDF.
// pdfkit (used elsewhere in this app for reports) draws Latin glyphs
// one-by-one and has no complex-script shaping, so it cannot render Tamil
// correctly (conjuncts, vowel signs positioned around consonants need a
// real text-layout engine). A browser engine does this natively.
//
// Production (Vercel serverless): @sparticuz/chromium supplies a Chromium
// binary trimmed to fit a Lambda-style function; puppeteer-core drives it
// without bundling its own browser download (a full Puppeteer download is
// far too large for a serverless function).
// Local dev: point CHROME_EXECUTABLE_PATH (see .env.example) at an
// installed Chrome/Edge — Edge ships with Windows and is Chromium-based, so
// it works unmodified as the local rendering target.

function isServerless(): boolean {
  return !!process.env.VERCEL || !!process.env.AWS_LAMBDA_FUNCTION_NAME;
}

const LOCAL_BROWSER_CANDIDATES = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
];

function resolveLocalExecutablePath(): string {
  if (process.env.CHROME_EXECUTABLE_PATH) return process.env.CHROME_EXECUTABLE_PATH;
  for (const candidate of LOCAL_BROWSER_CANDIDATES) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error(
    "No local Chrome/Edge found for PDF rendering. Set CHROME_EXECUTABLE_PATH in .env to your browser's executable path."
  );
}

async function launchBrowser(): Promise<Browser> {
  if (isServerless()) {
    return puppeteer.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(),
      headless: true,
    });
  }
  // An isolated --user-data-dir is required, not just tidy: Edge and Chrome
  // both hand a launch off to an ALREADY-RUNNING instance of themselves when
  // it would share the default profile, and the handed-off process then exits
  // immediately. Puppeteer is left driving a dead process and the render dies
  // with "Protocol error (Runtime.callFunctionOn): Target closed" — i.e. the
  // quotation PDF fails for any developer who happens to have their browser
  // open. A throwaway profile per launch cannot be handed off.
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "rd-pdf-profile-"));
  return puppeteer.launch({
    executablePath: resolveLocalExecutablePath(),
    headless: true,
    userDataDir: profileDir,
    args: ["--no-first-run", "--no-default-browser-check", "--disable-extensions"],
  });
}

/**
 * Exported so the flow suite (scripts/e2e/run-pdf.ts) measures the rendered
 * document through the exact launcher production uses, rather than a
 * near-copy that could drift away from it.
 */
export async function withPage<T>(fn: (page: Page) => Promise<T>): Promise<T> {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    return await fn(page);
  } finally {
    await browser.close();
  }
}

/**
 * Render a self-contained HTML document (inline CSS; a Google Fonts <link>
 * for Tamil is fine — the browser fetches it) to a PDF buffer. Waits for
 * `document.fonts.ready` before printing so a Tamil web font that's still
 * downloading doesn't get rasterized as tofu boxes.
 */
export async function renderHtmlToPdf(
  html: string,
  opts: { format?: "A4" | "Letter" } = {}
): Promise<Buffer> {
  return withPage(async (page) => {
    await page.setContent(html, { waitUntil: "load" });
    // The explicit font-ready wait matters more than any waitUntil mode here
    // — a web font (Tamil) can still be downloading after "load" fires.
    await page.evaluate(() => document.fonts.ready);
    const pdf = await page.pdf({ format: opts.format ?? "A4", printBackground: true });
    return Buffer.from(pdf);
  });
}
