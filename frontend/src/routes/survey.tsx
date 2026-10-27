import { createRoute, redirect } from '@tanstack/react-router';
import { rootRoute } from './root';
import { fetchMe, fetchSurvey, submitSurvey } from '../api/client';
import { SurveyPage } from '../features/survey/SurveyPage';

/* The enrolled student's term survey. */

async function ensureAuth() {
  const me = await fetchMe();
  if (!me) throw redirect({ to: '/auth/request' });
}

function StudentSurveyPage() {
  return <SurveyPage queryKey={['survey']} fetch={fetchSurvey} submit={submitSurvey} />;
}

export const surveyRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/survey',
  beforeLoad: ensureAuth,
  component: StudentSurveyPage,
});
