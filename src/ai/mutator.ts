/**
 * PassIntel AI - Smart Password Mutator
 * Generates strengthened variants of a password using 6 distinct mutation strategies.
 * Always returns results regardless of marginal score differences.
 */

import { evaluatePassword } from './evaluator';
import type { EvaluationResult } from './evaluator';

export interface MutationOption {
  mutatedPassword: string;
  result: EvaluationResult;
  editDistance: number;
  memorabilityScore: number;
  securityImprovement: number;
  explanation: string;
  strategy: string;
}

// Levenshtein edit distance
function editDist(a: string, b: string): number {
  const dp: number[][] = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
  return dp[a.length][b.length];
}

function memorability(original: string, mutated: string, dist: number): number {
  const maxLen = Math.max(original.length, mutated.length) || 1;
  let score = 100 - (dist / maxLen) * 55;
  if (mutated.length > original.length + 5) score -= 10;
  if (original.toLowerCase() === mutated.toLowerCase()) score += 15;
  return Math.min(100, Math.max(10, Math.round(score)));
}

// Leet-speak substitution table
const LEET: Record<string, string> = {
  a: '@', e: '3', i: '!', o: '0', s: '$', t: '7', g: '9', b: '8', l: '1', z: '2'
};

// Random symbol from a curated set
const SYMBOLS = ['!', '@', '#', '$', '%', '^', '&', '*', '_', '-', '+', '='];
const randomSymbol = (exclude = '') => SYMBOLS.filter(s => s !== exclude)[Math.floor(Math.random() * (SYMBOLS.length - 1))];

// Random digit string of given length
const randomDigits = (n: number) => Array.from({ length: n }, () => String(Math.floor(Math.random() * 10))).join('');

/**
 * Apply leet-speak substitution to every applicable character.
 */
function applyLeet(pwd: string): string {
  return pwd.split('').map(c => LEET[c.toLowerCase()] ?? c).join('');
}

/**
 * Alternate uppercase/lowercase for letter runs.
 */
function applyAlternateCase(pwd: string): string {
  let flip = true;
  return pwd.split('').map(c => {
    if (/[a-zA-Z]/.test(c)) {
      const out = flip ? c.toUpperCase() : c.toLowerCase();
      flip = !flip;
      return out;
    }
    return c;
  }).join('');
}

/**
 * Inject a symbol at every high-predictability position.
 */
function injectAtWeakSpots(pwd: string, evals: EvaluationResult['charEvaluations']): string {
  // Find top 2 most predictable positions (excluding pos 0)
  const spots = evals
    .map((e, i) => ({ i, prob: e.probability }))
    .filter(x => x.i > 0 && x.i < pwd.length - 1)
    .sort((a, b) => b.prob - a.prob)
    .slice(0, 2)
    .map(x => x.i)
    .sort((a, b) => b - a); // right-to-left so offsets don't shift

  let result = pwd;
  for (const idx of spots) {
    result = result.slice(0, idx) + randomSymbol() + result.slice(idx);
  }
  return result;
}

/**
 * Append a multi-class entropy anchor: symbol + 2 digits + symbol.
 */
function appendAnchor(pwd: string): string {
  const s1 = randomSymbol();
  const s2 = randomSymbol(s1);
  return `${pwd}${s1}${randomDigits(2)}${s2}`;
}

/**
 * Compound mutation: leet + capitalize first + entropy anchor.
 */
function applyCompound(pwd: string): string {
  const leeted = applyLeet(pwd);
  const capped = leeted.charAt(0).toUpperCase() + leeted.slice(1);
  return capped + '_' + randomDigits(3) + randomSymbol();
}

/**
 * Selective capitalization: uppercase only the high-predictability letters.
 */
function applySelectiveCaps(pwd: string, evals: EvaluationResult['charEvaluations']): string {
  return pwd.split('').map((c, i) => {
    const isWeak = evals[i]?.probability > 0.35;
    return /[a-zA-Z]/.test(c) ? (isWeak ? c.toUpperCase() : c.toLowerCase()) : c;
  }).join('');
}

/**
 * Extend password by inserting a memorable word fragment + symbol + digits.
 */
function applyExtension(pwd: string): string {
  const fragments = ['Sec', 'Key', 'Px', 'Zx', 'Qr', 'Vx'];
  const frag = fragments[Math.floor(Math.random() * fragments.length)];
  return pwd + frag + randomSymbol() + randomDigits(2);
}

/**
 * Main mutation function. Always returns up to 6 strategies.
 */
export function generateMutations(password: string): MutationOption[] {
  if (!password || password.length === 0) return [];

  const originalResult = evaluatePassword(password);
  const evals = originalResult.charEvaluations;

  // Build all strategies
  const strategies: Array<{ fn: () => string; strategy: string; explanation: string }> = [
    {
      strategy: 'Leet Substitution',
      explanation: 'Replaces common letters (a→@, e→3, o→0, etc.) with visually similar symbols to break dictionary patterns.',
      fn: () => applyLeet(password),
    },
    {
      strategy: 'Case Alternation',
      explanation: 'Alternates uppercase/lowercase across every character to disrupt predictable capitalization patterns attackers model.',
      fn: () => applyAlternateCase(password),
    },
    {
      strategy: 'Entropy Injection',
      explanation: 'Inserts high-entropy symbol characters at the positions identified as most predictable by the AI model.',
      fn: () => injectAtWeakSpots(password, evals),
    },
    {
      strategy: 'Entropy Anchor',
      explanation: 'Appends a multi-character random anchor (symbol + digits + symbol) to dramatically increase brute-force resistance.',
      fn: () => appendAnchor(password),
    },
    {
      strategy: 'Selective Caps',
      explanation: 'Capitalizes only the letters at positions the AI flagged as high-predictability, breaking structural patterns.',
      fn: () => applySelectiveCaps(password, evals),
    },
    {
      strategy: 'Compound Mutation',
      explanation: 'Combines leet-speak, forced capitalization, and an entropy anchor for maximum hardening in one transformation.',
      fn: () => applyCompound(password),
    },
    {
      strategy: 'Extension',
      explanation: 'Extends the password with a unique fragment + symbols to increase length and entropy without sacrificing memorability.',
      fn: () => applyExtension(password),
    },
  ];

  const seen = new Set<string>([password]);
  const options: MutationOption[] = [];

  for (const { fn, strategy, explanation } of strategies) {
    let mutated: string;
    try { mutated = fn(); } catch { continue; }

    // Skip if identical to original or already generated
    if (!mutated || seen.has(mutated)) continue;
    seen.add(mutated);

    const result = evaluatePassword(mutated);
    const dist = editDist(password, mutated);
    const mem = memorability(password, mutated, dist);
    // Show improvement as absolute score delta; can be 0 for cosmetic mutations — still show them
    const improvement = Math.max(0, Math.round(result.strengthPercent - originalResult.strengthPercent));

    options.push({ mutatedPassword: mutated, result, editDistance: dist, memorabilityScore: mem, securityImprovement: improvement, explanation, strategy });
  }

  // Sort by: security improvement desc, then memorability desc
  return options.sort((a, b) =>
    (b.securityImprovement - a.securityImprovement) || (b.memorabilityScore - a.memorabilityScore)
  );
}
