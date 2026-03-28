import { describe, it, expect } from 'vitest';
import { generateAnkiGuid } from '../../src/features/study/study-export.js';

describe('Export engine - Anki GUID', () => {
  it('should generate deterministic integers for the same inputs', () => {
    const guid1 = generateAnkiGuid('set-abc', 'card-123');
    const guid2 = generateAnkiGuid('set-abc', 'card-123');
    const guid3 = generateAnkiGuid('set-def', 'card-123');
    
    expect(guid1).toBe(guid2);
    expect(guid1).not.toBe(guid3);
    
    // Check if it is a non-negative integer
    expect(Number.isInteger(guid1)).toBe(true);
    expect(guid1).toBeGreaterThanOrEqual(0);
  });
});
