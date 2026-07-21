import { Outlet, createRootRouteWithContext } from '@tanstack/react-router';
import type { QueryClient } from '@tanstack/react-query';
import { PageFrame } from '../components/Layout';

export const rootRoute = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: () => (
    <PageFrame>
      <Outlet />
    </PageFrame>
  ),
});
