import { type OrganizationSummary } from '@covershift/shared';
import { useOutletContext } from 'react-router';

export interface OrgContext {
  org: OrganizationSummary;
  /** The org's IANA zone, or 'UTC' if the stored zone isn't one this browser knows. */
  timeZone: string;
  timeZoneValid: boolean;
  userId: string;
  isScheduler: boolean;
}

export function useOrg(): OrgContext {
  return useOutletContext<OrgContext>();
}

export function resolveTimeZone(zone: string): { timeZone: string; valid: boolean } {
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone });
    return { timeZone: zone, valid: true };
  } catch {
    return { timeZone: 'UTC', valid: false };
  }
}
