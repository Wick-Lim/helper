// Intelligent stuck detection — identifies unproductive loops without hard iteration limits

interface CallRecord {
  toolName: string;
  inputHash: number;
  iteration: number;
}

export interface StuckCheck {
  isStuck: boolean;
  shouldTerminate: boolean;
  message?: string;
}

export class StuckDetector {
  private history: CallRecord[] = [];
  private iteration = 0;
  private readonly maxIterations: number;

  constructor(maxIterations: number = 100) {
    this.maxIterations = maxIterations;
  }

  record(toolName: string, inputStr: string): void {
    this.iteration++;
    this.history.push({
      toolName,
      inputHash: Bun.hash(inputStr) as unknown as number,
      iteration: this.iteration,
    });
  }

  check(): StuckCheck {
    // Condition 4: Absolute maximum
    if (this.iteration >= this.maxIterations) {
      return {
        isStuck: true,
        shouldTerminate: true,
        message: `Reached absolute maximum of ${this.maxIterations} iterations. Terminating to prevent excessive cost.`,
      };
    }

    if (this.history.length < 3) {
      return { isStuck: false, shouldTerminate: false };
    }

    // Condition 1: Same tool + same input 3+ times consecutively
    const recent3 = this.history.slice(-3);
    if (
      recent3.every(
        (r) =>
          r.toolName === recent3[0].toolName &&
          r.inputHash === recent3[0].inputHash
      )
    ) {
      return {
        isStuck: true,
        shouldTerminate: false,
        message: `Warning: You've called "${recent3[0].toolName}" with the same input 3 times in a row. Try a different approach or different parameters.`,
      };
    }

    // Condition 2: Single tool used 10+ times in a row (regardless of input)
    if (this.history.length >= 10) {
      const recent10 = this.history.slice(-10);
      if (recent10.every((r) => r.toolName === recent10[0].toolName)) {
        return {
          isStuck: true,
          shouldTerminate: false,
          message: `Warning: You've used "${recent10[0].toolName}" 10 times in a row. Consider using a different tool or summarizing your progress.`,
        };
      }
    }

    // Condition 3: High failure rate (checked externally, but we can track patterns)

    return { isStuck: false, shouldTerminate: false };
  }

  getIteration(): number {
    return this.iteration;
  }

  reset(): void {
    this.history = [];
    this.iteration = 0;
  }
}
