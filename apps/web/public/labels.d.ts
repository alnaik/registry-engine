// Types for labels.js (served as-is to the browser; this file is for tests).
export interface LabelLead {
  registryCheck?: string | undefined;
  registeredElsewhere?: boolean;
  registryStanding?: { status: string; since: string | null } | null;
  status?: string;
  lastSeen?: string | null;
  web?: string;
  found?: { status: string; website?: string; listings?: string[]; reason?: string } | null;
  coded?: boolean;
  what?: string;
  employees?: number | null;
}
export interface Lookup { status: string; namesChecked: number }
export function trustLabel(lead: LabelLead, lookup?: Lookup | null): { tone: "ok" | "unk" | "no"; pill: string; tag: string | null };
export function standingWord(status: string | null | undefined): string;
export function monthYear(iso: string | null | undefined): string;
export function recordYear(iso: string | null | undefined): string;
export function hasSite(lead: LabelLead): boolean;
export function webTag(lead: LabelLead): string | null;
export function prettyHost(host: string): string;
export function fetchedText(count: number, capped: boolean): string;
export function jobsText(employees: number | null | undefined): string;
export function whatLine(lead: LabelLead): string;
export const OUTCOMES: [string, string][];
export const OUTCOME_LABEL: Record<string, string>;
export function trustAtCall(
  prior: { status?: unknown; trust?: { pill: string; tone: string } | null; updatedAt?: unknown; [key: string]: unknown } | null,
  status: string,
  current: { pill: string; tone: string } | null,
): { pill: string; tone: string } | null;
export function migrateTracker(raw: unknown): { entry: Record<string, unknown> | null; changed: boolean };
export function isTracked(entry: unknown): boolean;
export function shortDate(iso: string | null | undefined): string;
export function callStatusText(entry: unknown): string;
export const FILTERS: [string, string, (lead: LabelLead, outcome?: string) => boolean][];
export function bandTitle(band: string): string;
export function phoneDigits(value: string | null | undefined): string | null;
export function reachSummary(lead: Record<string, unknown>): { phone: string; source: string; place: string; principal: string };
export function summaryParts(result: Record<string, unknown>, opts?: { radiusSet?: boolean }): [string, boolean][];
export const SECONDS_PER_NAME: number;
export function checkAllEstimate(names: number): string;
export function registryProgressText(checked: number, total: number): string;
export function registryLine(lookup: Record<string, unknown> | null | undefined): { text: string; button: string | null } | null;
export function displayName(name: string): string;
export function displayCity(city: string): string;
export function tokensText(n: number): string;
export function llmFailedHint(billing: string | null | undefined): string;
export function coverageLine(regions: unknown): string;
export function aboutRows(result: Record<string, unknown>, status?: Record<string, unknown>, seconds?: number | null): [string, string][];
