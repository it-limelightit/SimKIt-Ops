export type PhaseValues = Record<string, any>;

export function phaseChanges(next: PhaseValues, previous: PhaseValues) {
  return Object.fromEntries(Object.entries(next).filter(([key, value]) =>
    JSON.stringify(value) !== JSON.stringify(previous[key]),
  ));
}

// Keep one current draft and serialize writes. Failed changes remain dirty so
// the next explicit save retries them rather than reporting an incomplete save.
export function createPhaseDraft<T extends PhaseValues>(
  initial: T,
  write: (changes: PhaseValues, previous: T, verify?: T) => Promise<boolean>,
  active: () => boolean,
  changed: (value: T, pending: number) => void,
) {
  let value = initial;
  let confirmed = initial;
  let pending = 0;
  let queue: Promise<boolean> = Promise.resolve(true);
  let revision = 0;

  function enqueue(delta: PhaseValues, explicit = false) {
    if (!active()) return Promise.resolve(false);
    value = { ...value, ...delta };
    const candidate = structuredClone(value);
    const candidateRevision = ++revision;
    pending++;
    changed(value, pending);
    const operation = queue.then(async () => {
      if (!active()) return false;
      // Several keystrokes can arrive while a request is in flight. The latest
      // draft contains all their changes, so don't write each obsolete snapshot.
      if (!explicit && candidateRevision < revision) return false;
      const success = await write(phaseChanges(candidate, confirmed), confirmed, explicit ? candidate : undefined);
      if (success) confirmed = candidate;
      return success;
    }).catch(() => false).finally(() => {
      pending--;
      if (active()) changed(value, pending);
    });
    queue = operation;
    return operation;
  }

  return {
    patch: (delta: Partial<T>) => enqueue(delta),
    setLocal: (next: T) => {
      if (!active()) return;
      value = next;
      changed(value, pending);
    },
    // A delayed caller may hold an older render's snapshot. Apply only its
    // intended changes to the current draft, retaining more recent edits.
    save: (next: T, rendered: T) => enqueue(phaseChanges(next, rendered), true),
    get value() { return value; },
  };
}

// Compare-and-set prevents another browser's intervening save from being
// replaced. Re-read on a conflict and merge only the changed top-level fields.
export async function persistPhaseChanges(
  client: any,
  phase: string,
  siteId: string,
  workerId: string | null,
  changes: PhaseValues,
  active: () => boolean,
  previous?: PhaseValues,
  verify?: PhaseValues,
) {
  for (let attempt = 0; attempt < 3; attempt++) {
    if (!active()) return false;
    const { data: row, error: readError } = await client.from(phase)
      .select("data,updated_at").eq("site_id", siteId).maybeSingle();
    if (readError) throw readError;
    if (!active()) return false;
    if (previous && Object.entries(changes).some(([key, value]) =>
      JSON.stringify(row?.data?.[key]) !== JSON.stringify(previous[key]) &&
      JSON.stringify(row?.data?.[key]) !== JSON.stringify(value),
    )) throw new Error("These form fields changed in another session. Reopen the form before saving.");
    const merged = { ...(row?.data || {}), ...changes };
    if (verify && Object.entries(verify).some(([key, value]) =>
      JSON.stringify(merged[key]) !== JSON.stringify(value),
    )) throw new Error("Saved form data changed in another session. Reopen it before submitting.");
    if (!Object.keys(changes).length) return true;
    const record = { site_id: siteId, ...(workerId ? { worker_id: workerId } : {}), data: merged, updated_at: new Date().toISOString() };
    const result = row
      ? await client.from(phase).update(record).eq("site_id", siteId)
          .eq("updated_at", row.updated_at).select("data")
      : await client.from(phase).insert(record).select("data");
    if (result.error) {
      if (result.error.code === "23505") continue;
      throw result.error;
    }
    if (!result.data?.length) continue;
    const saved = result.data[0].data;
    if (Object.entries(verify || changes).some(([key, value]) => JSON.stringify(saved[key]) !== JSON.stringify(value))) {
      throw new Error("Saved form verification failed");
    }
    return true;
  }
  throw new Error("The form changed in another session. Please retry saving.");
}
