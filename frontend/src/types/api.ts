/** Response shapes of the Career Intelligence API (kept in sync with backend schemas). */

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  size: number;
}

export interface CompanyBrief {
  id: number;
  name: string;
  tier: string | null;
  verification_status: string;
  website: string | null;
  careers_url: string | null;
}

export interface Job {
  id: number;
  title: string;
  company: CompanyBrief;
  source: string;
  source_url: string | null;
  sources: string[];
  location: string | null;
  locations: string[];
  work_model: string;
  employment_type: string | null;
  seniority: string | null;
  experience_min: string | null;
  experience_max: string | null;
  salary_min: string | null;
  salary_max: string | null;
  salary_currency: string | null;
  salary_text: string | null;
  posting_date: string | null;
  application_deadline: string | null;
  status: string;
  match_score: number | null;
  recommendation: string | null;
  score_stale: boolean;
  analyzed_at: string | null;
  jd_status: string;
  required_skills: string[];
  preferred_skills: string[];
  created_at: string;
  updated_at: string;
}

export interface MatchComponent {
  key: string;
  label: string;
  weight: number;
  factor: number;
  points: number;
  reasons: string[];
}

export interface MatchResult {
  score: number;
  raw_score: number;
  recommendation: string;
  action: string;
  confidence: string;
  components: MatchComponent[];
  skills: { skill: string; importance: string; match: string; via: string | null }[];
  strong_matches: string[];
  missing: string[];
  blockers: { type: string; message: string; severity: string }[];
  experience_fit: string;
  salary_status: string;
  location_fit: string;
  engine_version: string;
  inputs_hash: string;
}

export interface JobSourceLink {
  id: number;
  source: string;
  original_url: string | null;
  normalized_url: string | null;
  external_id: string | null;
  detail: string | null;
  first_seen_at: string;
  last_seen_at: string;
}

export interface JobDetail extends Job {
  original_jd: string;
  parsed_jd: Record<string, unknown> & {
    responsibilities?: string[];
    qualifications?: string[];
    certifications?: string[];
    constraints?: { type: string; text: string; mandatory: boolean }[];
    domains?: string[];
  };
  responsibilities: string[];
  qualifications: string[];
  manual_fields: string[];
  notes: string | null;
  external_id: string | null;
  score_version: string | null;
  source_links: JobSourceLink[];
  match: MatchResult | null;
  recommended_cv: { id: number; name: string; target_role: string | null; version_id: number } | null;
  recruiter: { id: number; name: string; email: string | null; linkedin_url: string | null; status: string } | null;
  activity: { action: string; summary: string | null; occurred_at: string }[];
  career_ops: Record<string, unknown> | null;
  career_ops_score: string | null;
  career_ops_evaluation: Record<string, any> | null; // eslint-disable-line @typescript-eslint/no-explicit-any
  career_ops_report: string | null;
  career_ops_status: string | null;
}

export interface FieldSource {
  id: number;
  field: string;
  value: string | null;
  source_kind: string;
  source_name: string | null;
  source_url: string | null;
  verification_status: string;
  verified_at: string | null;
  note: string | null;
  created_at: string;
}

export interface Company {
  id: number;
  name: string;
  legal_name: string | null;
  aliases: string[];
  website: string | null;
  domain: string | null;
  careers_url: string | null;
  linkedin_url: string | null;
  ats_provider: string | null;
  headquarters: string | null;
  india_presence: boolean | null;
  india_locations: string[];
  industry: string | null;
  company_type: string | null;
  employee_range: string | null;
  priority: string | null;
  tier: string | null;
  hiring_status: string;
  job_search_enabled: boolean;
  verification_status: string;
  verification_override: string | null;
  verification_score: number;
  last_verified_at: string | null;
  notes: string | null;
}

export interface CompanyDetail extends Company {
  attributes: Record<string, unknown>;
  sources: FieldSource[];
  stats: Record<string, number>;
}

export interface CVVersion {
  id: number;
  cv_id: number;
  version_number: number;
  label: string | null;
  original_filename: string;
  size_bytes: number;
  sha256: string;
  parser_version: string;
  created_at: string;
}

export interface CVVersionDetail extends CVVersion {
  parsed: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  extracted_text: string;
}

export interface CV {
  id: number;
  name: string;
  target_role: string | null;
  notes: string | null;
  is_active: boolean;
  is_archived: boolean;
  current_version_id: number | null;
  created_at: string;
  versions: CVVersion[];
  top_skills: string[];
  total_experience_years: number | null;
}

export interface Profile {
  version: number;
  full_name: string | null;
  headline: string | null;
  email: string | null;
  phone: string | null;
  linkedin_url: string | null;
  location: string | null;
  summary: string | null;
  total_experience_years: string | null;
  relevant_experience_years: string | null;
  leadership_experience_years: string | null;
  primary_roles: string[];
  core_skills: string[];
  additional_skills: string[];
  domains: string[];
  leadership: string[];
  certifications: string[];
  companies: Record<string, unknown>[];
  projects: { name: string; platform?: string; skills?: string[]; highlights?: string[] }[];
  achievements: string[];
  source_cv_version_id: number | null;
  updated_at: string;
}

export interface Preferences {
  version: number;
  target_titles: string[];
  effective_titles: string[];
  include_architect_roles: boolean;
  required_skills: string[];
  preferred_skills: string[];
  preferred_domains: string[];
  preferred_companies: string[];
  preferred_locations: string[];
  remote_ok: boolean;
  hybrid_ok: boolean;
  onsite_ok: boolean;
  min_experience_years: string | null;
  max_experience_years: string | null;
  min_salary: string | null;
  target_salary: string | null;
  salary_currency: string;
  employment_types: string[];
  notice_period_days: number | null;
  excluded_roles: string[];
  excluded_technologies: string[];
  excluded_industries: string[];
  notes: string | null;
}

export interface Contact {
  id: number;
  name: string;
  company_id: number | null;
  company_name: string | null;
  job_title: string | null;
  contact_type: string;
  linkedin_url: string | null;
  email: string | null;
  source: string | null;
  location: string | null;
  notes: string | null;
  status: string;
  last_contacted_at: string | null;
  next_followup_at: string | null;
}

export interface Application {
  id: number;
  job_id: number;
  job_title: string;
  company_id: number;
  company_name: string;
  match_score: number | null;
  applied_on: string;
  method: string;
  cv_version_id: number | null;
  cv_name: string | null;
  recruiter_name: string | null;
  referral_name: string | null;
  status: string;
  expected_salary: string | null;
  salary_currency: string | null;
  notice_period_days: number | null;
  follow_up_date: string | null;
  notes: string | null;
  origin: string;
  events: { id: number; event_type: string; from_status: string | null; to_status: string | null; note: string | null; occurred_at: string }[];
}

export interface FollowUp {
  id: number;
  kind: string;
  title: string;
  due_date: string;
  job_id: number | null;
  job_title: string | null;
  company_name: string | null;
  contact_name: string | null;
  application_id: number | null;
  notes: string | null;
  completed: boolean;
  overdue: boolean;
}

export interface Interview {
  id: number;
  job_id: number;
  job_title: string;
  application_id: number | null;
  company_name: string;
  round_number: number;
  round_type: string;
  mode: string | null;
  scheduled_at: string | null;
  duration_minutes: number | null;
  interviewers: string | null;
  meeting_link: string | null;
  status: string;
  topics: string[];
  notes: string | null;
  feedback: string | null;
  result: string;
  next_round: string | null;
}

export interface Question {
  id: number;
  question: string;
  category: string;
  technology: string | null;
  difficulty: string | null;
  company_name: string | null;
  expected_answer: string | null;
  my_answer: string | null;
  confidence: number | null;
  times_practiced: number;
  last_practiced_at: string | null;
  notes: string | null;
}

export interface Offer {
  id: number;
  job_id: number;
  job_title: string;
  company_name: string;
  offer_date: string;
  expiry_date: string | null;
  currency: string;
  base_salary: string | null;
  variable_pay: string | null;
  bonus: string | null;
  equity: string | null;
  total_ctc: string | null;
  joining_date: string | null;
  location: string | null;
  work_model: string | null;
  benefits: string[];
  negotiation_notes: string | null;
  negotiation_log: { at: string; note: string; counter_ctc: string | null; by: string }[];
  status: string;
  decision: string | null;
}

export interface Priority {
  position: number;
  type: string;
  title: string;
  detail: string | null;
  due: string | null;
  overdue?: boolean;
  link: { entity: string; id: number | null };
}

export interface Bar {
  label: string;
  value: number;
  [k: string]: unknown;
}
