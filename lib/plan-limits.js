import fs from 'fs';
import path from 'path';

// Capacity limits by plan.
//
// Each plan sets how many operations one user may run at once, and how many tabs one
// session may hold. The "standard" plan keeps today's defaults, so an install with no
// plan settings behaves exactly as before.
//
// Limits per plan come from config (CHUSKY_PLAN_LIMITS, a JSON object). A user's plan is
// set by a trusted caller, never by the user. See the internal plan route in server.js.

// payg is pay-as-you-go. starter, pro and scale are subscriptions (updates/03.md). "standard" is
// the default for installs with no plan set, and it keeps today's defaults.
export const DEFAULT_PLANS = Object.freeze({
  standard: { maxConcurrentPerUser: 3, maxTabsPerSession: 10 },
  payg: { maxConcurrentPerUser: 10, maxTabsPerSession: 10 },
  starter: { maxConcurrentPerUser: 10, maxTabsPerSession: 10 },
  pro: { maxConcurrentPerUser: 25, maxTabsPerSession: 25 },
  scale: { maxConcurrentPerUser: 25, maxTabsPerSession: 50 },
});

const FIELDS = ['maxConcurrentPerUser', 'maxTabsPerSession'];

function positiveInt(value, fallback) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

// Merge config overrides onto the defaults. Unknown fields and bad numbers are ignored.
export function resolvePlans(overrides = {}, { standardOverride = {} } = {}) {
  const plans = {};
  for (const [name, base] of Object.entries(DEFAULT_PLANS)) {
    const patch = { ...(overrides[name] || {}) };
    if (name === 'standard') Object.assign(patch, standardOverride);
    const merged = {};
    for (const field of FIELDS) {
      merged[field] = positiveInt(patch[field], base[field]);
    }
    plans[name] = merged;
  }
  // Plans defined only in config (not in the defaults) are added as given.
  for (const [name, patch] of Object.entries(overrides)) {
    if (plans[name] || !patch || typeof patch !== 'object') continue;
    plans[name] = {
      maxConcurrentPerUser: positiveInt(patch.maxConcurrentPerUser, 3),
      maxTabsPerSession: positiveInt(patch.maxTabsPerSession, 10),
    };
  }
  return plans;
}

// filePath: optional JSON file that keeps user -> plan assignments across restarts.
// Writes are atomic (temp file, then rename). Without a file, assignments live in memory only.
// The account part of a gateway user id ("accountId:endUserId"). Self-hosted ids have no colon.
function accountOf(userId) {
  return String(userId).split(':')[0];
}

export function createPlanLimits({ plans, defaultPlan = 'standard', filePath = null }) {
  const assigned = new Map(); // userId -> plan name (set by an admin, one end user)
  const accountPlans = new Map(); // accountId -> plan name (set from the frontend's key check)
  const fallback = plans[defaultPlan] ? defaultPlan : 'standard';

  if (filePath) {
    try {
      const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      for (const [userId, name] of Object.entries(raw || {})) {
        if (plans[name]) assigned.set(userId, name);
      }
    } catch {
      // no file yet, or unreadable: start with no assignments
    }
  }

  function persist() {
    if (!filePath) return;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tmp = `${filePath}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(Object.fromEntries(assigned)));
    fs.renameSync(tmp, filePath);
  }

  return {
    // One end user's plan wins. Otherwise the developer account's plan. Otherwise the default.
    planFor(userId) {
      return assigned.get(String(userId)) || accountPlans.get(accountOf(userId)) || fallback;
    },
    // Set from the frontend's key check on every customer call (cached for 30 seconds).
    // Not saved to disk: the next key check sets it again.
    setAccountPlan(accountId, name) {
      if (!plans[name]) return false;
      accountPlans.set(String(accountId), name);
      return true;
    },
    limitsFor(userId) {
      const name = this.planFor(userId);
      return { plan: name, ...plans[name] };
    },
    setPlan(userId, name) {
      if (!plans[name]) return false;
      assigned.set(String(userId), name);
      persist();
      return true;
    },
    clearPlan(userId) {
      assigned.delete(String(userId));
      persist();
    },
    names() {
      return Object.keys(plans);
    },
  };
}
