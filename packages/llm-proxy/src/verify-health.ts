import { HEALTH_PATH, type HealthResponse, verifyHealth } from "./health.js";

export type ProbeInput = {
  url: string;
  instanceId: string;
  capability: string;
  challenge: string;
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
};

// Probe a port holder to prove it is *our* live proxy: GET the reserved health
// path with a fresh challenge and check the returned proof under our capability
// via the constant-time verifier. Any failure mode — network throw, non-200,
// malformed JSON, wrong instance, wrong/off-by-one proof — resolves to false so
// a foreign holder is never mistaken for ours.
export async function probeIsMegasaverProxy(input: ProbeInput): Promise<boolean> {
  const doFetch = input.fetchImpl ?? fetch;
  const target = `${input.url}${HEALTH_PATH}?challenge=${encodeURIComponent(input.challenge)}`;

  try {
    const res = await doFetch(target);
    if (res.status !== 200) return false;
    const probe = (await res.json()) as HealthResponse;
    return verifyHealth(
      { capability: input.capability, instanceId: input.instanceId },
      probe,
      input.challenge,
    );
  } catch {
    return false;
  }
}
