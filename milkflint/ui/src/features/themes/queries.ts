// What Themes writes (see ARCHITECTURE.md). The themes themselves are the
// theme store's (lib/theme.ts, kept on the router); these are its writes as
// mutations, so a page shows each one's progress and failure the same way.
import { useMutation, type UseMutationResult } from '@tanstack/react-query';
import { deleteCustomTheme, saveCustomTheme, setThemeId } from '@/lib/theme';
import type { CustomTheme } from '@/theme/custom';

/** Use a theme on every device. */
export function useUseTheme(): UseMutationResult<void, Error, string> {
  return useMutation({ mutationFn: setThemeId });
}

/** Take one of your themes off the router. */
export function useDeleteTheme(): UseMutationResult<void, Error, string> {
  return useMutation({ mutationFn: deleteCustomTheme });
}

/** Save one of your themes, and with `use`, use it at once. */
export function useSaveTheme(): UseMutationResult<void, Error, { theme: CustomTheme; use: boolean }> {
  return useMutation({ mutationFn: ({ theme, use }: { theme: CustomTheme; use: boolean }) => saveCustomTheme(theme, { use }) });
}
