// One table of cases for the NUT-support rule, shared by nutSupport.test.ts and sharedModules.test.ts
// (the backend copy of the table is in backend/src/__tests__/nutSupport.test.ts; sharedModules.test.ts runs both
// helper copies against this one).
export interface NutSupportCase {
  name: string
  entry: unknown
  /** isNutSupported: only an object with `supported: false` is "not supported". */
  supported: boolean
  /** isNutDeclaredSupported: absent / null are not declared at all. */
  declaredSupported: boolean
}

export const NUT_SUPPORT_CASES: NutSupportCase[] = [
  { name: 'supported: false', entry: { supported: false }, supported: false, declaredSupported: false },
  { name: 'supported: false with settings', entry: { supported: false, methods: [] }, supported: false, declaredSupported: false },
  { name: 'supported: true', entry: { supported: true }, supported: true, declaredSupported: true },
  { name: 'settings without a supported key', entry: { methods: [{ method: 'bolt11', unit: 'sat' }], disabled: false }, supported: true, declaredSupported: true },
  { name: 'empty object', entry: {}, supported: true, declaredSupported: true },
  { name: 'supported: "false" (a string) is not the boolean', entry: { supported: 'false' }, supported: true, declaredSupported: true },
  { name: 'supported: 0 is not the boolean', entry: { supported: 0 }, supported: true, declaredSupported: true },
  { name: 'true (non-object, non-null)', entry: true, supported: true, declaredSupported: true },
  { name: 'false (non-object)', entry: false, supported: true, declaredSupported: true },
  { name: 'a number', entry: 5, supported: true, declaredSupported: true },
  { name: 'an array', entry: [], supported: true, declaredSupported: true },
  { name: 'null', entry: null, supported: true, declaredSupported: false },
  { name: 'undefined (absent)', entry: undefined, supported: true, declaredSupported: false },
]
