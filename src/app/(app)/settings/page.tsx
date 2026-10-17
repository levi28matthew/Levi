import type { Metadata } from "next";
import { ActionForm } from "@/components/ActionForm";
import { ConfigurationNotice, Field, PageHeader, Panel, SignedOutState } from "@/components/ui";
import { getSessionContext, isSupabaseConfigured } from "@/lib/queries";
import { saveDisplayName, saveTimeZone } from "./actions";

export const metadata: Metadata = { title: "Settings · LEVI OS" };

/** A short, common list for the datalist; the server validates against the full tz database. */
const COMMON_TIME_ZONES = [
  "UTC",
  "Europe/London",
  "Europe/Dublin",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Madrid",
  "Europe/Rome",
  "Europe/Amsterdam",
  "Europe/Stockholm",
  "Europe/Warsaw",
  "Europe/Kyiv",
  "Europe/Moscow",
  "Africa/Lagos",
  "Africa/Nairobi",
  "Africa/Cairo",
  "Africa/Johannesburg",
  "Asia/Kolkata",
  "Asia/Karachi",
  "Asia/Dhaka",
  "Asia/Dubai",
  "Asia/Riyadh",
  "Asia/Singapore",
  "Asia/Hong_Kong",
  "Asia/Shanghai",
  "Asia/Tokyo",
  "Asia/Seoul",
  "Australia/Perth",
  "Australia/Sydney",
  "Pacific/Auckland",
  "America/Sao_Paulo",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Toronto",
  "America/Mexico_City",
];

export default async function SettingsPage() {
  if (!isSupabaseConfigured()) return <ConfigurationNotice />;
  const session = await getSessionContext();
  if (!session) return <SignedOutState module="Settings" />;
  const { displayName, timeZone, today } = session;

  return (
    <div className="stack" style={{ gap: 18 }}>
      <PageHeader
        eyebrow="Settings"
        title="Your account, your calendar"
        description="Everything in LEVI OS is scoped to you and measured in your own local days."
      />

      <Panel>
        <div className="stack-sm">
          <p className="eyebrow">Identity</p>
          <h2>Display name</h2>
          <p className="muted">Used only to greet you. Leave it blank to stay anonymous on your own screens.</p>
          <ActionForm action={saveDisplayName} submitLabel="Save name" resetOnSuccess={false}>
            <Field label="Display name" htmlFor="display-name" hint="Up to 80 characters.">
              <input id="display-name" name="displayName" defaultValue={displayName ?? ""} maxLength={80} placeholder="Your name" />
            </Field>
          </ActionForm>
        </div>
      </Panel>

      <Panel>
        <div className="stack-sm">
          <p className="eyebrow">Time zone</p>
          <h2>Which day is “today”?</h2>
          <p className="muted">
            Missions, habit logs and streaks are all anchored to a local calendar date. Getting this right is what
            stops a streak breaking at the wrong midnight.
          </p>
          <div className="row">
            <span className="badge">current: {timeZone}</span>
            <span className="badge">today: {today}</span>
          </div>
          <ActionForm action={saveTimeZone} submitLabel="Save time zone" resetOnSuccess={false}>
            <Field label="IANA time zone" htmlFor="time-zone" hint="Validated against the database's own tz database, so a typo is rejected rather than silently shifting your days.">
              <input id="time-zone" name="timeZone" defaultValue={timeZone} list="tz-options" required maxLength={64} placeholder="Europe/London" />
            </Field>
            <datalist id="tz-options">
              {COMMON_TIME_ZONES.map((zone) => (
                <option value={zone} key={zone} />
              ))}
            </datalist>
          </ActionForm>
        </div>
      </Panel>

      <Panel>
        <div className="stack-sm">
          <p className="eyebrow">How the numbers work</p>
          <h2>Nothing here is decorative</h2>
          <ul className="muted" style={{ margin: 0, paddingLeft: "1.1rem" }}>
            <li>XP is an append-only ledger. A correction adds an adjustment row; an award is never rewritten.</li>
            <li>Levels come from one formula, implemented identically in TypeScript and in Postgres.</li>
            <li>Completing a mission, logging a habit or closing a subquest restores or removes XP instead of ever double-counting it.</li>
            <li>Dashboards render your real saved records — empty screens stay empty rather than showing sample data.</li>
          </ul>
        </div>
      </Panel>

      <Panel>
        <div className="row-between">
          <div className="stack-sm">
            <p className="eyebrow">Session</p>
            <h2>Sign out</h2>
            <p className="muted">Ends this session on this device. Your records stay untouched.</p>
          </div>
          <form action="/auth/signout" method="post">
            <button className="button secondary" type="submit">
              Sign out
            </button>
          </form>
        </div>
      </Panel>
    </div>
  );
}
