import { createRoute, Link, redirect } from '@tanstack/react-router';
import { z } from 'zod';
import { rootRoute } from './root';
import { fetchGuardianSurvey, fetchMe, submitGuardianSurvey } from '../api/client';
import { SurveyPage } from '../features/survey/SurveyPage';

/* The parent survey, answered once per enrolled student. */

async function ensureGuardian() {
  const me = await fetchMe();
  if (!me) throw redirect({ to: '/auth/request', search: { role: 'guardian' } });
  if (!me.roles.includes('guardian')) throw redirect({ to: '/' });
}

function GuardianSurveyPage() {
  const { appId } = parentSurveyRoute.useParams();
  return (
    <SurveyPage
      queryKey={['parent', 'survey', appId]}
      fetch={() => fetchGuardianSurvey(appId)}
      submit={(answers) => submitGuardianSurvey(appId, answers)}
      back={
        <Link to="/parent/applicant/$appId" params={{ appId }} className="btn btn-ghost no-underline">
          ← Back to your student&rsquo;s page
        </Link>
      }
    />
  );
}

const Params = z.object({ appId: z.string().min(1) });

export const parentSurveyRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/parent/applicant/$appId/survey',
  parseParams: (raw) => Params.parse(raw),
  beforeLoad: ensureGuardian,
  component: GuardianSurveyPage,
});
