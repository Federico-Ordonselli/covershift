import { CreateSwapRequestSchema, type Shift } from '@covershift/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { toUserMessage, type UserMessage } from '../../errors/messages';
import { formatDay, formatTime } from '../../lib/time/week';
import { TZDate } from '@date-fns/tz';
import { Alert } from '../../ui/Alert';
import { Button } from '../../ui/Button';
import ui from '../../ui/ui.module.css';
import { useMembers } from '../orgs/hooks';
import { useOrg } from '../orgs/orgContext';
import { useCreateSwap } from './hooks';
import styles from './swaps.module.css';

/** The form's fields; `note` keeps the shared contract's rule (trimmed, ≤ 500). */
export const OfferFormSchema = CreateSwapRequestSchema.pick({ note: true }).extend({
  /** '' = open offer to anyone in the organization. */
  targetUserId: z.string(),
});
type OfferForm = z.input<typeof OfferFormSchema>;

export function OfferSwapDialog({
  shift,
  onClose,
  onOffered,
}: {
  shift: Shift;
  onClose: () => void;
  onOffered: (open: boolean) => void;
}) {
  const { org, timeZone, userId } = useOrg();
  const members = useMembers(org.id);
  const create = useCreateSwap(org.id);
  const dialog = useRef<HTMLDialogElement>(null);
  const [failure, setFailure] = useState<UserMessage | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<OfferForm>({
    resolver: zodResolver(OfferFormSchema),
    defaultValues: { targetUserId: '', note: '' },
  });

  useEffect(() => {
    const el = dialog.current;
    if (el && !el.open) el.showModal();
    return () => el?.close();
  }, []);

  const onSubmit = handleSubmit(async ({ targetUserId, note }) => {
    setFailure(null);
    try {
      await create.mutateAsync({
        shiftId: shift.id,
        targetUserId: targetUserId || null,
        ...(note ? { note } : {}),
      });
      onOffered(!targetUserId);
    } catch (error) {
      const message = toUserMessage(error);
      const unmapped = (message.fieldErrors ?? []).filter((e) => {
        if (e.path === 'note' || e.path === 'targetUserId') {
          setError(e.path, { message: e.message });
          return false;
        }
        return true;
      });
      if (message.kind !== 'validation' || unmapped.length > 0) setFailure(message);
    }
  });

  const coworkers = (members.data ?? []).filter((m) => m.userId !== userId);
  const when = `${formatDay(new TZDate(shift.startsAt, timeZone))} ${formatTime(shift.startsAt, timeZone)}–${formatTime(shift.endsAt, timeZone)}`;

  return (
    <dialog
      ref={dialog}
      className={styles.dialog}
      aria-labelledby="offer-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <h2 id="offer-title">Offer your shift</h2>
      <p>{when}</p>
      {failure ? (
        <Alert tone="error" title={failure.title}>
          {failure.detail ? <p>{failure.detail}</p> : null}
        </Alert>
      ) : null}
      <form onSubmit={onSubmit} noValidate>
        <div className={ui.field}>
          <label htmlFor="offer-target">Offer to</label>
          <select
            id="offer-target"
            aria-invalid={errors.targetUserId ? true : undefined}
            aria-describedby={errors.targetUserId ? 'offer-target-error' : undefined}
            {...register('targetUserId')}
          >
            <option value="">Anyone (open offer)</option>
            {coworkers.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.fullName}
              </option>
            ))}
          </select>
          {errors.targetUserId ? (
            <span id="offer-target-error" className={ui.fieldError}>
              {errors.targetUserId.message}
            </span>
          ) : null}
        </div>
        <div className={ui.field}>
          <label htmlFor="offer-note">Note (optional)</label>
          <textarea
            id="offer-note"
            rows={3}
            aria-invalid={errors.note ? true : undefined}
            aria-describedby={errors.note ? 'offer-note-error' : undefined}
            {...register('note')}
          />
          {errors.note ? (
            <span id="offer-note-error" className={ui.fieldError}>
              {errors.note.message}
            </span>
          ) : null}
        </div>
        <div className={styles.dialogActions}>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Sending…' : 'Send offer'}
          </Button>
        </div>
      </form>
    </dialog>
  );
}
