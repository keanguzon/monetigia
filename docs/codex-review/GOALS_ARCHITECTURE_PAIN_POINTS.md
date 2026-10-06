# Monetigia - Goals Architecture & User Pain Points (Review Document)

> **Date:** October 6, 2026  
> **Status:** Open for Discussion / Review (No Solutions Included)  
> **Purpose:** Detailed breakdown of how the current Goals & Transaction system works, and a comprehensive record of the user's architectural dilemmas, friction points, and edge cases.

---

## 1. How the System Currently Works

### A. Database Model
- **`goals` Table:**
  - `target_amount` (Target goal cost)
  - `current_amount` (Cached savings amount)
  - `allocation_per_cycle` (Savings target cadence)
  - `allocation_frequency` (`monthly` or `kinsenas`)
  - `target_date` (Target completion deadline)
  - `is_completed` (Boolean flag)
- **`transactions` Table:**
  - `account_id` (Source wallet)
  - `amount` (Monetary value)
  - `type` (`income`, `expense`, `transfer`)
  - `transfer_to_account_id` (Destination wallet if transfer)
  - `goal_id` (Nullable foreign key linking transaction to a goal)

### B. Current Goal Funding Calculation (`goalFunding` in `src/lib/goal-funding.ts`)
- The system queries all transactions matching the goal's `goal_id`.
- Filter: Transactions with `type === 'expense'` OR `type === 'transfer'` are treated as contributions.
- Calculation:
  $$\text{saved} = \sum (\text{amounts of tagged expenses and transfers})$$
  $$\text{progressPercent} = \frac{\text{saved}}{\text{target\_amount}} \times 100$$
- Auto-completion trigger: When `saved >= target_amount`, the goal is automatically marked `is_completed: true`.

### C. Current "Add Contribution" User Flow
1. On a Goal card in `/goals`, the user clicks the **"Add contribution"** button.
2. This opens the generic `AddTransactionModal` with `defaultGoalId` passed in.
3. In `AddTransactionModal`:
   - The default transaction `type` is automatically set to **`expense`**.
   - If the user saves as **`expense`**: The selected wallet balance in `accounts` is deducted (`balance - amount`), and the amount is added to the goal's `saved` sum.
   - If the user switches to **`transfer`**: The source wallet is deducted, destination wallet is increased, and the amount is added to the goal's `saved` sum.
   - If the user switches to **`income`**: The Goal selector dropdown is hidden/disabled; income cannot be tagged to a goal.

---

## 2. The User's Complaints, Friction Points, and Edge Cases

### A. The "Expense as Contribution" Semantic Clash
- When clicking "Add contribution" on a goal, the form defaults to **`Expense`**.
- **The Complaint:** In human mental accounting, contributing to a goal is *saving* or *setting aside funds*, not *spending money*. Seeing "Expense" as the primary default feels completely wrong, counter-intuitive, and alarming to the user.

### B. The Single-Wallet Dilemma (e.g. GCash Only)
- Many users keep all their liquid funds in a single wallet (e.g. ₱30,000 in GCash). They do not have a secondary bank or separate savings wallet to transfer funds into.
- **The Dilemma:**
  - If saving towards a goal requires logging an **Expense** or a **Transfer**, Monetigia deducts the money from GCash (e.g. GCash shows ₱25,000).
  - But in reality, the user's physical GCash mobile app still has ₱30,000.
  - This creates an immediate desynchronization between Monetigia's displayed balance and the user's actual real-life bank balance, causing confusion.
  - Conversely, if the system does not deduct from the wallet, how does the system account for where the saved money actually lives?

### C. The Accumulation vs. Purchase Conflict (Double Counting vs. 0% Reset)
- Consider a ₱30,000 goal for a Laptop:
  - **Phase 1 (Saving):** Over several months, the user sets aside money (Transfer/Save) until the goal reaches 100% (₱30,000 saved).
  - **Phase 2 (Buying):** The user finally buys the Laptop from a store, logging an **`Expense`** of ₱30,000 tagged to the Laptop goal.
- **The Conflicts:**
  1. **If both are added:** The goal now counts ₱30,000 (from Phase 1) + ₱30,000 (from Phase 2) = ₱60,000 (200% funded).
  2. **If the purchase expense resets or deducts the saved amount:** The progress bar drops back to 0%. Having an empty 0% progress bar right after achieving a goal feels like a failure or a lost balance, rather than a completed victory.

### D. The Under-Budget / Partial Spending Edge Case
- Consider an event-based or flexible goal (e.g. a "Date Night" or "Party" sinking fund with a ₱3,000 target).
- The user saved ₱3,000 (100% full bar).
- On the actual date, the total bill came out to only **₱2,000**.
- **The Dilemma:**
  - The actual expense logged is only ₱2,000.
  - If the goal's completion is tied to the expense matching the target, the goal looks stuck at 66% completed even though the event is already finished and successful.
  - What happens to the remaining ₱1,000 leftover in the fund?

### E. The Emergency Withdrawal / Stolen Piggybank Edge Case
- The user is at 90% progress (e.g. ₱27,000 saved towards a ₱30,000 goal).
- An unexpected family or medical emergency occurs, and the user is forced to pull ₱15,000 out of that goal's saved money to pay for the emergency.
- **The Dilemma:**
  - How does a user record taking money *out* of a goal?
  - Currently, there is no negative contribution or withdrawal mechanism for goals.
  - What happens to the progress bar, the wallet balances, and the transaction history when a goal is raided for an emergency?
