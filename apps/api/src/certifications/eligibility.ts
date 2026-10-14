export interface RequiredCertification {
  id: string;
  name: string;
}

export interface HeldCertification {
  certificationTypeId: string;
  /** null = does not expire. */
  expiresAt: Date | null;
}

export type Eligibility =
  | { eligible: true }
  | {
      eligible: false;
      /** Required types the user holds no certificate for at all. */
      missing: RequiredCertification[];
      /** Required types the user holds, but every certificate expires before the shift ends. */
      expiring: RequiredCertification[];
    };

/**
 * The domain rule: a user may work a shift only if, for every certification the position
 * requires, they hold a certificate that is still valid when the shift ENDS (not merely
 * when it starts). Expiring exactly at the end is fine; one second earlier is not.
 *
 * Pure function: callers load the data (under RLS) and decide what to do with the result.
 */
export function evaluateEligibility(
  required: readonly RequiredCertification[],
  held: readonly HeldCertification[],
  shiftEndsAt: Date,
): Eligibility {
  const missing: RequiredCertification[] = [];
  const expiring: RequiredCertification[] = [];

  for (const type of required) {
    const certificates = held.filter((c) => c.certificationTypeId === type.id);
    if (certificates.length === 0) {
      missing.push(type);
    } else if (!certificates.some((c) => c.expiresAt === null || c.expiresAt >= shiftEndsAt)) {
      expiring.push(type);
    }
  }

  return missing.length === 0 && expiring.length === 0
    ? { eligible: true }
    : { eligible: false, missing, expiring };
}
