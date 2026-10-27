/*
 * The term surveys: one for enrolled students, one for their parents or
 * guardians.
 *
 * Transcribed from surveys/student_survey.md and surveys/parent_survey.md.
 * Like the application's questions, the definition is declarative so the form,
 * the server-side validation and the admin export all render from one source,
 * and answers persist under stable keys. Any change to the wording or the set
 * of questions is a product decision — edit the .md drafts alongside.
 *
 * `SURVEY_ROUND` names the current run. Responses are stored against it, so a
 * later run (end of term, say) is a new round key and starts empty, while the
 * earlier round's answers stay exportable.
 */

import { z } from 'zod';

export const SURVEY_ROUND = 'fall2026-midterm';

export const SURVEY_RESPONDENTS = ['student', 'guardian'] as const;
export type SurveyRespondent = (typeof SURVEY_RESPONDENTS)[number];

export type SurveyChoiceQuestion = {
  key: string;
  type: 'single_choice' | 'dropdown';
  prompt: string;
  options: readonly string[];
  required: boolean;
  help?: string;
};

export type SurveyScaleQuestion = {
  key: string;
  type: 'scale';
  prompt: string;
  /** Labels for the two ends of a 1–5 scale. */
  minLabel: string;
  maxLabel: string;
  required: boolean;
  help?: string;
};

/**
 * Several statements, each rated 1–5. Stored as `{ [rowKey]: 1..5 }`.
 * `columns` names the five points, left to right.
 */
export type SurveyGridQuestion = {
  key: string;
  type: 'grid';
  prompt: string;
  columns: readonly [string, string, string, string, string];
  rows: readonly { key: string; label: string }[];
  /** True means every row must be answered. */
  required: boolean;
  help?: string;
};

export type SurveyTextQuestion = {
  key: string;
  type: 'long_text';
  prompt: string;
  required: boolean;
  help?: string;
};

export type SurveyQuestion =
  | SurveyChoiceQuestion
  | SurveyScaleQuestion
  | SurveyGridQuestion
  | SurveyTextQuestion;

export type SurveyDefinition = {
  respondent: SurveyRespondent;
  title: string;
  intro: string;
  questions: readonly SurveyQuestion[];
};

const AGREE_COLUMNS = [
  'Strongly disagree',
  'Disagree',
  'Neutral',
  'Agree',
  'Strongly agree',
] as const;

export const STUDENT_SURVEY: SurveyDefinition = {
  respondent: 'student',
  title: 'Student survey',
  intro:
    'We want to know how RP2 is going for you so far. Please take a couple of minutes to fill out the following survey.',
  questions: [
    {
      key: 'section',
      type: 'dropdown',
      prompt: 'Which section are you in?',
      options: [
        'CGT-1',
        'CGT-2',
        'GGT-1',
        'GGT-2',
        'QUADRATIC-1',
        'QUADRATIC-2',
        'TOPOLOGY-1',
        'TOPOLOGY-2',
      ],
      required: true,
    },
    {
      key: 'enjoyment',
      type: 'scale',
      prompt: 'How much are you enjoying RP2 so far?',
      minLabel: 'Not at all',
      maxLabel: 'A lot',
      required: true,
    },
    {
      key: 'pace',
      type: 'single_choice',
      prompt: 'The pace of my course is…',
      options: ['Too slow', 'About right', 'Too fast'],
      required: true,
    },
    {
      key: 'pset_hours',
      type: 'single_choice',
      prompt:
        'About how many hours do you spend on each problem set outside of live sessions?',
      options: ['Under 2', '2–4', '4–6', '6–8', '8–10', 'More than 10'],
      required: true,
    },
    {
      key: 'agree',
      type: 'grid',
      prompt: 'How much do you agree with each statement?',
      columns: AGREE_COLUMNS,
      rows: [
        { key: 'psets_discover', label: 'The problem sets lead me to discover new ideas' },
        { key: 'comfortable_asking', label: 'I feel comfortable asking questions on Zoom and Discord' },
        { key: 'instructor_clear', label: 'My instructor explains things clearly' },
        { key: 'set1_feedback', label: 'The feedback on Set 1 helped me understand what to improve' },
        { key: 'talk_to_students', label: 'I talk to other students about the problems' },
        { key: 'sessions_fun', label: 'Problem sessions are fun' },
        { key: 'office_hours_helpful', label: 'Office hours are helpful' },
        { key: 'meetings_longer', label: 'I wish meetings were longer' },
        { key: 'second_course', label: 'I would be interested in taking a second course in my topic' },
      ],
      required: false,
    },
    {
      key: 'meeting_time',
      type: 'single_choice',
      prompt: "Does your section's meeting time still work for you?",
      options: ['Yes, it works well', 'Mostly, with occasional conflicts', 'No'],
      required: true,
    },
    {
      key: 'anything_else',
      type: 'long_text',
      prompt: 'Is there anything you would like to share about your experience so far?',
      required: false,
    },
  ],
};

export const GUARDIAN_SURVEY: SurveyDefinition = {
  respondent: 'guardian',
  title: 'Parent survey',
  intro:
    "Thank you for being part of RP2's first term. Our goal is to deliver the best experience possible for your child, and to do that we need your feedback. Please take a couple of minutes to tell us how the program has started from your side.",
  questions: [
    {
      key: 'child_talks',
      type: 'single_choice',
      prompt: 'How does your child talk about RP2?',
      options: ['Enthusiastically', 'Positively', 'Neutrally', 'Negatively', 'Rarely mentions it'],
      required: true,
    },
    {
      key: 'fit',
      type: 'single_choice',
      prompt: 'How is RP2 fitting alongside school and other commitments?',
      options: ['Very manageable', 'Manageable', 'Sometimes too much', 'Often too much'],
      required: true,
    },
    {
      key: 'agree',
      type: 'grid',
      prompt: 'How much do you agree with each statement?',
      columns: AGREE_COLUMNS,
      rows: [
        { key: 'enrollment_easy', label: 'Enrollment and payment were straightforward' },
        { key: 'information', label: 'I get the information I need from the program' },
        { key: 'who_to_contact', label: 'I know who to contact if there is a problem' },
        {
          key: 'understand_week',
          label:
            'I understand what my child is doing at RP2 and what a week in the program looks like',
        },
        { key: 'enjoying', label: 'My child is enjoying the program' },
        { key: 'learning', label: 'My child is learning a lot of math' },
      ],
      required: false,
    },
    {
      key: 'concerns',
      type: 'long_text',
      prompt:
        "Do you have any concerns about your child's experience that you would like us to know about?",
      required: false,
      help: "For anything you'd like us to follow up on privately, please email ross@rossprogram.org.",
    },
  ],
};

export function surveyFor(respondent: SurveyRespondent): SurveyDefinition {
  return respondent === 'student' ? STUDENT_SURVEY : GUARDIAN_SURVEY;
}

export type SurveyAnswers = Record<string, string | number | Record<string, number> | null>;

const LONG_TEXT_MAX = 5000;

/**
 * The Zod schema for one survey's answers, built from its definition. Unknown
 * keys are stripped; a required question that is missing or empty fails.
 */
export function surveyAnswersSchema(def: SurveyDefinition) {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const q of def.questions) {
    let s: z.ZodTypeAny;
    switch (q.type) {
      case 'single_choice':
      case 'dropdown':
        s = z.enum(q.options as [string, ...string[]]);
        break;
      case 'scale':
        s = z.number().int().min(1).max(5);
        break;
      case 'grid': {
        const rowShape: Record<string, z.ZodTypeAny> = {};
        for (const r of q.rows) {
          const cell = z.number().int().min(1).max(5);
          rowShape[r.key] = q.required ? cell : cell.optional();
        }
        s = z.object(rowShape).strip();
        break;
      }
      case 'long_text':
        s = q.required
          ? z.string().trim().min(1).max(LONG_TEXT_MAX)
          : z.string().trim().max(LONG_TEXT_MAX);
        break;
    }
    shape[q.key] = q.required ? s : s.nullable().optional();
  }
  return z.object(shape).strip();
}

/** Flat column headers for the export, in question order. */
export function surveyExportColumns(def: SurveyDefinition): { key: string; header: string }[] {
  const cols: { key: string; header: string }[] = [];
  for (const q of def.questions) {
    if (q.type === 'grid') {
      for (const r of q.rows) cols.push({ key: `${q.key}.${r.key}`, header: `${q.key}: ${r.label}` });
    } else {
      cols.push({ key: q.key, header: q.prompt });
    }
  }
  return cols;
}
