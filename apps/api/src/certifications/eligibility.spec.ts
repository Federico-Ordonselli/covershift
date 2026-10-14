import { describe, expect, it } from 'vitest';
import { evaluateEligibility } from './eligibility';

const XRAY = { id: 'xray', name: 'X-ray screening' };
const ETD = { id: 'etd', name: 'Explosive trace detection' };
const SHIFT_END = new Date('2030-06-01T14:00:00Z');

const held = (certificationTypeId: string, expiresAt: string | null) => ({
  certificationTypeId,
  expiresAt: expiresAt === null ? null : new Date(expiresAt),
});

describe('evaluateEligibility', () => {
  it('is eligible when the position requires nothing', () => {
    expect(evaluateEligibility([], [], SHIFT_END)).toEqual({ eligible: true });
  });

  it('is eligible with a non-expiring certificate', () => {
    expect(evaluateEligibility([XRAY], [held('xray', null)], SHIFT_END)).toEqual({
      eligible: true,
    });
  });

  it('is eligible when the certificate expires exactly when the shift ends', () => {
    expect(evaluateEligibility([XRAY], [held('xray', '2030-06-01T14:00:00Z')], SHIFT_END)).toEqual({
      eligible: true,
    });
  });

  it('is not eligible when a required certificate is missing', () => {
    expect(evaluateEligibility([XRAY, ETD], [held('xray', null)], SHIFT_END)).toEqual({
      eligible: false,
      missing: [ETD],
      expiring: [],
    });
  });

  it('is not eligible when the certificate expires before the shift ends (even mid-shift)', () => {
    expect(evaluateEligibility([XRAY], [held('xray', '2030-06-01T13:59:59Z')], SHIFT_END)).toEqual({
      eligible: false,
      missing: [],
      expiring: [XRAY],
    });
  });

  it('is not eligible with an already expired certificate (reported as expiring, not missing)', () => {
    expect(evaluateEligibility([XRAY], [held('xray', '2020-01-01T00:00:00Z')], SHIFT_END)).toEqual({
      eligible: false,
      missing: [],
      expiring: [XRAY],
    });
  });

  it('uses the best certificate when the user holds several of the same type (renewals)', () => {
    expect(
      evaluateEligibility(
        [XRAY],
        [held('xray', '2030-01-01T00:00:00Z'), held('xray', '2031-01-01T00:00:00Z')],
        SHIFT_END,
      ),
    ).toEqual({ eligible: true });
  });

  it('ignores certificates of types the position does not require', () => {
    expect(evaluateEligibility([XRAY], [held('etd', null)], SHIFT_END)).toEqual({
      eligible: false,
      missing: [XRAY],
      expiring: [],
    });
  });

  it('reports missing and expiring together', () => {
    expect(
      evaluateEligibility([XRAY, ETD], [held('xray', '2030-05-01T00:00:00Z')], SHIFT_END),
    ).toEqual({ eligible: false, missing: [ETD], expiring: [XRAY] });
  });
});
