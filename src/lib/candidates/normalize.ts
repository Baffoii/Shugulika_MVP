/**
 * Canonical normalizers for candidate identity and profile data.
 *
 * Everything in the ATS that compares two values — duplicate detection, Zoho
 * import matching, provenance conflict checks — goes through this module, so
 * "are these the same person" gives the same answer everywhere. Pure functions,
 * no I/O, no framework imports.
 *
 * Defaults are Tanzania-first (phone country code 255) because that is where
 * the candidate pool is, but nothing here reads or infers nationality: a phone
 * country code is a contact detail, never a filter or ranking signal.
 */

/** Strip accents so "Mwanaïsha" and "Mwanaisha" compare equal. */
function stripDiacritics(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function collapse(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/** Lowercased, accent-free, whitespace-collapsed. The base every normalizer builds on. */
export function normalizeText(raw: string | null | undefined): string {
  if (!raw) return "";
  return collapse(stripDiacritics(String(raw)).toLowerCase());
}

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

const HONORIFICS = new Set([
  "mr",
  "mrs",
  "ms",
  "miss",
  "dr",
  "prof",
  "professor",
  "eng",
  "engineer",
  "rev",
  "hon",
  "sir",
  "madam",
  "mwl",
  "ndg",
]);

const NAME_SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv"]);

/**
 * A name reduced to comparable tokens: honorifics and suffixes removed,
 * punctuation dropped, single initials kept (they are often the only trace of a
 * middle name and dropping them loses a real signal).
 */
export function nameTokens(raw: string | null | undefined): string[] {
  const base = normalizeText(raw).replace(/[^a-z0-9\s'-]/g, " ");
  return collapse(base)
    .split(" ")
    .map((t) => t.replace(/^[-']+|[-']+$/g, ""))
    .filter((t) => t.length > 0)
    .filter((t) => !HONORIFICS.has(t))
    .filter((t) => !NAME_SUFFIXES.has(t));
}

/** Whitespace-joined tokens, in the order given. Order matters for display, not comparison. */
export function normalizeName(raw: string | null | undefined): string {
  return nameTokens(raw).join(" ");
}

/**
 * Order-independent name key. "Asha John Mwakalinga" and
 * "Mwakalinga, Asha John" produce the same key, which is what duplicate
 * detection needs — CVs and ATS exports disagree constantly about field order.
 */
export function nameSortKey(raw: string | null | undefined): string {
  return [...new Set(nameTokens(raw))].sort().join(" ");
}

/** Join parts into one full name, dropping the empties. */
export function fullName(parts: Array<string | null | undefined>): string {
  return collapse(
    parts
      .map((p) => (p ?? "").trim())
      .filter(Boolean)
      .join(" "),
  );
}

// ---------------------------------------------------------------------------
// Email
// ---------------------------------------------------------------------------

const EMAIL_RE = /^[^\s@,;]+@[^\s@,;.]+(\.[^\s@,;.]+)+$/;

/** Providers where dots in the local part are cosmetic. */
const DOTLESS_LOCAL_DOMAINS = new Set(["gmail.com", "googlemail.com"]);

/**
 * Lowercased address with the `+tag` dropped, and dots removed from the local
 * part on providers that ignore them. Returns null when the input is not a
 * single valid-looking address — the caller decides whether that is a
 * quarantine reason or just a missing field.
 */
export function normalizeEmail(raw: string | null | undefined): string | null {
  const value = normalizeText(raw).replace(/\s+/g, "");
  if (!value || !EMAIL_RE.test(value)) return null;
  const at = value.lastIndexOf("@");
  const domain = value.slice(at + 1);
  let local = value.slice(0, at);
  const plus = local.indexOf("+");
  if (plus > 0) local = local.slice(0, plus);
  if (DOTLESS_LOCAL_DOMAINS.has(domain)) local = local.replaceAll(".", "");
  if (!local) return null;
  return `${local}@${domain}`;
}

/** True when the raw value looks like exactly one email address. */
export function isEmailShaped(raw: string | null | undefined): boolean {
  return EMAIL_RE.test(normalizeText(raw).replace(/\s+/g, ""));
}

// ---------------------------------------------------------------------------
// Phone
// ---------------------------------------------------------------------------

/** Default dialling code when a number is written in local form (leading 0). */
export const DEFAULT_PHONE_COUNTRY_CODE = "255";

export interface NormalizedPhone {
  /** `+<country><national>` — the storable canonical form. */
  e164: string;
  /** National significant number, no country code and no trunk 0. */
  national: string;
  countryCode: string;
}

/**
 * Best-effort E.164 normalization. Handles `+255…`, `00255…`, local `07…`, and
 * numbers written with spaces, dashes, or parentheses.
 *
 * Deliberately not a full libphonenumber: it never guesses a country for a bare
 * subscriber number it cannot place, returning null instead so the caller can
 * quarantine rather than invent a country.
 */
export function normalizePhone(
  raw: string | null | undefined,
  defaultCountryCode: string = DEFAULT_PHONE_COUNTRY_CODE,
): NormalizedPhone | null {
  if (!raw) return null;
  const text = String(raw).trim();
  // A leading + or 00 means the country code is already present.
  const hasExplicitCountry = /^(\+|00)/.test(text.replace(/[\s()-]/g, ""));
  const digits = text.replace(/\D/g, "");
  if (digits.length < 7) return null;

  let rest = digits;
  let countryCode = defaultCountryCode;

  if (hasExplicitCountry) {
    rest = digits.replace(/^00/, "");
    if (rest.startsWith(defaultCountryCode)) {
      countryCode = defaultCountryCode;
      rest = rest.slice(defaultCountryCode.length);
    } else {
      // Unknown country: take a 1-3 digit prefix, preferring the shortest that
      // leaves a plausible subscriber number.
      const width = rest.length > 11 ? 3 : rest.length > 10 ? 2 : 1;
      countryCode = rest.slice(0, width);
      rest = rest.slice(width);
    }
  } else if (
    digits.startsWith(defaultCountryCode) &&
    digits.length > defaultCountryCode.length + 6
  ) {
    rest = digits.slice(defaultCountryCode.length);
  }

  // Trunk prefix: "0712…" and "712…" are the same subscriber.
  rest = rest.replace(/^0+/, "");
  if (rest.length < 6 || rest.length > 12) return null;

  return { e164: `+${countryCode}${rest}`, national: rest, countryCode };
}

/**
 * Comparison key for phones. Falls back to the last 9 digits when the number
 * cannot be fully placed, which is enough to catch the common duplicate case
 * (same subscriber, differently formatted) without inventing a country code.
 */
export function phoneMatchKey(raw: string | null | undefined): string | null {
  const normalized = normalizePhone(raw);
  if (normalized) return normalized.national.slice(-9);
  const digits = (raw ?? "").replace(/\D/g, "");
  return digits.length >= 9 ? digits.slice(-9) : null;
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

const MONTHS: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function isRealDate(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const probe = new Date(Date.UTC(y, m - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d;
}

/**
 * Normalize a date to `YYYY-MM-DD`. Partial dates are completed to the first of
 * the month/year, matching what the CV extraction schema already promises.
 *
 * Ambiguous numeric dates are read day-first (`03/04/2020` → 3 April 2020),
 * which is the convention in the markets this product serves. Returns null when
 * the value cannot be read as a date at all.
 */
export function normalizeDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const value = normalizeText(raw).replace(/(\d+)(st|nd|rd|th)\b/g, "$1");
  if (!value) return null;
  if (/^(present|current|to date|ongoing|now)$/.test(value)) return null;

  const iso = /^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?$/.exec(value);
  if (iso) {
    const y = Number(iso[1]);
    const m = Number(iso[2]);
    const d = iso[3] ? Number(iso[3]) : 1;
    return isRealDate(y, m, d) ? `${y}-${pad(m)}-${pad(d)}` : null;
  }

  const yearOnly = /^(19|20)\d{2}$/.exec(value);
  if (yearOnly) return `${value}-01-01`;

  // "march 2019", "12 march 2019", "march 12, 2019"
  const monthName = /(^|\s)([a-z]{3,9})(\s|$)/.exec(value);
  if (monthName && MONTHS[monthName[2] as string] !== undefined) {
    const m = MONTHS[monthName[2] as string] as number;
    const year = /(19|20)\d{2}/.exec(value);
    if (year) {
      const y = Number(year[0]);
      const dayMatch = /\b(\d{1,2})\b/.exec(value.replace(year[0], " "));
      const d = dayMatch ? Number(dayMatch[1]) : 1;
      return isRealDate(y, m, d) ? `${y}-${pad(m)}-${pad(d)}` : `${y}-${pad(m)}-01`;
    }
  }

  const numeric = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(value);
  if (numeric) {
    let y = Number(numeric[3]);
    if (y < 100) y += y < 50 ? 2000 : 1900;
    const a = Number(numeric[1]);
    const b = Number(numeric[2]);
    // Day-first unless that is impossible and month-first works.
    if (isRealDate(y, b, a)) return `${y}-${pad(b)}-${pad(a)}`;
    if (isRealDate(y, a, b)) return `${y}-${pad(a)}-${pad(b)}`;
    return null;
  }

  const monthYear = /^(\d{1,2})[/.-]((19|20)\d{2})$/.exec(value);
  if (monthYear) {
    const m = Number(monthYear[1]);
    const y = Number(monthYear[2]);
    return isRealDate(y, m, 1) ? `${y}-${pad(m)}-01` : null;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Locations
// ---------------------------------------------------------------------------

const LOCATION_NOISE = new Set([
  "city",
  "town",
  "district",
  "region",
  "province",
  "county",
  "area",
  "remote",
  "hybrid",
  "onsite",
  "on-site",
]);

/**
 * Comparable form of a free-text location. Keeps only the most specific part
 * ("Dar es Salaam, Tanzania" → "dar es salaam") because ATS exports vary wildly
 * in how much administrative hierarchy they append.
 */
export function normalizeLocation(raw: string | null | undefined): string {
  const value = normalizeText(raw).replace(/[^a-z0-9,\s-]/g, " ");
  if (!value) return "";
  const head = (value.split(",")[0] ?? "").trim();
  const tokens = collapse(head)
    .split(" ")
    .filter((t) => t.length > 0 && !LOCATION_NOISE.has(t));
  return tokens.join(" ");
}

// ---------------------------------------------------------------------------
// Skills
// ---------------------------------------------------------------------------

/**
 * Aliases for skills that appear under several names in CVs. Intentionally
 * small and conservative: a wrong alias silently merges two different skills,
 * which is worse than leaving them apart.
 */
const SKILL_ALIASES: Record<string, string> = {
  js: "javascript",
  ecmascript: "javascript",
  ts: "typescript",
  nodejs: "node.js",
  node: "node.js",
  reactjs: "react",
  "react.js": "react",
  postgres: "postgresql",
  psql: "postgresql",
  ms_excel: "microsoft excel",
  "ms excel": "microsoft excel",
  excel: "microsoft excel",
  msword: "microsoft word",
  "ms word": "microsoft word",
  word: "microsoft word",
  "customer care": "customer service",
  "book keeping": "bookkeeping",
  "quick books": "quickbooks",
  hr: "human resources",
  kiswahili: "swahili",
};

/** Lowercased, punctuation-trimmed skill name with common aliases folded in. */
export function normalizeSkill(raw: string | null | undefined): string {
  const value = normalizeText(raw)
    // Keep + and # — "c++" and "c#" are different skills from "c".
    .replace(/[^a-z0-9+#.\s-]/g, " ");
  const cleaned = collapse(value).replace(/^[-.]+|[-.]+$/g, "");
  if (!cleaned) return "";
  return SKILL_ALIASES[cleaned] ?? SKILL_ALIASES[cleaned.replace(/\s+/g, "_")] ?? cleaned;
}

/** Deduplicated, sorted, normalized skill set. */
export function normalizeSkillSet(raw: Iterable<string | null | undefined>): string[] {
  const out = new Set<string>();
  for (const item of raw) {
    const skill = normalizeSkill(item);
    if (skill) out.add(skill);
  }
  return [...out].sort();
}

// ---------------------------------------------------------------------------
// Employers and institutions
// ---------------------------------------------------------------------------

const LEGAL_SUFFIXES = new Set([
  "ltd",
  "limited",
  "plc",
  "inc",
  "incorporated",
  "llc",
  "co",
  "company",
  "corp",
  "corporation",
  "gmbh",
  "sa",
  "sarl",
  "holdings",
  "group",
  "enterprises",
  "enterprise",
  "t",
  "tz",
  "tanzania",
]);

/**
 * Employer name reduced to its distinctive part: legal-form suffixes and the
 * "(T)" / "Tanzania" local-subsidiary markers are dropped, so "Acme Ltd" and
 * "ACME (T) Limited" compare equal.
 */
export function normalizeEmployer(raw: string | null | undefined): string {
  const value = normalizeText(raw).replace(/[^a-z0-9&\s-]/g, " ");
  const tokens = collapse(value)
    .split(" ")
    .filter((t) => t.length > 0)
    .filter((t) => t !== "&" && t !== "and");
  while (tokens.length > 1 && LEGAL_SUFFIXES.has(tokens[tokens.length - 1] as string)) {
    tokens.pop();
  }
  return tokens.join(" ");
}

const INSTITUTION_STOPWORDS = new Set(["the", "of", "and", "for"]);

/** Institution name reduced to comparable tokens ("The University of Dodoma" → "university dodoma"). */
export function normalizeInstitution(raw: string | null | undefined): string {
  const value = normalizeText(raw).replace(/[^a-z0-9\s-]/g, " ");
  return collapse(value)
    .split(" ")
    .filter((t) => t.length > 0 && !INSTITUTION_STOPWORDS.has(t))
    .join(" ");
}

const QUALIFICATION_ALIASES: Record<string, string> = {
  bsc: "bachelor of science",
  "b.sc": "bachelor of science",
  ba: "bachelor of arts",
  bcom: "bachelor of commerce",
  bba: "bachelor of business administration",
  msc: "master of science",
  "m.sc": "master of science",
  ma: "master of arts",
  mba: "master of business administration",
  phd: "doctor of philosophy",
  acse: "advanced certificate of secondary education",
  csee: "certificate of secondary education",
  diploma: "diploma",
};

/** Qualification with the common abbreviations expanded, for comparable education rows. */
export function normalizeQualification(raw: string | null | undefined): string {
  const value = collapse(normalizeText(raw).replace(/[^a-z0-9.\s-]/g, " "));
  if (!value) return "";
  const direct = QUALIFICATION_ALIASES[value.replace(/\.$/, "")];
  if (direct) return direct;
  const firstToken = value.split(" ")[0] ?? "";
  const expanded = QUALIFICATION_ALIASES[firstToken];
  if (expanded) {
    const rest = value.slice(firstToken.length).trim();
    return rest ? `${expanded} ${rest}` : expanded;
  }
  return value;
}

// ---------------------------------------------------------------------------
// Country
// ---------------------------------------------------------------------------

/**
 * Normalize a country to a 2-letter ISO code, given the supported set. Accepts
 * an ISO code or a country name; returns null when it maps to nothing supported
 * so the caller can quarantine rather than guess.
 */
export function normalizeCountryCode(
  raw: string | null | undefined,
  supported: ReadonlyArray<{ code: string; name: string }>,
): string | null {
  const value = normalizeText(raw);
  if (!value) return null;
  for (const country of supported) {
    if (value === country.code.toLowerCase()) return country.code;
    if (value === normalizeText(country.name)) return country.code;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Canonical identity bundle
// ---------------------------------------------------------------------------

export interface CandidateIdentityInput {
  givenName?: string | null;
  middleName?: string | null;
  familyName?: string | null;
  email?: string | null;
  phone?: string | null;
  city?: string | null;
  countryCode?: string | null;
  dateOfBirth?: string | null;
  employers?: Array<string | null | undefined>;
  institutions?: Array<string | null | undefined>;
  skills?: Array<string | null | undefined>;
}

/** Everything the matcher compares, normalized once. */
export interface CandidateIdentity {
  nameKey: string;
  nameTokens: string[];
  email: string | null;
  phoneKey: string | null;
  location: string;
  countryCode: string | null;
  dateOfBirth: string | null;
  employers: string[];
  institutions: string[];
  skills: string[];
}

export function toCandidateIdentity(input: CandidateIdentityInput): CandidateIdentity {
  const name = fullName([input.givenName, input.middleName, input.familyName]);
  const uniqueSorted = (
    values: Array<string | null | undefined>,
    fn: (v: string | null | undefined) => string,
  ) => [...new Set(values.map(fn).filter((v) => v.length > 0))].sort();

  return {
    nameKey: nameSortKey(name),
    nameTokens: nameTokens(name),
    email: normalizeEmail(input.email),
    phoneKey: phoneMatchKey(input.phone),
    location: normalizeLocation(input.city),
    countryCode: input.countryCode ? input.countryCode.trim().toUpperCase() : null,
    dateOfBirth: normalizeDate(input.dateOfBirth),
    employers: uniqueSorted(input.employers ?? [], normalizeEmployer),
    institutions: uniqueSorted(input.institutions ?? [], normalizeInstitution),
    skills: normalizeSkillSet(input.skills ?? []),
  };
}
