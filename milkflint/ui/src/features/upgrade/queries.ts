// What Firmware upgrade reads and does (see ARCHITECTURE.md): the running
// firmware, the image sent up and checked, and the upgrade after which the
// page waits for the router and reloads (routerHealth stays a plain call).
import { useMutation, type UseMutationResult } from '@tanstack/react-query';
import { type Board, getBoard, getInfo, type SystemInfo } from '@/lib/api/system';
import { type LiveQuery, liveQuery, type RouterQuery, settingsQuery } from '@/lib/query/options';
import { waitForRouterAndReload, type RestartPhase } from '../backup-reset/api';
import { type Check, checkImage, discardImage, startUpgrade, uploadImage, type Validation, validateImage } from './api';

export const upgradeQueries = {
  /** the board and the firmware it runs, every minute */
  board: (): LiveQuery<Board> => liveQuery(['upgrade', 'board'], getBoard, 60_000),
  /** how long the router has been up: read once, after an upgrade's reload */
  info: (): RouterQuery<SystemInfo> => settingsQuery(['upgrade', 'info'], getInfo),
};

export interface SendImage {
  file: File;
  /** how far the upload got, 0–1 */
  onProgress: (fraction: number) => void;
  /** the file is up: the router checks it now */
  onChecking: () => void;
}

/** Send an image up (reporting how far it got) and have the router check it. */
export function useCheckImage(): UseMutationResult<{ validation: Validation; check: Check }, Error, SendImage> {
  return useMutation({
    mutationFn: async ({ file, onProgress, onChecking }: SendImage) => {
      await uploadImage(file, onProgress);
      onChecking();
      const [validation, check] = await Promise.all([validateImage(), checkImage()]);
      return { validation, check };
    },
  });
}

/** Drop the image sent up: best-effort (the router drops it at its next restart anyway). */
export function useDiscardImage(): UseMutationResult<void, Error, void> {
  return useMutation({ mutationFn: () => discardImage().catch(() => undefined) });
}

/** Write the image and restart; then wait for the router to come back and reload the page. */
export function useStartUpgrade(): UseMutationResult<
  never,
  Error,
  { keep: boolean; force: boolean; onPhase: (phase: RestartPhase) => void }
> {
  return useMutation({
    mutationFn: async ({ keep, force, onPhase }: { keep: boolean; force: boolean; onPhase: (phase: RestartPhase) => void }) => {
      try {
        await startUpgrade(keep, force);
      } catch {
        // the router may already be going down
      }
      return waitForRouterAndReload(onPhase);
    },
  });
}
