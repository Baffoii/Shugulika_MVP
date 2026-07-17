/**
 * Free, deterministic, regex/pattern-based CV field extractor. No API key,
 * no network call, no cost. Used automatically by parseResumeAction whenever
 * OPENAI_API_KEY is not configured, so the autofill-review workflow is fully
 * testable with $0 setup. Produces the exact same shape as the AI extractor
 * (resumeExtractionSchema) — confidences are intentionally kept modest
 * (0.45-0.6) since pattern matching is far less reliable than an LLM, which
 * nudges the review UI toward "Review recommended" / "Uncertain" bands.
 *
 * Mirrors, at a much smaller scale, how classic ATS resume parsers (e.g.
 * Workday's core pipeline) work: reading-order text -> section detection via
 * known headers -> pattern-based entity extraction. Pure and side-effect
 * free, so it's directly unit-testable.
 */
import { COUNTRIES } from "@/lib/constants";
import type { ResumeExtraction } from "@/lib/resume/extraction-schema";

const RULE_CONFIDENCE = { high: 0.6, mid: 0.5, low: 0.45 } as const;

type PersonalField = { value: string; confidence: number; evidence_text: string | null } | null;

type SectionKey =
  | "summary"
  | "experience"
  | "education"
  | "skills"
  | "certifications"
  | "languages"
  | "contact"
  | "other";

const HEADER_PATTERNS: { key: SectionKey; re: RegExp }[] = [
  { key: "summary", re: /^(professional\s+)?summary$|^profile$|^objective$|^about(\s+me)?$/i },
  {
    key: "experience",
    re: /^(work\s+|professional\s+|relevant\s+)?experience$|^employment(\s+history)?$|^career\s+history$/i,
  },
  { key: "education", re: /^education(al)?(\s+background)?$/i },
  { key: "skills", re: /^(technical\s+|core\s+|key\s+)?skills$|^competenc(y|ies)$/i },
  {
    key: "certifications",
    re: /^certifications?$|^licen[cs]es?(\s*(&|and)?\s*certifications?)?$/i,
  },
  { key: "languages", re: /^languages?$/i },
  { key: "contact", re: /^contact(\s+(info(rmation)?|details))?$|^personal\s+details$/i },
  // Recognized so their content doesn't get wrongly glued onto whichever
  // real section came before them (e.g. "Professional Qualification" onto
  // "Profile"/summary) — content collected here is intentionally unused.
  {
    key: "other",
    re: /^(professional\s+)?qualifications?$|^references?$|^declaration$|^hobbies(\s+(and|&)\s+interests)?$|^interests?$/i,
  },
];

const DATE_TOKEN = "(?:[A-Za-z]{3,9}\\.?\\s+\\d{4}|\\d{1,2}\\/\\d{4}|\\d{4})";
const DATE_RANGE_RE = new RegExp(
  `(${DATE_TOKEN})\\s*(?:[-\u2013\u2014]|to)\\s*(present|current|now|${DATE_TOKEN})`,
  "i",
);
const MONTHS: Record<string, string> = {
  jan: "01",
  feb: "02",
  mar: "03",
  apr: "04",
  may: "05",
  jun: "06",
  jul: "07",
  aug: "08",
  sep: "09",
  oct: "10",
  nov: "11",
  dec: "12",
};

function normalizeDateToken(token: string | undefined): string | null {
  if (!token) return null;
  const value = token.trim();
  let m = value.match(/^(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[2]}-${(m[1] ?? "").padStart(2, "0")}-01`;
  m = value.match(/^([A-Za-z]{3,9})\.?\s+(\d{4})$/);
  if (m) {
    const month = MONTHS[(m[1] ?? "").slice(0, 3).toLowerCase()];
    if (month) return `${m[2]}-${month}-01`;
  }
  m = value.match(/^(\d{4})$/);
  if (m) return `${m[1]}-01-01`;
  return null;
}

function parseDateRange(
  line: string,
): { start: string | null; end: string | null; isCurrent: boolean } | null {
  const m = line.match(DATE_RANGE_RE);
  if (!m) return null;
  const isCurrent = /present|current|now/i.test(m[2] ?? "");
  return {
    start: normalizeDateToken(m[1]),
    end: isCurrent ? null : normalizeDateToken(m[2]),
    isCurrent,
  };
}

function splitSections(lines: string[]): Record<SectionKey, string[]> {
  const result: Record<SectionKey, string[]> = {
    summary: [],
    experience: [],
    education: [],
    skills: [],
    certifications: [],
    languages: [],
    contact: [],
    other: [],
  };
  let current: SectionKey | null = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const cleaned = line.replace(/[:\-\u2013\u2014]+$/, "").trim();
    const header =
      cleaned.length <= 40 ? HEADER_PATTERNS.find((h) => h.re.test(cleaned)) : undefined;
    if (header) {
      current = header.key;
      continue;
    }
    if (current) result[current].push(line);
  }
  return result;
}

// A name line: 2-4 words, letters/apostrophes/hyphens/periods only, no digits.
const NAME_LINE_RE = /^[A-Za-z][A-Za-z.'-]*(?:\s+[A-Za-z][A-Za-z.'-]*){1,3}$/;
const DOC_TITLE_RE = /^(curriculum\s+vitae|c\.?v\.?|resume|r[ée]sum[ée])$/i;

/**
 * The candidate's full name is almost always at the very top of a CV, but
 * not always alone on its own line — some resumes combine "Name | Title |
 * phone | email" on one line, and some have a "CURRICULUM VITAE" title line
 * above the name. Scans the first few non-empty lines and, for each,
 * isolates the segment before any contact-info delimiter.
 */
function extractName(lines: string[]): {
  given_name: PersonalField;
  middle_name: PersonalField;
  family_name: PersonalField;
} {
  const empty = { given_name: null, middle_name: null, family_name: null };
  const nonEmpty = lines.map((l) => l.trim()).filter(Boolean);
  for (const raw of nonEmpty.slice(0, 5)) {
    if (DOC_TITLE_RE.test(raw)) continue;
    const candidate = (raw.split(/[|•·]|\s-\s/)[0] ?? raw).trim();
    if (!candidate || candidate.length > 60 || candidate.includes("@") || /\d/.test(candidate))
      continue;
    if (HEADER_PATTERNS.some((h) => h.re.test(candidate))) continue;
    if (!NAME_LINE_RE.test(candidate)) continue;
    const tokens = candidate.split(/\s+/).filter(Boolean);
    if (tokens.length < 2) continue;
    const given = tokens[0] ?? null;
    const family = tokens[tokens.length - 1] ?? null;
    const middle = tokens.length > 2 ? tokens.slice(1, -1).join(" ") : null;
    const field = (value: string | null): PersonalField =>
      value ? { value, confidence: RULE_CONFIDENCE.mid, evidence_text: raw } : null;
    return { given_name: field(given), middle_name: field(middle), family_name: field(family) };
  }
  return empty;
}

const PHONE_RE = /(\+?\d[\d\s().-]{6,}\d)/g;

function findPhoneIn(candidateLines: string[]): PersonalField {
  for (const line of candidateLines) {
    if (HEADER_PATTERNS.some((h) => h.re.test(line))) continue;
    for (const m of line.match(PHONE_RE) ?? []) {
      const digitCount = (m.match(/\d/g) ?? []).length;
      if (digitCount >= 7 && digitCount <= 15) {
        return {
          value: m.trim(),
          confidence: RULE_CONFIDENCE.mid,
          evidence_text: line.slice(0, 150),
        };
      }
    }
  }
  return null;
}

/**
 * Phone numbers usually live in a contact block, but that block isn't
 * always near the top — sidebar/template CVs often put a name, a full
 * profile paragraph, and other sections before "Contact" ever appears, so a
 * naive "first N lines" search misses it entirely. Checks, in order: (1) a
 * recognized "Contact" section, wherever it falls in the document; (2) any
 * line explicitly labelled mobile/phone/tel/cell, anywhere in the document;
 * (3) the first 20 lines, as a last-resort fallback for CVs with no header
 * or label at all.
 */
function extractPhone(lines: string[], contactSection: string[]): PersonalField {
  const fromContact = findPhoneIn(contactSection.map((l) => l.trim()).filter(Boolean));
  if (fromContact) return fromContact;

  const allLines = lines.map((l) => l.trim()).filter(Boolean);
  const labelled = allLines.filter((l) => /\b(mobile|phone|tel(ephone)?|cell)\b\s*[:.]?/i.test(l));
  const fromLabelled = findPhoneIn(labelled);
  if (fromLabelled) return fromLabelled;

  return findPhoneIn(allLines.slice(0, 20));
}

const EMAIL_RE = /[\w.+-]+@[\w-]+\.[A-Za-z]{2,}/;

/** Same rationale as extractPhone — check the Contact section first, then the whole document. */
function extractEmail(lines: string[], contactSection: string[]): PersonalField {
  const findIn = (candidateLines: string[]): PersonalField => {
    for (const line of candidateLines) {
      const m = line.match(EMAIL_RE);
      if (m?.[0])
        return { value: m[0], confidence: RULE_CONFIDENCE.mid, evidence_text: line.slice(0, 150) };
    }
    return null;
  };
  return (
    findIn(contactSection.map((l) => l.trim()).filter(Boolean)) ??
    findIn(lines.map((l) => l.trim()).filter(Boolean))
  );
}

function extractHeadline(
  lines: string[],
): { value: string; confidence: number; evidence_text: string | null } | null {
  const nonEmpty = lines.map((l) => l.trim()).filter(Boolean);
  for (const line of nonEmpty.slice(1, 5)) {
    if (line.includes("@")) continue;
    if (/^\+?\d[\d\s().-]{6,}$/.test(line)) continue;
    if (HEADER_PATTERNS.some((h) => h.re.test(line))) continue;
    if (line.length > 4 && line.length <= 80) {
      return { value: line, confidence: RULE_CONFIDENCE.mid, evidence_text: line };
    }
  }
  return null;
}

function extractSummary(
  section: string[],
): { value: string; confidence: number; evidence_text: string | null } | null {
  const text = section.join(" ").trim();
  if (!text) return null;
  return {
    value: text.slice(0, 600),
    confidence: RULE_CONFIDENCE.high,
    evidence_text: section[0]?.slice(0, 200) ?? null,
  };
}

const KNOWN_CITIES = [
  "dar es salaam",
  "arusha",
  "mwanza",
  "dodoma",
  "zanzibar",
  "mbeya",
  "morogoro",
  "tanga",
  "nairobi",
  "mombasa",
  "kisumu",
  "accra",
  "kumasi",
];

function extractLocation(fullText: string): {
  country: { code: string; name: string } | null;
  city: string | null;
} {
  const lower = fullText.toLowerCase();
  const country = COUNTRIES.find((c) => lower.includes(c.name.toLowerCase())) ?? null;
  const cityMatch = KNOWN_CITIES.find((c) => lower.includes(c)) ?? null;
  const city = cityMatch ? cityMatch.replace(/\b\w/g, (ch) => ch.toUpperCase()) : null;
  return { country: country ? { code: country.code, name: country.name } : null, city };
}

function extractAvailability(
  fullText: string,
): { value: string; confidence: number; evidence_text: string | null } | null {
  const m = fullText.match(
    /(available[^\n.]{0,60}|notice period[^\n.]{0,60}|immediately available)/i,
  );
  if (!m) return null;
  const value = m[0].trim();
  return { value, confidence: RULE_CONFIDENCE.mid, evidence_text: value };
}

function splitTitleEmployer(text: string): [string, string | null] {
  const cleaned = text.trim();
  if (!cleaned) return ["", null];
  const parts = cleaned
    .split(/,|\||\u2013|\u2014|\bat\b/i)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length >= 2) return [parts[0] ?? "", parts[1] ?? null];
  return [cleaned, null];
}

function collectDescription(lines: string[], startIdx: number): string | null {
  const out: string[] = [];
  for (let j = startIdx; j < lines.length && out.length < 5; j++) {
    const current = lines[j];
    if (current === undefined) break;
    if (parseDateRange(current)) break;
    // The next line is itself a date range, so this line is that entry's
    // title/employer header, not part of the current entry's description.
    const next = lines[j + 1];
    if (next !== undefined && parseDateRange(next)) break;
    const cleaned = current.replace(/^[•\-*]\s*/, "").trim();
    if (cleaned) out.push(cleaned);
  }
  const text = out.join(" ").trim();
  return text || null;
}

function extractExperience(section: string[]): ResumeExtraction["experience"] {
  const entries: ResumeExtraction["experience"] = [];
  for (let i = 0; i < section.length; i++) {
    const line = section[i];
    if (line === undefined) continue;
    const range = parseDateRange(line);
    if (!range) continue;
    const headerText = line
      .replace(DATE_RANGE_RE, "")
      .replace(/[|,\-\u2013\u2014]+$/, "")
      .trim();
    const prevLine = i > 0 ? (section[i - 1] ?? "") : "";
    const [title, employer] = splitTitleEmployer(headerText || prevLine);
    entries.push({
      title: title || "Experience",
      employer_name: employer,
      location: null,
      start_date: range.start,
      end_date: range.end,
      is_current: range.isCurrent,
      description: collectDescription(section, i + 1),
      confidence: RULE_CONFIDENCE.mid,
      evidence_text: line.slice(0, 200),
    });
  }
  return entries;
}

const DEGREE_RE =
  /\b(b\.?sc|b\.?a|b\.?com|bachelor|m\.?sc|m\.?a|mba|master|ph\.?d|doctorate|diploma|certificate)\b/i;
const INSTITUTION_RE = /university|institute|college|school|polytechnic/i;

/**
 * A resume education block is commonly spread across 2-3 lines (institution,
 * degree, dates). This anchors primarily on date-range lines and looks back
 * up to 2 lines for institution/degree context, so a 3-line block produces
 * one entry instead of double-counting the degree line as its own entry.
 * Degree lines with no nearby date (some vocational/older entries) still
 * produce a standalone entry via the fallback below.
 */
function extractEducation(section: string[]): ResumeExtraction["education"] {
  const entries: ResumeExtraction["education"] = [];
  const consumed = new Set<number>();
  for (let i = 0; i < section.length; i++) {
    const line = section[i];
    if (line === undefined) continue;
    const range = parseDateRange(line);
    if (range) {
      const headerText = line
        .replace(DATE_RANGE_RE, "")
        .trim()
        .replace(/^[,;|\-\u2013\u2014]+\s*/, "")
        .replace(/\s*[,;|\-\u2013\u2014]+$/, "")
        .trim();
      let institution: string | null = null;
      let qualification: string | null = null;
      if (headerText) {
        const parts = headerText
          .split(/,|\||\u2013|\u2014/)
          .map((p) => p.trim())
          .filter(Boolean);
        institution = parts.find((p) => INSTITUTION_RE.test(p)) ?? parts[0] ?? null;
        qualification = parts.find((p) => p !== institution) ?? null;
      } else {
        for (const idx of [i - 1, i - 2]) {
          const candidate = idx >= 0 ? section[idx] : "";
          if (idx < 0 || consumed.has(idx) || !candidate) continue;
          if (!institution && INSTITUTION_RE.test(candidate)) {
            institution = candidate;
            consumed.add(idx);
            continue;
          }
          if (!qualification && DEGREE_RE.test(candidate)) {
            qualification = candidate;
            consumed.add(idx);
          }
        }
        if (!institution && i > 0 && !consumed.has(i - 1)) institution = section[i - 1] ?? null;
      }
      // Some resumes put "Institution - dates" on one line and the degree on
      // the very next line (rather than before it). Only claim the next line
      // if it actually looks like a degree — otherwise it's likely the next
      // entry's institution.
      if (!qualification) {
        const next = section[i + 1];
        if (
          next !== undefined &&
          !consumed.has(i + 1) &&
          !parseDateRange(next) &&
          DEGREE_RE.test(next)
        ) {
          qualification = next.trim();
          consumed.add(i + 1);
        }
      }
      entries.push({
        institution: institution || "Institution",
        qualification: qualification || null,
        field_of_study: null,
        start_date: range.start,
        end_date: range.isCurrent ? null : range.end,
        is_current: range.isCurrent,
        confidence: RULE_CONFIDENCE.mid,
        evidence_text: line.slice(0, 200),
      });
      continue;
    }
    if (!consumed.has(i) && DEGREE_RE.test(line)) {
      const next1 = section[i + 1] ?? "";
      const next2 = section[i + 2] ?? "";
      if (!parseDateRange(next1) && !parseDateRange(next2)) {
        const prevLine = i > 0 ? (section[i - 1] ?? "") : "";
        entries.push({
          institution: prevLine || "Institution",
          qualification: line,
          field_of_study: null,
          start_date: null,
          end_date: null,
          is_current: false,
          confidence: RULE_CONFIDENCE.mid,
          evidence_text: line.slice(0, 200),
        });
      }
    }
  }
  return entries;
}

function extractSkills(section: string[]): ResumeExtraction["skills"] {
  const tokens = section
    .join(", ")
    .split(/[,\u2022;|]+/)
    .map((s) => s.replace(/^[-*]\s*/, "").trim())
    .filter((s) => s.length >= 2 && s.length <= 40);
  const unique = Array.from(new Set(tokens)).slice(0, 25);
  return unique.map((name) => ({ name, confidence: RULE_CONFIDENCE.low, evidence_text: name }));
}

function extractCertifications(section: string[]): ResumeExtraction["certifications"] {
  return section
    .filter((l) => l.trim())
    .slice(0, 15)
    .map((line) => {
      const m = line.match(/^(.+?)[,\-\u2013\u2014]\s*(.+)$/);
      return {
        name: (m?.[1] ?? line).trim(),
        issuer: m?.[2]?.trim() ?? null,
        issued_on: null,
        confidence: RULE_CONFIDENCE.low,
        evidence_text: line.slice(0, 150),
      };
    });
}

function extractLanguages(section: string[]): ResumeExtraction["languages"] {
  return section
    .filter((l) => l.trim())
    .slice(0, 10)
    .map((line) => {
      const m = line.match(/^(.+?)[\s]*[(\-\u2013\u2014:]\s*([A-Za-z ]+)\)?$/);
      return {
        language: (m?.[1] ?? line).trim(),
        proficiency: m?.[2]?.trim() ?? null,
        confidence: RULE_CONFIDENCE.low,
        evidence_text: line.slice(0, 100),
      };
    });
}

/** Extracts best-effort structured fields from raw CV text using only regex/pattern matching — no AI, no network, no cost. */
export function extractResumeFieldsStub(resumeText: string): ResumeExtraction {
  const lines = resumeText.split(/\r?\n/);
  const sections = splitSections(lines);
  const { country, city } = extractLocation(resumeText);
  const name = extractName(lines);

  return {
    personal: {
      given_name: name.given_name,
      middle_name: name.middle_name,
      family_name: name.family_name,
      phone: extractPhone(lines, sections.contact),
      email: extractEmail(lines, sections.contact),
      headline: extractHeadline(lines),
      summary: extractSummary(sections.summary),
      city: city ? { value: city, confidence: RULE_CONFIDENCE.mid, evidence_text: city } : null,
      country_code: country
        ? { value: country.code, confidence: RULE_CONFIDENCE.mid, evidence_text: country.name }
        : null,
      availability: extractAvailability(resumeText),
    },
    experience: extractExperience(sections.experience),
    education: extractEducation(sections.education),
    skills: extractSkills(sections.skills),
    certifications: extractCertifications(sections.certifications),
    languages: extractLanguages(sections.languages),
  };
}
