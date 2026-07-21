import { rootRoute } from './routes/root';
import { indexRoute } from './routes/index';
import {
  authRequestRoute,
  authCheckEmailRoute,
  authVerifyRoute,
} from './routes/auth';
import { applyRoute } from './routes/apply';
import { applySectionRoute } from './routes/apply-section';
import { statusRoute } from './routes/status';

export const routeTree = rootRoute.addChildren([
  indexRoute,
  authRequestRoute,
  authCheckEmailRoute,
  authVerifyRoute,
  applyRoute,
  applySectionRoute,
  statusRoute,
]);
