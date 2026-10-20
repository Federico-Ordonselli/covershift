import { InitSchema1791980455093 } from './1791980455093-init-schema';
import { RlsPolicies1791980455094 } from './1791980455094-rls-policies';
import { OrgTimezoneValidation1792000000000 } from './1792000000000-org-timezone-validation';

import { ShiftOverride1792400000000 } from './1792400000000-shift-override';

/** Ordered explicitly; no glob loading. */
export const MIGRATIONS = [
  InitSchema1791980455093,
  RlsPolicies1791980455094,
  OrgTimezoneValidation1792000000000,
  ShiftOverride1792400000000,
];
