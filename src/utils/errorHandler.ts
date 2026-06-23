// ============================================================
// CIRCUIT BREAKER — Prevents AI loops by stopping after 3 identical failures
// ============================================================

interface CircuitBreakerState {
  toolName: string;
  attemptCount: number;
  lastAttempt: Date | null;
  lastParams: string; // JSON stringified params for comparison
  isOpen: boolean;    // Circuit open = stop all attempts
}

class CircuitBreakerStore {
  private store = new Map<string, CircuitBreakerState>();
  private readonly MAX_ATTEMPTS = 3;
  private readonly RESET_TIMEOUT_MS = 60000; // Reset after 1 min

  check(toolName: string, params: Record<string, unknown>): { allowed: boolean; reason?: string } {
    const key = this.makeKey(toolName, params);
    const state = this.store.get(key);

    if (!state) {
      // First attempt
      this.store.set(key, {
        toolName,
        attemptCount: 1,
        lastAttempt: new Date(),
        lastParams: JSON.stringify(params),
        isOpen: false,
      });
      return { allowed: true };
    }

    // Check if circuit is open
    if (state.isOpen) {
      // Check if enough time has passed to reset
      if (state.lastAttempt && (Date.now() - state.lastAttempt.getTime()) > this.RESET_TIMEOUT_MS) {
        this.store.delete(key);
        return { allowed: true };
      }
      return { allowed: false, reason: `Circuit breaker open for ${toolName} after ${state.attemptCount} attempts. Reset in ${Math.ceil((this.RESET_TIMEOUT_MS - (Date.now() - state.lastAttempt!.getTime())) / 1000)}s` };
    }

    // Increment attempt count
    state.attemptCount++;
    state.lastAttempt = new Date();

    if (state.attemptCount >= this.MAX_ATTEMPTS) {
      state.isOpen = true;
      return { allowed: false, reason: `Circuit breaker TRIPPED for ${toolName} after ${state.attemptCount} identical attempts. Trying same approach again won't work.` };
    }

    return { allowed: true };
  }

  reset(toolName: string): void {
    for (const [key, state] of this.store.entries()) {
      if (state.toolName === toolName) {
        this.store.delete(key);
      }
    }
  }

  private makeKey(toolName: string, params: Record<string, unknown>): string {
    // Simplify params to detect similar patterns
    const simplified = { ...params };
    // Remove fields not relevant for loop detection
    delete (simplified as Record<string, unknown>).timestamp;
    return `${toolName}:${JSON.stringify(simplified)}`;
  }

  getAttemptCount(toolName: string, params: Record<string, unknown>): number {
    const key = this.makeKey(toolName, params);
    return this.store.get(key)?.attemptCount ?? 0;
  }
}

export const circuitBreaker = new CircuitBreakerStore();

