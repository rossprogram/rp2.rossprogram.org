import type { FastifyInstance } from 'fastify';
import { requireAnyRole } from '../auth/session.js';
import { mentorView } from '../services/mentor.js';

/*
 * The mentor portal.
 *
 * One endpoint, because there is one page. Scoping is done in the service
 * from `section_staff` rather than by filtering a full roster here — a
 * mentor's request never constructs a query that could return another
 * section's students in the first place.
 */
export async function registerMentorRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/api/mentor/me',
    { preHandler: requireAnyRole('mentor', 'assistant', 'admin') },
    async (req) => {
      const me = req.currentUser!;
      const isAdmin = me.roles.includes('admin');
      const sections = mentorView(me.id, isAdmin, Math.floor(Date.now() / 1000));
      return {
        // An admin sees every section; a mentor sees theirs. The page says
        // which, so nobody mistakes the whole program for their own class.
        viewingAs: isAdmin ? 'admin' : me.roles.includes('mentor') ? 'mentor' : 'assistant',
        sections,
      };
    },
  );
}
