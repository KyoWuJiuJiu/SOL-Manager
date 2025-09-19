/**
 * Centralised mapping of Feishu Bitable field display names used by the plugin.
 * Keeping the field name strings in one place helps avoid typos and makes
 * future renaming straightforward.
 */
export const FIELD_KEYS = {
  itemHeight: { name: "Item Height (inch)", type: 2 },
  itemWidth: { name: "Item Width (inch)", type: 2 },
  itemDepth: { name: "Item Depth (inch)", type: 2 },
  itemWeight: { name: "Item Weight ( g )", type: 2 },
  innerWidth: { name: "Inner Width (inch)", type: 2 },
  innerDepth: { name: "Inner Depth (inch)", type: 2 },
  innerHeight: { name: "Inner Height (inch)", type: 2 },
  innerWeight: { name: "Inner Weight (lbs)", type: 2 },
  innerQty: { name: "Inner Qty", type: 2 },
  masterQty: { name: "Master Qty", type: 2 },
  masterHeight: { name: "Master Height (inch)", type: 2 },
  masterWidth: { name: "Master Width (inch)", type: 2 },
  masterDepth: { name: "Master Depth (inch)", type: 2 },
  grossWeight: { name: "G. W (lbs)", type: 2 },
  netWeight: { name: "N.W. (kg)", type: 2 },
} as const;

export type FieldKey = keyof typeof FIELD_KEYS;

export interface FieldIds {
  itemHeight: string;
  itemWidth: string;
  itemDepth: string;
  itemWeight: string;
  innerWidth: string;
  innerDepth: string;
  innerHeight: string;
  innerWeight: string;
  innerQty: string;
  masterQty: string;
  masterHeight: string;
  masterWidth: string;
  masterDepth: string;
  grossWeight: string;
  netWeight: string;
}
