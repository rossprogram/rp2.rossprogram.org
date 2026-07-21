/*
 * Declarative source of truth for the RP2 application form.
 *
 * The applicant form, autosave, and admin detail view all render from this
 * definition. Keys are STABLE — do not rename after answers exist. Changing
 * a `prompt` or option label is fine; changing `key` requires a data
 * migration.
 *
 * Sections mirror planning/Student Application.txt:
 *   1. Applicant information
 *   2. Parent / guardian information
 *   3. Mathematical background and course preferences
 *   4. Mathematical reflections
 *   5. Financial aid          (deferred to slice 3)
 *   6. Applicant + guardian signatures  (deferred to slice 3)
 */

export const SECTION_KEYS = [
  'student_info',
  'guardian',
  'math_background',
  'reflections',
  'financial_aid',
  'signatures',
] as const;
export type SectionKey = (typeof SECTION_KEYS)[number];

export const SECTIONS: readonly {
  key: SectionKey;
  index: number;
  title: string;
  slug: string;
}[] = [
  { key: 'student_info', index: 1, title: 'Applicant information', slug: 'applicant' },
  { key: 'guardian', index: 2, title: 'Parent or guardian', slug: 'guardian' },
  { key: 'math_background', index: 3, title: 'Mathematical background', slug: 'math' },
  { key: 'reflections', index: 4, title: 'Mathematical reflections', slug: 'reflections' },
  { key: 'financial_aid', index: 5, title: 'Financial aid', slug: 'aid' },
  { key: 'signatures', index: 6, title: 'Signatures', slug: 'sign' },
];

export function sectionBySlug(slug: string): (typeof SECTIONS)[number] | undefined {
  return SECTIONS.find((s) => s.slug === slug);
}

export type Option = { value: string; label: string };

type Base = {
  key: string;
  section: SectionKey;
  prompt: string;
  required: boolean;
  help?: string;
};

export type Question =
  | (Base & { type: 'short_text'; maxLength?: number; placeholder?: string })
  | (Base & { type: 'long_text'; placeholder?: string })
  | (Base & { type: 'email' })
  | (Base & { type: 'phone' })
  | (Base & { type: 'date' })
  | (Base & { type: 'timezone' })
  | (Base & { type: 'single_select'; options: readonly Option[] })
  | (Base & { type: 'multi_select'; options: readonly Option[] })
  | (Base & { type: 'ranked'; options: readonly Option[] })
  | (Base & { type: 'availability_grid' })
  | (Base & { type: 'file_upload'; kind: 'transcript' | 'aid_doc'; accept: readonly string[] })
  | (Base & { type: 'signature' });

export type QuestionType = Question['type'];

/* -------- shared option sets -------- */

const YES_NO: readonly Option[] = [
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
];

const GRADE_LEVELS: readonly Option[] = [
  { value: '8', label: '8th grade or below' },
  { value: '9', label: '9th grade' },
  { value: '10', label: '10th grade' },
  { value: '11', label: '11th grade' },
  { value: '12', label: '12th grade' },
  { value: 'gap', label: 'Gap year' },
  { value: 'other', label: 'Other' },
];

const RELATIONSHIP: readonly Option[] = [
  { value: 'parent', label: 'Parent' },
  { value: 'guardian', label: 'Legal guardian' },
  { value: 'other', label: 'Other family member' },
];

const PROOF_EXPERIENCE: readonly Option[] = [
  { value: 'new', label: 'I am new to proof-based mathematics' },
  { value: 'some', label: 'I have written some proofs, but I still need practice' },
  { value: 'comfortable', label: 'I am comfortable writing proofs' },
  { value: 'advanced', label: 'I have experience with advanced proof-based mathematics' },
];

const PARTICIPATION_STYLE: readonly Option[] = [
  { value: 'speaks_up', label: 'I speak up easily in group discussions' },
  { value: 'when_called', label: 'I participate when I am called on' },
  { value: 'when_prepared', label: 'I participate when I feel prepared' },
  { value: 'warms_up', label: 'I am quiet at first, but I participate more once I know the group' },
  { value: 'written', label: 'I prefer written discussion, but I am willing to speak when needed' },
];

// Course list per planning/Student Application.txt. Diverges from the overview
// document — flagged as an open product decision in the plan.
const COURSE_OPTIONS: readonly Option[] = [
  { value: 'topology', label: 'Point-set topology' },
  { value: 'ggt', label: 'Geometric group theory' },
  { value: 'lean', label: 'Lean' },
  { value: 'voting', label: 'Voting theory and social choice' },
  { value: 'graph', label: 'Graph theory and combinatorics' },
  { value: 'crypto', label: 'Cryptography' },
  { value: 'galois', label: 'Galois theory' },
];

const AID_LEVEL: readonly Option[] = [
  { value: 'none', label: 'No aid requested' },
  { value: 'partial', label: 'Partial aid requested' },
  { value: 'full', label: 'Full aid requested' },
];

/* -------- questions -------- */

export const QUESTIONS: readonly Question[] = [
  // §1 Applicant information
  {
    key: 'student_legal_name',
    section: 'student_info',
    type: 'short_text',
    prompt: 'Applicant full name',
    required: true,
    maxLength: 200,
  },
  {
    key: 'student_preferred_name',
    section: 'student_info',
    type: 'short_text',
    prompt: 'Preferred name',
    required: false,
    help: 'What you would like mentors and other applicants to call you.',
    maxLength: 100,
  },
  {
    key: 'student_email',
    section: 'student_info',
    type: 'email',
    prompt: 'Applicant email address',
    required: true,
  },
  {
    key: 'student_dob',
    section: 'student_info',
    type: 'date',
    prompt: 'Date of birth',
    required: true,
  },
  {
    key: 'student_grade_level',
    section: 'student_info',
    type: 'single_select',
    prompt: 'Current grade level',
    required: true,
    options: GRADE_LEVELS,
  },
  {
    key: 'student_school',
    section: 'student_info',
    type: 'short_text',
    prompt: 'School name',
    required: true,
    maxLength: 200,
  },
  {
    key: 'student_location',
    section: 'student_info',
    type: 'short_text',
    prompt: 'City, state / province, country',
    required: true,
    maxLength: 200,
  },
  {
    key: 'student_timezone',
    section: 'student_info',
    type: 'timezone',
    prompt: 'Time zone',
    required: true,
    help: 'Start typing to search — any IANA time zone works. We use this to schedule your live sessions.',
  },
  {
    key: 'prior_ross_applied',
    section: 'student_info',
    type: 'single_select',
    prompt: 'Have you previously applied to the Ross Program?',
    required: true,
    options: YES_NO,
  },
  {
    key: 'prior_ross_attended',
    section: 'student_info',
    type: 'single_select',
    prompt: 'Have you previously attended the Ross Program?',
    required: true,
    options: YES_NO,
  },
  {
    key: 'about_yourself',
    section: 'student_info',
    type: 'long_text',
    prompt:
      'As a potential member of our community, we are interested in you holistically. Please tell us a bit about yourself outside of mathematics.',
    required: true,
  },
  {
    key: 'transcript',
    section: 'student_info',
    type: 'file_upload',
    kind: 'transcript',
    prompt: 'Please upload a copy of your most recent school transcript',
    accept: ['application/pdf', 'image/png', 'image/jpeg'],
    required: true,
  },
  {
    key: 'availability',
    section: 'student_info',
    type: 'availability_grid',
    prompt:
      'Select the times when you would be able to participate in live problem-solving sessions',
    required: true,
    help: 'Times are shown in your local time zone.',
  },

  // §2 Parent / guardian information
  {
    key: 'guardian_name',
    section: 'guardian',
    type: 'short_text',
    prompt: 'Parent or guardian full name',
    required: true,
    maxLength: 200,
  },
  {
    key: 'guardian_email',
    section: 'guardian',
    type: 'email',
    prompt: 'Parent or guardian email address',
    required: true,
  },
  {
    key: 'guardian_phone',
    section: 'guardian',
    type: 'phone',
    prompt: 'Parent or guardian phone number',
    required: true,
  },
  {
    key: 'guardian_relationship',
    section: 'guardian',
    type: 'single_select',
    prompt: 'Relationship to applicant',
    required: true,
    options: RELATIONSHIP,
  },

  // §3 Mathematical background and course preferences
  {
    key: 'course_preferences',
    section: 'math_background',
    type: 'ranked',
    prompt: 'Please rank your course preferences',
    help: 'Drag to reorder. Only rank the courses you are interested in — you can skip any that do not appeal to you.',
    required: true,
    options: COURSE_OPTIONS,
  },
  {
    key: 'first_choice_reason',
    section: 'math_background',
    type: 'long_text',
    prompt: 'Briefly explain why you are interested in your first-choice course',
    required: true,
  },
  {
    key: 'second_choice_ok',
    section: 'math_background',
    type: 'single_select',
    prompt:
      'If your first-choice course is not available at a time you can attend, would you be interested in your second-choice course?',
    required: true,
    options: YES_NO,
  },
  {
    key: 'proof_experience',
    section: 'math_background',
    type: 'single_select',
    prompt: 'Which best describes your proof-writing experience?',
    required: true,
    options: PROOF_EXPERIENCE,
  },
  {
    key: 'past_math_experiences',
    section: 'math_background',
    type: 'long_text',
    prompt:
      'Tell us about your past math experiences — school classes, competitions, summer programs, independent reading, online courses, or any other form of mathematical activity.',
    required: true,
  },

  // §4 Mathematical reflections
  {
    key: 'math_stuck_story',
    section: 'reflections',
    type: 'long_text',
    prompt:
      'Describe a time when you were stuck on a math problem. What did you try? What was stopping you? If you eventually solved it, what changed?',
    required: true,
  },
  {
    key: 'idea_shift',
    section: 'reflections',
    type: 'long_text',
    prompt:
      'Describe a mathematical idea that initially made you confused or uncomfortable, but which you now feel you understand. What allowed the change? What helped you see the idea differently?',
    required: true,
  },
  {
    key: 'when_lost',
    section: 'reflections',
    type: 'long_text',
    prompt: 'What do you do when you do not understand a mathematical idea right away?',
    required: true,
  },
  {
    key: 'collaboration',
    section: 'reflections',
    type: 'long_text',
    prompt:
      'Tell us about an experience, positive or negative, in which you did math with other people. What makes someone a good mathematical collaborator? What would help you participate actively in an online mathematical discussion? How do you make others feel welcome and encouraged?',
    required: true,
  },
  {
    key: 'participation_style',
    section: 'reflections',
    type: 'single_select',
    prompt: 'Which best describes your participation style?',
    required: true,
    options: PARTICIPATION_STYLE,
  },
  {
    key: 'participation_style_explanation',
    section: 'reflections',
    type: 'long_text',
    prompt: 'Please briefly explain your answer, if you would like',
    required: false,
  },

  // §5 Financial aid
  {
    key: 'aid_level',
    section: 'financial_aid',
    type: 'single_select',
    prompt: 'Are you requesting financial aid?',
    help: 'The application is need-blind — this answer is not shared with reviewers.',
    required: true,
    options: AID_LEVEL,
  },
  {
    key: 'aid_documentation',
    section: 'financial_aid',
    type: 'file_upload',
    kind: 'aid_doc',
    prompt: 'If you are requesting aid, please provide supporting documentation',
    accept: ['application/pdf', 'image/png', 'image/jpeg'],
    required: false,
  },

  // §6 Signatures
  {
    key: 'student_signature',
    section: 'signatures',
    type: 'signature',
    prompt: 'Applicant signature',
    required: true,
  },
  {
    key: 'guardian_signature',
    section: 'signatures',
    type: 'signature',
    prompt: 'Parent or guardian signature',
    required: true,
  },
];

/*
 * Slice 2 renders only text/date/select input types. The remaining types are
 * scaffolded here so `questions.ts` is the source of truth from day one; the
 * frontend shows a "coming soon" placeholder for anything it can't render yet.
 */
export const RENDERABLE_TYPES: readonly QuestionType[] = [
  'short_text',
  'long_text',
  'email',
  'phone',
  'date',
  'timezone',
  'single_select',
  'multi_select',
];

export function isRenderable(q: Question): boolean {
  return RENDERABLE_TYPES.includes(q.type);
}

export function questionsInSection(section: SectionKey): readonly Question[] {
  return QUESTIONS.filter((q) => q.section === section);
}

export function questionByKey(key: string): Question | undefined {
  return QUESTIONS.find((q) => q.key === key);
}
