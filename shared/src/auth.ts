import { z } from 'zod';

export const RequestLinkBody = z.object({
  email: z.string().email().max(320),
});
export type RequestLinkBody = z.infer<typeof RequestLinkBody>;

export const SessionUser = z.object({
  id: z.string(),
  email: z.string().email(),
  roles: z.array(z.enum(['applicant', 'admin', 'mentor', 'assistant', 'guardian', 'participant'])),
});
export type SessionUser = z.infer<typeof SessionUser>;
