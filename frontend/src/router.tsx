import { rootRoute } from './routes/root';
import { indexRoute } from './routes/index';
import { coursesRoute } from './routes/courses';
import { parentsRoute } from './routes/parents';
import { faqRoute } from './routes/faq';
import { privacyRoute } from './routes/privacy';
import { termsRoute } from './routes/terms';
import {
  authRequestRoute,
  authCheckEmailRoute,
  authVerifyRoute,
  authCompleteRoute,
} from './routes/auth';
import { applyRoute } from './routes/apply';
import { applySectionRoute } from './routes/apply-section';
import { statusRoute } from './routes/status';
import { parentRoute } from './routes/parent';
import { parentApplicantRoute } from './routes/parent-applicant';

export const routeTree = rootRoute.addChildren([
  indexRoute,
  coursesRoute,
  parentsRoute,
  faqRoute,
  privacyRoute,
  termsRoute,
  authRequestRoute,
  authCheckEmailRoute,
  authVerifyRoute,
  authCompleteRoute,
  applyRoute,
  applySectionRoute,
  statusRoute,
  parentRoute,
  parentApplicantRoute,
]);
