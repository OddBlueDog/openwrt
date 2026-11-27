// HTTPS has moved into Router access (#/admin-password), whose HTTPS card
// this route opens on: old links, bookmarks and the address a save moves
// this page to (model.ts pageUrl) land there.
import { pageLink } from '@/lib/router';
import { useNavigate } from '@tanstack/react-router';
import { type ReactElement, useEffect } from 'react';

export function HttpsPage(): ReactElement | null {
  const navigate = useNavigate();
  useEffect(() => {
    void navigate({ ...pageLink('admin-password', 'https'), replace: true });
  }, [navigate]);
  return null;
}
