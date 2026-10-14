// THROWAWAY (gate proof, never merged): SQL built by interpolation must fail lint.
import type { EntityManager } from 'typeorm';

export function gateProof(manager: EntityManager, id: string) {
  return manager.query(`select * from app.shifts where id = '${id}'`);
}
