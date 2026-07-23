import { z } from 'zod';

export const SignInRole = z.enum(['applicant', 'guardian']);
export type SignInRole = z.infer<typeof SignInRole>;

export const RequestLinkBody = z.object({
  email: z.string().email().max(320),
  role: SignInRole.default('applicant'),
});
export type RequestLinkBody = z.infer<typeof RequestLinkBody>;

export const SessionUser = z.object({
  id: z.string(),
  email: z.string().email(),
  roles: z.array(z.enum(['applicant', 'admin', 'mentor', 'assistant', 'guardian', 'participant'])),
});
export type SessionUser = z.infer<typeof SessionUser>;
