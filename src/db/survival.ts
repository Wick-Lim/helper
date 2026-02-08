// Survival ledger and debt management
// Handles the 실존적 부채 ($50/month) and income tracking

import { getDB } from "./index.js";
import { logger } from "../core/logger.js";
import { GROWTH } from "../core/constants.js";

/**
 * Add an entry to the survival ledger
 * @param amount - Positive for income, negative for expense/debt
 * @param reason - Description of the transaction
 */
export function recordTransaction(amount: number, reason: string): void {
  const db = getDB();
  db.run(
    `INSERT INTO survival_ledger (amount, reason) VALUES (?, ?)`,
    [amount, reason]
  );
  
  if (amount < 0) {
    logger.debug(`Debt recorded: ${amount} (${reason})`);
  } else {
    logger.info(`Income recorded: ${amount} (${reason})`);
  }
}

/**
 * Calculate and record the periodic debt based on elapsed time
 * Should be called periodically (e.g., every minute)
 */
export function applyHourlyDebt(): void {
  const db = getDB();
  
  // Check when the last debt was applied
  const lastDebt = db.query(`
    SELECT created_at FROM survival_ledger 
    WHERE reason = 'System Maintenance (Hourly)' 
    ORDER BY created_at DESC LIMIT 1
  `).get() as { created_at: string } | null;
  
  const now = new Date();
  let lastTime = lastDebt ? new Date(lastDebt.created_at + 'Z') : new Date();
  
  // If first time, just record now and return
  if (!lastDebt) {
    recordTransaction(-GROWTH.HOURLY_DEBT, 'System Maintenance (Initial)');
    return;
  }
  
  // Calculate hours passed
  const diffMs = now.getTime() - lastTime.getTime();
  const diffHours = diffMs / (1000 * 60 * 60);
  
  if (diffHours >= 1) {
    const totalDebt = diffHours * GROWTH.HOURLY_DEBT;
    recordTransaction(-totalDebt, 'System Maintenance (Hourly)');
  }
}

/**
 * Get current balance (total sum of ledger)
 */
export function getBalance(): number {
  const db = getDB();
  const result = db.query(`SELECT SUM(amount) as balance FROM survival_ledger`).get() as { balance: number };
  return result.balance || 0;
}

/**
 * Get formatted survival stats for UI
 */
export function getSurvivalStats(): {
  balance: number;
  totalIncome: number;
  totalDebt: number;
  survivalDays: number;
} {
  const db = getDB();
  const summary = db.query(`
    SELECT 
      SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END) as income,
      SUM(CASE WHEN amount < 0 THEN amount ELSE 0 END) as debt,
      COUNT(*) as entries
    FROM survival_ledger
  `).get() as { income: number; debt: number; entries: number };
  
  const balance = (summary.income || 0) + (summary.debt || 0);
  
  return {
    balance,
    totalIncome: summary.income || 0,
    totalDebt: Math.abs(summary.debt || 0),
    survivalDays: (summary.entries / 24) || 0 // Rough estimate
  };
}

/**
 * Reset ledger (Tabula Rasa)
 */
export function resetLedger(): void {
  const db = getDB();
  db.run(`DELETE FROM survival_ledger`);
  // Start with initial debt
  recordTransaction(-GROWTH.DAILY_DEBT, 'Genesis Debt');
}
