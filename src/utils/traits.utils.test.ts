import { describe, it, expect } from 'vitest';
import { transformTrait, Trait } from './traits.utils';

describe('Traits Utilities', () => {
  describe('transformTrait', () => {
    it('should group traits by traitType', () => {
      const traits: Trait[] = [
        { traitType: 'Background', value: 'Blue' },
        { traitType: 'Background', value: 'Red' },
        { traitType: 'Eyes', value: 'Laser' },
      ];

      const result = transformTrait(traits);

      expect(result).toHaveLength(2);
      expect(result).toEqual([
        { attributes: [
          { traitType: 'Background', value: 'Blue' },
          { traitType: 'Background', value: 'Red' },
        ]},
        { attributes: [
          { traitType: 'Eyes', value: 'Laser' },
        ]},
      ]);
    });

    it('should handle single trait', () => {
      const traits: Trait[] = [
        { traitType: 'Rarity', value: 'Legendary' },
      ];

      const result = transformTrait(traits);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        attributes: [{ traitType: 'Rarity', value: 'Legendary' }],
      });
    });

    it('should handle empty array', () => {
      const result = transformTrait([]);
      expect(result).toEqual([]);
    });

    it('should handle numeric trait values', () => {
      const traits: Trait[] = [
        { traitType: 'Level', value: 5 },
        { traitType: 'Level', value: 10 },
      ];

      const result = transformTrait(traits);

      expect(result).toHaveLength(1);
      expect(result[0].attributes).toContainEqual({ traitType: 'Level', value: 5 });
      expect(result[0].attributes).toContainEqual({ traitType: 'Level', value: 10 });
    });

    it('should handle mixed string and numeric values', () => {
      const traits: Trait[] = [
        { traitType: 'Type', value: 'Common' },
        { traitType: 'Power', value: 100 },
        { traitType: 'Type', value: 'Rare' },
      ];

      const result = transformTrait(traits);

      expect(result).toHaveLength(2);
    });

    it('should preserve trait order within groups', () => {
      const traits: Trait[] = [
        { traitType: 'Color', value: 'Red' },
        { traitType: 'Color', value: 'Green' },
        { traitType: 'Color', value: 'Blue' },
      ];

      const result = transformTrait(traits);

      expect(result).toHaveLength(1);
      expect(result[0].attributes[0].value).toBe('Red');
      expect(result[0].attributes[1].value).toBe('Green');
      expect(result[0].attributes[2].value).toBe('Blue');
    });

    it('should handle many different trait types', () => {
      const traits: Trait[] = [
        { traitType: 'A', value: '1' },
        { traitType: 'B', value: '2' },
        { traitType: 'C', value: '3' },
        { traitType: 'D', value: '4' },
        { traitType: 'E', value: '5' },
      ];

      const result = transformTrait(traits);

      expect(result).toHaveLength(5);
      result.forEach(group => {
        expect(group.attributes).toHaveLength(1);
      });
    });
  });
});
