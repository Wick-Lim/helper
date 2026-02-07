// Intelligent stuck detection — identifies unproductive loops without hard iteration limits

import { MAX_ITERATIONS, STUCK_DETECTION } from "../core/constants.js";

/**
 * Record of a single tool call for stuck detection analysis
 */
interface CallRecord {
  /** Name of the tool that was called */
  toolName: string;
  /** Hash of the input arguments for comparison */
  inputHash: number;
  /** Iteration number when this call was made */
  iteration: number;
}

/**
 * Result of a stuck detection check
 */
export interface StuckCheck {
  /** Whether the agent appears to be stuck */
  isStuck: boolean;
  /** Whether the agent should terminate immediately */
  shouldTerminate: boolean;
  /** Optional warning or error message */
  message?: string;
}

/**
 * Detects when the agent is stuck in unproductive loops
 * Uses multiple heuristics to identify problematic patterns:
 * 1. Same tool with same input called multiple times consecutively
 * 2. Same tool used too many times in a row
 * 3. Maximum iteration limit reached
 */
export class StuckDetector {
  private history: CallRecord[] = [];
  private iteration = 0;
  private readonly maxIterations: number;

  /**
   * Create a new StuckDetector
   * @param maxIterations - Maximum number of iterations before forced termination (default: 100)
   */
  constructor(maxIterations: number = MAX_ITERATIONS.DEFAULT) {
    this.maxIterations = Math.min(
      Math.max(maxIterations, MAX_ITERATIONS.MIN),
      MAX_ITERATIONS.MAX
    );
  }

  /**
   * Record a tool call for analysis
   * @param toolName - Name of the tool being called
   * @param inputStr - String representation of the input arguments
   */
  record(toolName: string, inputStr: string): void {
    this.iteration++;
    this.history.push({
      toolName,
      inputHash: Bun.hash(inputStr) as unknown as number,
      iteration: this.iteration,
    });
  }

  /**
   * Check if the agent appears to be stuck
   * @returns StuckCheck result with recommendations
   */
  check(): StuckCheck {
    // Condition 1: Absolute maximum iterations reached
    if (this.iteration >= this.maxIterations) {
      return {
        isStuck: true,
        shouldTerminate: true,
        message: `Reached absolute maximum of ${this.maxIterations} iterations. Terminating to prevent excessive cost.`,
      };
    }

    // Need at least 3 calls for pattern detection
    if (this.history.length < STUCK_DETECTION.SAME_CALL_THRESHOLD) {
      return { isStuck: false, shouldTerminate: false };
    }

    // Condition 2: Same tool + same input called consecutively too many times
    const recentSameCalls = this.history.slice(-STUCK_DETECTION.SAME_CALL_THRESHOLD);
    if (
      recentSameCalls.every(
        (r) =>
          r.toolName === recentSameCalls[0].toolName &&
          r.inputHash === recentSameCalls[0].inputHash
      )
    ) {
      return {
        isStuck: true,
        shouldTerminate: false,
        message: `Warning: You've called "${recentSameCalls[0].toolName}" with the same input ${STUCK_DETECTION.SAME_CALL_THRESHOLD} times in a row. Try a different approach or different parameters.`,
      };
    }

    // Condition 3: Single tool used too many times in a row (regardless of input)
    if (this.history.length >= STUCK_DETECTION.SINGLE_TOOL_THRESHOLD) {
      const recentSingleTool = this.history.slice(-STUCK_DETECTION.SINGLE_TOOL_THRESHOLD);
      if (recentSingleTool.every((r) => r.toolName === recentSingleTool[0].toolName)) {
        return {
          isStuck: true,
          shouldTerminate: false,
          message: `Warning: You've used "${recentSingleTool[0].toolName}" ${STUCK_DETECTION.SINGLE_TOOL_THRESHOLD} times in a row. Consider using a different tool or summarizing your progress.`,
        };
      }
    }

    return { isStuck: false, shouldTerminate: false };
  }

  /**
   * Get the current iteration count
   * @returns Current iteration number
   */
  getIteration(): number {
    return this.iteration;
  }

  /**
   * Get the maximum iterations limit
   * @returns Maximum allowed iterations
   */
  getMaxIterations(): number {
    return this.maxIterations;
  }

  /**
   * Get the full call history
   * @returns Array of all recorded calls
   */
  getHistory(): readonly CallRecord[] {
    return this.history;
  }

  /**
   * Reset the detector to initial state
   * Clears history and iteration counter
   */
  reset(): void {
    this.history = [];
    this.iteration = 0;
  }

  /**
   * Get statistics about the current run
   * @returns Object with statistics
   */
  getStats(): {
    iteration: number;
    maxIterations: number;
    totalCalls: number;
    uniqueTools: number;
  } {
    const uniqueTools = new Set(this.history.map((h) => h.toolName)).size;
    return {
      iteration: this.iteration,
      maxIterations: this.maxIterations,
      totalCalls: this.history.length,
      uniqueTools,
    };
  }
}
