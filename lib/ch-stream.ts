// Companies House filings stream — the live UK funding firehose.
//
// This is the source the whole radar wanted. Every UK equity raise must be filed
// as an SH01 within a month of the allotment, and this endpoint pushes every
// filing in the country as it lands. A seed round appears here the day it is
// filed — typically months before the company announces it and before any
// journalist writes it up.
//
// It replaces the SIC-code sweep, which tried to reconstruct this by guessing
// company names and reached ~28% coverage of mostly dormant shells. Enumeration
// beats guessing: the stream is complete by construction.
//
// Auth is HTTP Basic with a STREAM key (a different credential from the REST
// key). The response is newline-delimited JSON on a long-lived connection, and
// the server drops it periodically, so reconnection is normal operation rather
// than an error.

export interface FilingEvent {
  resource_kind: string;
  resource_id: string;
  resource_uri: string;
  data?: {
    category?: string;
    type?: string;
    date?: string;
    description?: string;
    description_values?: Record<string, unknown>;
  };
  event?: { timepoint?: number; published_at?: string; type?: string };
}

/** A funding event: shares allotted. SH01 is the filing that means "raised". */
export function isShareAllotment(f: FilingEvent): boolean {
  const t = (f.data?.type ?? "").toUpperCase();
  const d = (f.data?.description ?? "").toLowerCase();
  return t === "SH01" || d.includes("capital-allotment-shares");
}

/** Company number out of "/company/05401897/filing-history/..." */
export function companyNumberFrom(uri: string): string | null {
  return uri.match(/\/company\/([A-Z0-9]+)\//i)?.[1] ?? null;
}

function authHeader(): string {
  const key = process.env.COMPANIES_HOUSE_STREAM_KEY;
  if (!key || key.includes("TODO")) {
    throw new Error(
      "COMPANIES_HOUSE_STREAM_KEY not set. Create a STREAM key (not a REST key) " +
        "at https://developer.company-information.service.gov.uk/",
    );
  }
  return `Basic ${Buffer.from(`${key}:`).toString("base64")}`;
}

export interface ListenOptions {
  /** Resume from a previous timepoint so a restart loses nothing. */
  timepoint?: number;
  /** Stop after this many ms. Omit to run indefinitely. */
  durationMs?: number;
  onEvent: (f: FilingEvent) => void | Promise<void>;
}

/**
 * Consume the filings stream, reconnecting as needed.
 *
 * Tracks the last timepoint seen: Companies House lets you resume from one, so a
 * dropped connection or a restart does not create a gap in coverage. That
 * matters more here than raw throughput — a missed window is a missed round.
 */
export async function listenFilings(opts: ListenOptions): Promise<number | null> {
  const deadline = opts.durationMs ? Date.now() + opts.durationMs : Infinity;
  let timepoint = opts.timepoint ?? null;
  let buf = "";

  while (Date.now() < deadline) {
    const url =
      "https://stream.companieshouse.gov.uk/filings" +
      (timepoint ? `?timepoint=${timepoint}` : "");
    let res: Response;
    try {
      res = await fetch(url, { headers: { Authorization: authHeader() } });
    } catch (e) {
      console.warn(`[stream] connect failed (${(e as Error).message}) — retrying in 5s`);
      await new Promise((r) => setTimeout(r, 5_000));
      continue;
    }
    if (res.status === 429) {
      console.warn("[stream] rate limited — backing off 60s");
      await new Promise((r) => setTimeout(r, 60_000));
      continue;
    }
    if (!res.ok || !res.body) {
      throw new Error(`stream returned HTTP ${res.status}`);
    }

    const reader = res.body.getReader();
    const dec = new TextDecoder();
    try {
      while (Date.now() < deadline) {
        const { done, value } = await reader.read();
        if (done) break; // server closed; outer loop reconnects from timepoint
        buf += dec.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue; // heartbeat
          let ev: FilingEvent;
          try {
            ev = JSON.parse(line) as FilingEvent;
          } catch {
            continue;
          }
          if (ev.event?.timepoint) timepoint = ev.event.timepoint;
          await opts.onEvent(ev);
        }
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
  }
  return timepoint;
}
