/**
 * PassIntel AI - Controlled Generative Password Engine
 * Simulates temperature scaling and top-k character sampling for sequence generation.
 */

const CHAR_POOLS = {
  lower: 'abcdefghijklmnopqrstuvwxyz',
  upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  digits: '0123456789',
  special: '!@#$%^&*()_+-=[]{}|;:\',.<>/?`~\\"'
};

export interface GenerationOptions {
  length: number;
  temperature: number; // 0.1 (very structured/predictable) to 2.0 (highly random)
  includeUpper: boolean;
  includeDigits: boolean;
  includeSpecial: boolean;
}

/**
 * Generates an AI password using probability distribution sampling with temperature scaling.
 */
export function generateAIPassword(options: GenerationOptions): string {
  const { length, temperature, includeUpper, includeDigits, includeSpecial } = options;

  let pool = CHAR_POOLS.lower;
  if (includeUpper) pool += CHAR_POOLS.upper;
  if (includeDigits) pool += CHAR_POOLS.digits;
  if (includeSpecial) pool += CHAR_POOLS.special;

  if (pool.length === 0) pool = CHAR_POOLS.lower;

  const chars = pool.split('');
  let password = '';

  // Helper to sample a character from the pool based on weights
  for (let i = 0; i < length; i++) {
    // Generate base probabilities for each character in the pool
    // To make it look like a model, we introduce transition preferences:
    // e.g. following letters with letters, capitalization at start, ending with digits/specials
    const baseWeights = chars.map(char => {
      let weight = 1.0;

      // Start preference
      if (i === 0) {
        if (CHAR_POOLS.upper.includes(char)) weight *= 4.0;
        if (CHAR_POOLS.lower.includes(char)) weight *= 3.0;
        if (CHAR_POOLS.digits.includes(char)) weight *= 0.5;
        if (CHAR_POOLS.special.includes(char)) weight *= 0.2;
      } else {
        const prevChar = password[i - 1];
        
        // Character transition preferences
        if (CHAR_POOLS.lower.includes(prevChar) && CHAR_POOLS.lower.includes(char)) weight *= 2.5;
        if (CHAR_POOLS.upper.includes(prevChar) && CHAR_POOLS.lower.includes(char)) weight *= 2.0;
        if (CHAR_POOLS.digits.includes(prevChar) && CHAR_POOLS.digits.includes(char)) {
          // Sequential digit boost
          const prevCode = prevChar.charCodeAt(0);
          const currCode = char.charCodeAt(0);
          if (currCode === prevCode + 1) weight *= 8.0; // e.g. 1 -> 2
          weight *= 1.5;
        }

        // End preferences (digits/symbols at the end of the sequence)
        if (i >= length - 3) {
          if (CHAR_POOLS.digits.includes(char)) weight *= 5.0;
          if (CHAR_POOLS.special.includes(char)) weight *= 4.0;
        }
      }

      return weight;
    });

    // Apply Temperature Scaling
    // P_scaled(c) = P(c)^(1/T) / Sum(P(x)^(1/T))
    const scaledWeights = baseWeights.map(w => Math.pow(w, 1 / Math.max(0.01, temperature)));
    const totalWeight = scaledWeights.reduce((sum, w) => sum + w, 0);
    const probabilities = scaledWeights.map(w => w / totalWeight);

    // Cumulative probability sampling
    const randomVal = Math.random();
    let cumulative = 0;
    let selectedChar = chars[0];

    for (let idx = 0; idx < chars.length; idx++) {
      cumulative += probabilities[idx];
      if (randomVal <= cumulative) {
        selectedChar = chars[idx];
        break;
      }
    }

    password += selectedChar;
  }

  return password;
}
