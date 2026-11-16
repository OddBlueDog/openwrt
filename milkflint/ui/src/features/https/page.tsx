// HTTPS has moved into Router access (#/admin-password), whose HTTPS card
// this route opens on: old links, bookmarks and the address a save moves
// this page to (model.ts pageUrl) land there.
import { type ReactElement, useEffect } from 'react';
import { href } from '@/lib/router';

export function HttpsPage(): ReactElement | null {
  useEffect(() => {
    window.location.replace(`${href('admin-password')}/https`);
  }, []);
  return null;
}
