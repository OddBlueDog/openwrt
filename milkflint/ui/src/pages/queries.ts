// What the sign-in page does (see ARCHITECTURE.md): signing in is a
// mutation, and nothing is read into the query cache before it.
import { useMutation, type UseMutationResult } from '@tanstack/react-query';
import { login } from '@/lib/session';

/** Sign in as root with `password`. Not kept once nothing watches it: its variable is the password. */
export function useLogin(): UseMutationResult<void, Error, string> {
  return useMutation({ mutationFn: (password) => login('root', password), gcTime: 0 });
}
