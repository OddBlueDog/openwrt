// What the shared components read and write (see ARCHITECTURE.md): the
// board for the frame around every page, and a package's updates.
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { checkPackage, getPackageStatus, installPackage, type PackageName } from '@/lib/api/packages';
import { type Board, getBoard } from '@/lib/api/system';
import { type LiveQuery, liveQuery } from '@/lib/query/options';

type PackageStatus = Awaited<ReturnType<typeof getPackageStatus>>;

export const componentQueries = {
  /** the board and host name, for the menu's header: every minute */
  board: (): LiveQuery<Board> => liveQuery(['shell', 'board'], getBoard, 60_000),
  /** a package's installed and newest versions, every 6 s, or 1.5 s while a check or install runs */
  packageStatus: (name: PackageName): LiveQuery<PackageStatus> =>
    liveQuery(
      ['packages', name],
      () => getPackageStatus(name),
      (d) => (d?.busy === true ? 1500 : 6000),
    ),
};

/** Check for a package's updates, or install a version ('' for the newest); its status reads again after. */
export function usePackageAction(
  name: PackageName,
): UseMutationResult<void, Error, { action: 'check' } | { action: 'install'; version: string }> {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (v) => (v.action === 'check' ? checkPackage(name) : installPackage(name, v.version)),
    onSettled: () => client.invalidateQueries({ queryKey: componentQueries.packageStatus(name).queryKey }),
  });
}
