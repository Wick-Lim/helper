// Output rendering utilities — banner, formatting, ANSI colors

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const BLUE = "\x1b[34m";
const MAGENTA = "\x1b[35m";
const CYAN = "\x1b[36m";
const GRAY = "\x1b[90m";

export function renderBanner(): void {
  console.log(`
${CYAN}${BOLD}╔══════════════════════════════════════════╗
║           🤖 Agentic AI OS v1.0          ║
║      Autonomous Agent Operating System    ║
╚══════════════════════════════════════════╝${RESET}
${DIM}Type /help for commands, /exit to quit${RESET}
`);
}

export function renderToolCall(name: string, args: Record<string, unknown>): void {
  const argsStr = JSON.stringify(args, null, 0).slice(0, 120);
  console.log(`  ${MAGENTA}▸ ${name}${RESET} ${DIM}${argsStr}${RESET}`);
}

export function renderToolResult(name: string, success: boolean, output: string, hasImages?: boolean): void {
  const icon = success ? `${GREEN}✓${RESET}` : `${RED}✗${RESET}`;
  const preview = output.split("\n")[0]?.slice(0, 120) ?? "";
  const imgTag = hasImages ? ` ${BLUE}[screenshot]${RESET}` : "";
  console.log(`  ${icon} ${DIM}${name}: ${preview}${RESET}${imgTag}`);
}

export function renderThinking(text: string): void {
  const preview = text.slice(0, 150).replace(/\n/g, " ");
  console.log(`  ${BLUE}💭 ${preview}${RESET}`);
}

export function renderAgentText(text: string): void {
  console.log(`\n${CYAN}${BOLD}Agent:${RESET} ${text}\n`);
}

export function renderWarning(msg: string): void {
  console.log(`\n${YELLOW}⚠ ${msg}${RESET}\n`);
}

export function renderError(msg: string): void {
  console.log(`\n${RED}✗ ${msg}${RESET}\n`);
}

export function renderInfo(msg: string): void {
  console.log(`${GREEN}${msg}${RESET}`);
}

export function renderTable(headers: string[], rows: string[][]): void {
  // Calculate column widths
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length))
  );

  const separator = widths.map((w) => "─".repeat(w + 2)).join("┼");
  const headerLine = headers
    .map((h, i) => ` ${h.padEnd(widths[i])} `)
    .join("│");

  console.log(`${BOLD}${headerLine}${RESET}`);
  console.log(`${DIM}${separator}${RESET}`);
  for (const row of rows) {
    console.log(row.map((c, i) => ` ${(c ?? "").padEnd(widths[i])} `).join("│"));
  }
}
