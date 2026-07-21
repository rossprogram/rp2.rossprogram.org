import { rootRoute } from './routes/root';
import { indexRoute } from './routes/index';
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
import { guardianRoute } from './routes/guardian';
import { guardianApplicantRoute } from './routes/guardian-applicant';

export const routeTree = rootRoute.addChildren([
  indexRoute,
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
  guardianRoute,
  guardianApplicantRoute,
]);
