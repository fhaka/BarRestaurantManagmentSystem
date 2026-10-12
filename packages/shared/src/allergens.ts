/** The 14 allergens EU Regulation 1169/2011 requires restaurants to declare. */
export const ALLERGENS = [
  'gluten',
  'crustaceans',
  'eggs',
  'fish',
  'peanuts',
  'soybeans',
  'milk',
  'nuts',
  'celery',
  'mustard',
  'sesame',
  'sulphites',
  'lupin',
  'molluscs',
] as const;
export type Allergen = (typeof ALLERGENS)[number];

export const DIETARY_TAGS = ['vegan', 'vegetarian', 'gluten_free', 'spicy'] as const;
export type DietaryTag = (typeof DIETARY_TAGS)[number];
