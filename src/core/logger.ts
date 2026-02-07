// ANSI color logging module

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

let verbose = false;

export function setVerbose(v: boolean): void {
  verbose = v;
}

function timestamp(): string {
  return new Date().toISOString().slice(11, 19);
}

export const logger = {
  info(msg: string, ...args: unknown[]): void {
    console.log(`${GRAY}${timestamp()}${RESET} ${GREEN}INFO${RESET}  ${msg}`, ...args);
  },

  agent(msg: string, ...args: unknown[]): void {
    console.log(`${GRAY}${timestamp()}${RESET} ${CYAN}${BOLD}AGENT${RESET} ${msg}`, ...args);
  },

  tool(name: string, msg: string, ...args: unknown[]): void {
    console.log(`${GRAY}${timestamp()}${RESET} ${MAGENTA}TOOL${RESET}  ${DIM}[${name}]${RESET} ${msg}`, ...args);
  },

  warn(msg: string, ...args: unknown[]): void {
    console.warn(`${GRAY}${timestamp()}${RESET} ${YELLOW}WARN${RESET}  ${msg}`, ...args);
  },

  error(msg: string, ...args: unknown[]): void {
    console.error(`${GRAY}${timestamp()}${RESET} ${RED}ERROR${RESET} ${msg}`, ...args);
  },

  debug(msg: string, ...args: unknown[]): void {
    if (verbose) {
      console.log(`${GRAY}${timestamp()} DEBUG ${msg}${RESET}`, ...args);
    }
  },

  thinking(msg: string): void {
    console.log(`${GRAY}${timestamp()}${RESET} ${BLUE}THINK${RESET} ${DIM}${msg}${RESET}`);
  },
};
