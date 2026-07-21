import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchApplication, patchResponses, submitApplication } from '../../api/client';
import type { ApplicationView } from '../../api/client';

const KEY = ['application'] as const;

export function useApplication() {
  return useQuery({ queryKey: KEY, queryFn: fetchApplication });
}

export function useSaveResponses() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (responses: Record<string, unknown>) => patchResponses(responses),
    onSuccess: (result, variables) => {
      qc.setQueryData<ApplicationView>(KEY, (prev) =>
        prev
          ? {
              ...prev,
              responses: { ...prev.responses, ...variables },
              updatedAt: result.updatedAt,
            }
          : prev,
      );
    },
  });
}

export function useSubmitApplication() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: submitApplication,
    onSuccess: (result) => {
      qc.setQueryData<ApplicationView>(KEY, (prev) =>
        prev ? { ...prev, status: result.status, submittedAt: result.submittedAt } : prev,
      );
    },
  });
}
