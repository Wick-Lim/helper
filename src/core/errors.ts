// Custom error hierarchy for the agent system

export class AgentError extends Error {
  constructor(message: string, public readonly cause?: Error) {
    super(message);
    this.name = "AgentError";
  }
}

export class RetryableError extends AgentError {
  constructor(
    message: string,
    public readonly retryAfterMs?: number,
    cause?: Error
  ) {
    super(message, cause);
    this.name = "RetryableError";
  }
}

export class FatalError extends AgentError {
  constructor(message: string, cause?: Error) {
    super(message, cause);
    this.name = "FatalError";
  }
}

export class StuckError extends AgentError {
  constructor(
    message: string,
    public readonly iterations: number
  ) {
    super(message);
    this.name = "StuckError";
  }
}

export class ToolError extends AgentError {
  constructor(
    message: string,
    public readonly toolName: string,
    cause?: Error
  ) {
    super(message, cause);
    this.name = "ToolError";
  }
}

export function classifyError(error: unknown): AgentError {
  if (error instanceof AgentError) return error;
  if (error instanceof Error) return new AgentError(error.message, error);
  return new AgentError(String(error));
}
