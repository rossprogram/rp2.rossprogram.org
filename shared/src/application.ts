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
