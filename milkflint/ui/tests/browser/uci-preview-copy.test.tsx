// UciPreview's copy button inside a Sheet (Radix Dialog): on the router's
// plain-HTTP page, window.isSecureContext is false so copy falls back to
// document.execCommand('copy'). Radix's FocusScope traps focus inside
// SheetContent, so a textarea appended to document.body loses focus and
// selection before execCommand('copy') runs.
import 'virtual:milkflint-themes.css';
import '@/styles.css';
import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, render } from 'vitest-browser-react';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { UciPreview } from '@/features/firewall/sheet-parts';
import type { Section } from '@/lib/api/uci';

afterEach(async () => {
  vi.restoreAllMocks();
  await cleanup();
});

const queue: Section = {
  '.type': 'queue',
  '.name': 'wan',
  interface: 'pppoe-wan',
  use_mq_egress: '0',
};

test('copies /etc/config/sqm inside a Sheet over plain HTTP (execCommand fallback)', async () => {
  vi.spyOn(window, 'isSecureContext', 'get').mockReturnValue(false);

  let copied = '';
  const onCopy = (e: ClipboardEvent): void => {
    copied = window.getSelection()?.toString() ?? '';
    if (copied === '' && document.activeElement instanceof HTMLTextAreaElement) {
      const el = document.activeElement;
      copied = el.value.slice(el.selectionStart, el.selectionEnd);
    }
    e.preventDefault();
  };
  document.addEventListener('copy', onCopy);

  try {
    const screen = await render(
      <Sheet open>
        <SheetContent>
          <SheetTitle>Advanced Smart Queue settings</SheetTitle>
          <SheetDescription>Preview</SheetDescription>
          <UciPreview config="sqm" type="queue" original={queue} changes={[]} />
        </SheetContent>
      </Sheet>,
    );

    await screen.getByRole('button', { name: 'Copy' }).click();
    expect(copied).toBe("config queue 'wan'\n\toption interface 'pppoe-wan'\n\toption use_mq_egress '0'");
  } finally {
    document.removeEventListener('copy', onCopy);
  }
});
