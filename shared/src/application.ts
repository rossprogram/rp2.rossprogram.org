import { z } from 'zod';

export const ApplicationStatus = z.enum([
  'draft',
  'awaiting_guardian',
  'submitted',
  'under_review',
  'accepted',
  'awaiting_payment',
  'enrolled',
  'declined',
  'waitlisted',
  'rejected',
  'withdrawn',
]);
export type ApplicationStatus = z.infer<typeof ApplicationStatus>;

export const Role = z.enum([
  'applicant',
  'admin',
  'mentor',
  'assistant',
  'guardian',
  'participant',
]);
export type Role = z.infer<typeof Role>;

/*
 * Response values are JSON — arbitrary shape per question type. Server stores
 * them as text; the client is responsible for shaping to match questions.ts.
 */
export const ResponseValue: z.ZodType<unknown> = z.unknown();

export const UpsertResponsesBody = z.object({
  responses: z.record(z.string().min(1).max(100), ResponseValue),
});
export type UpsertResponsesBody = z.infer<typeof UpsertResponsesBody>;

export const ApplicationView = z.object({
  id: z.string(),
  status: ApplicationStatus,
  submittedAt: z.number().nullable(),
  updatedAt: z.number(),
  responses: z.record(z.string(), ResponseValue),
});
export type ApplicationView = z.infer<typeof ApplicationView>;

/*
 * Whether new applications are being taken. Closed after the Fall 2026 term
 * began: signing in still works, applications already submitted (including
 * those waiting on a guardian's signature) finish as normal, and anyone else
 * is told another round is coming. Drafts are kept, just frozen, so a
 * reopened round can pick them back up.
 *
 * Reopening is more than flipping this: the landing page's dates and copy
 * describe the round, so they need rewriting at the same time.
 */
export const APPLICATIONS_OPEN = false;
