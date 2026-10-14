import { CertificationType } from './certification-type.entity';
import { Membership } from './membership.entity';
import { Organization } from './organization.entity';
import { Position } from './position.entity';
import { Profile } from './profile.entity';
import { Shift } from './shift.entity';
import { SwapRequest } from './swap-request.entity';
import { UserCertification } from './user-certification.entity';

export {
  CertificationType,
  Membership,
  Organization,
  Position,
  Profile,
  Shift,
  SwapRequest,
  UserCertification,
};

/** Explicit list instead of a glob: works identically under tsc, SWC and Vitest. */
export const ENTITIES = [
  CertificationType,
  Membership,
  Organization,
  Position,
  Profile,
  Shift,
  SwapRequest,
  UserCertification,
];
