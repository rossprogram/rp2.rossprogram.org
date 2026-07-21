import { z } from 'zod';

export const ApplicationStatus = z.enum([
  'draft',
  'submitted',
  'under_review',
  'accepted',
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
