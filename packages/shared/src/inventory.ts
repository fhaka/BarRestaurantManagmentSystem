import { z } from 'zod';
import { STOCK_UNITS, toMilli, type StockUnit } from './inventory-math.js';

export * from './inventory-math.js';

/** A quantity typed as text ("0.018", "1,5"); at most 3 decimals, stored as thousandths. */
const qty = z
  .union([z.string(), z.number()])
  .transform((v) => toMilli(v))
  .refine((v) => Number.isFinite(v), { message: 'quantity' });
const positiveQty = qty.refine((v) => v > 0, { message: 'quantityPositive' });
const nonNegativeQty = qty.refine((v) => v >= 0, { message: 'quantityPositive' });
const minorCost = z.number().int().min(0).max(100_000_000_000);
const name = z.string().trim().min(1).max(120);

export const supplierInputSchema = z.object({
  name,
  contact: z.string().trim().max(120).nullish(),
  phone: z.string().trim().max(40).nullish(),
  email: z
    .email()
    .nullish()
    .or(z.literal('').transform(() => null)),
  notes: z.string().trim().max(500).nullish(),
  active: z.boolean().default(true),
});

export const ingredientInputSchema = z.object({
  name,
  unit: z.enum(STOCK_UNITS),
  category: z.string().trim().max(60).default(''),
  minQty: nonNegativeQty.default(0),
  /** Cost of one whole unit (1 kg, 1 l, 1 piece) in minor units. */
  costPerUnitMinor: minorCost.default(0),
  supplierId: z.number().int().positive().nullish(),
  active: z.boolean().default(true),
});
/** Opening stock can only be set when the ingredient is created; afterwards use counts. */
export const ingredientCreateSchema = ingredientInputSchema.extend({
  stockQty: nonNegativeQty.default(0),
});

export const recipeSchema = z.object({
  lines: z
    .array(
      z.object({
        ingredientId: z.number().int().positive(),
        qty: positiveQty,
        variantId: z.number().int().positive().nullish(),
      }),
    )
    .max(60),
});

export const WASTE_TYPES = ['waste', 'staff_meal'] as const;
export const wasteSchema = z
  .object({
    type: z.enum(WASTE_TYPES).default('waste'),
    /** An ingredient… */
    ingredientId: z.number().int().positive().optional(),
    qty: positiveQty.optional(),
    /** …or whole dishes (their recipe is booked out). */
    menuItemId: z.number().int().positive().optional(),
    variantId: z.number().int().positive().nullish(),
    dishes: z.number().int().min(1).max(500).optional(),
    reason: z.string().trim().min(3).max(200),
  })
  .refine(
    (w) =>
      (w.ingredientId !== undefined && w.qty !== undefined) !==
      (w.menuItemId !== undefined && w.dishes !== undefined),
    {
      message: 'ingredientOrDish',
      path: ['ingredientId'],
    },
  );

export const purchaseOrderSchema = z.object({
  supplierId: z.number().int().positive(),
  notes: z.string().trim().max(500).nullish(),
  expectedAt: z.iso.date().nullish(),
  lines: z
    .array(
      z.object({
        ingredientId: z.number().int().positive(),
        qty: positiveQty,
        unitCostMinor: minorCost,
      }),
    )
    .min(1)
    .max(100),
});

export const receiveSchema = z.object({
  lines: z
    .array(
      z.object({
        lineId: z.number().int().positive(),
        qty: positiveQty,
        /** The price actually paid, if different from the order. */
        unitCostMinor: minorCost.optional(),
      }),
    )
    .min(1)
    .max(100),
});

export const stockCountCreateSchema = z.object({
  /** Empty = every active ingredient; otherwise one category (plan §5.9). */
  category: z.string().trim().max(60).nullish(),
  note: z.string().trim().max(500).nullish(),
});

export const stockCountLinesSchema = z.object({
  lines: z
    .array(
      z.object({ ingredientId: z.number().int().positive(), counted: nonNegativeQty.nullable() }),
    )
    .max(1000),
});

// ---- Response types ----------------------------------------------------------------------------

export interface Supplier {
  id: number;
  name: string;
  contact: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  active: boolean;
}

export interface Ingredient {
  id: number;
  name: string;
  unit: StockUnit;
  category: string;
  stockMilli: number;
  minMilli: number;
  costPerUnitMinor: number;
  valueMinor: number;
  supplierId: number | null;
  supplierName: string | null;
  active: boolean;
  low: boolean;
}

export interface RecipeLine {
  ingredientId: number;
  ingredientName: string;
  unit: StockUnit;
  qtyMilli: number;
  variantId: number | null;
  costMinor: number;
}

/** A menu item or option with its recipe, food cost and margin (plan §5.9). */
export interface ItemCosting {
  kind: 'item' | 'modifier';
  id: number;
  name: string;
  categoryName: string | null;
  priceMinor: number;
  taxRateBp: number;
  lines: RecipeLine[];
  costMinor: number;
  netMinor: number;
  marginMinor: number;
  marginBp: number;
  variants: { id: number; name: string; priceMinor: number; costMinor: number; marginBp: number }[];
}

export const STOCK_MOVEMENT_TYPES = [
  'sale',
  'sale_reversal',
  'purchase',
  'waste',
  'staff_meal',
  'count_adjust',
  'transfer',
] as const;
export type StockMovementType = (typeof STOCK_MOVEMENT_TYPES)[number];

export interface StockMovement {
  id: number;
  ingredientId: number;
  ingredientName: string;
  unit: StockUnit;
  type: StockMovementType;
  qtyMilli: number;
  unitCostMinor: number;
  reason: string | null;
  refType: string | null;
  refId: number | null;
  userName: string | null;
  createdAt: string;
}

export type PurchaseOrderStatus =
  'draft' | 'sent' | 'partially_received' | 'received' | 'cancelled';

export interface PurchaseOrder {
  id: number;
  number: number;
  supplierId: number;
  supplierName: string;
  status: PurchaseOrderStatus;
  notes: string | null;
  expectedAt: string | null;
  totalMinor: number;
  createdAt: string;
  sentAt: string | null;
  receivedAt: string | null;
  lines: {
    id: number;
    ingredientId: number;
    ingredientName: string;
    unit: StockUnit;
    orderedMilli: number;
    receivedMilli: number;
    unitCostMinor: number;
  }[];
}

export interface StockCount {
  id: number;
  category: string | null;
  status: 'open' | 'applied' | 'cancelled';
  note: string | null;
  createdBy: string;
  createdAt: string;
  appliedAt: string | null;
  lines: {
    ingredientId: number;
    ingredientName: string;
    unit: StockUnit;
    expectedMilli: number;
    countedMilli: number | null;
    costPerUnitMinor: number;
    varianceMilli: number | null;
    varianceMinor: number | null;
  }[];
  varianceMinor: number;
}

export interface StockLowData {
  ingredientId: number;
  name: string;
  stockMilli: number;
  minMilli: number;
  unit: StockUnit;
}
