import { type Shift, CreateShiftSchema } from '@covershift/shared';
import { TZDate } from '@date-fns/tz';
import { format } from 'date-fns';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useApi } from '../../lib/api/ApiProvider';
import { queryKeys } from '../../lib/api/queryKeys';
import { ErrorAlert, Alert } from '../../ui/Alert';
import { Button } from '../../ui/Button';
import ui from '../../ui/ui.module.css';
import styles from '../swaps/swaps.module.css';
import editorStyles from './ShiftEditor.module.css';
import { usePositions } from '../orgs/hooks';
import { useOrg } from '../orgs/orgContext';

function instant(value: string, zone: string): string | undefined {
  if (!value) return;
  const [date, time] = value.split('T');
  const [y, m, d] = date!.split('-').map(Number);
  const [h, min] = time!.split(':').map(Number);
  const parsed = new TZDate(y!, m! - 1, d!, h!, min!, zone);
  if (Number.isNaN(parsed.getTime()) || format(parsed, "yyyy-MM-dd'T'HH:mm") !== value) return;
  return parsed.toISOString();
}

export function ShiftEditor({
  shift,
  day,
  onClose,
  onSaved,
}: {
  shift: Shift | null;
  day: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { org, timeZone } = useOrg();
  const api = useApi();
  const cache = useQueryClient();
  const positions = usePositions(org.id);
  const dialog = useRef<HTMLDialogElement>(null);
  const [positionId, setPosition] = useState(shift?.positionId ?? '');
  const [start, setStart] = useState(
    shift ? format(new TZDate(shift.startsAt, timeZone), "yyyy-MM-dd'T'HH:mm") : `${day}T08:00`,
  );
  const [end, setEnd] = useState(
    shift ? format(new TZDate(shift.endsAt, timeZone), "yyyy-MM-dd'T'HH:mm") : `${day}T16:00`,
  );
  const [assignee, setAssignee] = useState(shift?.assignedUserId ?? '');
  const [override, setOverride] = useState(false);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<unknown>(null);
  const startsAt = instant(start, timeZone);
  const endsAt = instant(end, timeZone);
  const valid = !!positionId && !!startsAt && !!endsAt && Date.parse(endsAt) > Date.parse(startsAt);
  const query = {
    organizationId: org.id,
    positionId,
    startsAt: startsAt ?? '',
    endsAt: endsAt ?? '',
    ...(shift ? { shiftId: shift.id } : {}),
  };
  const candidates = useQuery({
    queryKey: ['org', org.id, 'candidates', query],
    queryFn: () => api.assignmentCandidates(query),
    enabled: valid,
    staleTime: 0,
  });
  const selected = candidates.data?.find((c) => c.userId === assignee);
  const allowed =
    !assignee ||
    (!!selected &&
      (selected.eligible || (override && selected.canOverride && reason.trim().length >= 5)));
  const reset = () => {
    setAssignee('');
    setOverride(false);
    setReason('');
    setFailure(null);
  };
  useEffect(() => {
    const el = dialog.current;
    el?.showModal();
    return () => el?.close();
  }, []);

  return (
    <dialog
      ref={dialog}
      className={styles.dialog}
      aria-labelledby="shift-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!saving) onClose();
      }}
    >
      <h2 id="shift-title">{shift ? 'Edit shift' : 'Create shift'}</h2>
      <p>Times in {timeZone}</p>
      {failure ? <ErrorAlert error={failure} /> : null}
      {positions.isError ? (
        <ErrorAlert error={positions.error} onRetry={() => void positions.refetch()} />
      ) : null}
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (!valid || !allowed || !candidates.data || candidates.isFetching || candidates.isError)
            return;
          const body = CreateShiftSchema.parse({
            ...query,
            assignedUserId: assignee || null,
            overrideReason: override && selected && !selected.eligible ? reason : null,
          });
          setSaving(true);
          setFailure(null);
          try {
            if (shift) await api.updateShift(shift.id, body);
            else await api.createShift(body);
            await cache.invalidateQueries({ queryKey: queryKeys.org(org.id) });
            onSaved();
          } catch (error) {
            setFailure(error);
            void candidates.refetch();
          } finally {
            setSaving(false);
          }
        }}
      >
        <fieldset disabled={saving} className={editorStyles.fields}>
          <div className={ui.field}>
            <label htmlFor="shift-position">Position</label>
            <select
              id="shift-position"
              required
              value={positionId}
              onChange={(e) => {
                setPosition(e.target.value);
                reset();
              }}
            >
              <option value="">Choose position</option>
              {positions.data?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div className={ui.field}>
            <label htmlFor="shift-start">Starts at</label>
            <input
              id="shift-start"
              type="datetime-local"
              required
              value={start}
              onChange={(e) => {
                setStart(e.target.value);
                reset();
              }}
            />
          </div>
          <div className={ui.field}>
            <label htmlFor="shift-end">Ends at</label>
            <input
              id="shift-end"
              type="datetime-local"
              required
              value={end}
              onChange={(e) => {
                setEnd(e.target.value);
                reset();
              }}
            />
          </div>
          {!valid ? (
            <p role="status">
              Choose a position and a valid time range. The end must follow the start.
            </p>
          ) : null}
          {candidates.isError ? (
            <ErrorAlert error={candidates.error} onRetry={() => void candidates.refetch()} />
          ) : null}
          <div className={ui.field}>
            <label htmlFor="shift-assignee">Assign to</label>
            <select
              id="shift-assignee"
              value={assignee}
              disabled={!valid || candidates.isFetching || !candidates.data || candidates.isError}
              onChange={(e) => setAssignee(e.target.value)}
            >
              <option value="">Unassigned</option>
              {candidates.data
                ?.filter((c) => c.eligible || (override && c.canOverride))
                .map((c) => (
                  <option key={c.userId} value={c.userId}>
                    {c.fullName}
                    {!c.eligible ? ' — override required' : ''}
                  </option>
                ))}
            </select>
            {valid && candidates.isFetching ? (
              <span role="status">Checking availability…</span>
            ) : null}
            {valid && candidates.data && !candidates.data.some((c) => c.eligible) ? (
              <span>No eligible people for this shift.</span>
            ) : null}
          </div>
          {valid && candidates.data ? (
            <>
              <Button
                variant="secondary"
                aria-pressed={override}
                onClick={() => {
                  setOverride(!override);
                  setAssignee('');
                  setReason('');
                }}
              >
                {override ? 'Disable override' : 'Override certifications'}
              </Button>
              {override ? (
                <>
                  <Alert tone="warning" title="Certification override">
                    <p>
                      You may assign someone with missing or expired certifications. Overlapping
                      shifts remain blocked.
                    </p>
                  </Alert>
                  <div className={ui.field}>
                    <label htmlFor="override-reason">Override reason</label>
                    <textarea
                      id="override-reason"
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      minLength={5}
                      maxLength={500}
                      required={!!selected && !selected.eligible}
                    />
                  </div>
                </>
              ) : null}
              <details>
                <summary>Eligibility details</summary>
                <ul>
                  {candidates.data.map((c) => (
                    <li key={c.userId}>
                      <strong>{c.fullName}</strong>:{' '}
                      {c.eligible ? 'Available and certified' : c.reasons.join('; ')}
                    </li>
                  ))}
                </ul>
              </details>
            </>
          ) : null}
          {selected && !selected.eligible ? <p>{selected.reasons.join('; ')}</p> : null}
          <div className={styles.dialogActions}>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={
                !valid ||
                !allowed ||
                !candidates.data ||
                candidates.isFetching ||
                candidates.isError
              }
            >
              {saving ? 'Saving…' : 'Save shift'}
            </Button>
          </div>
        </fieldset>
      </form>
    </dialog>
  );
}
