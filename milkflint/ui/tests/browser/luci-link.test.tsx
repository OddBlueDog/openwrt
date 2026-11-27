// Open LuCI takes this tab to LuCI, in place of MilkFlint (as LuCI's link back
// to MilkFlint does), so no second tab of the router is left open.
import 'virtual:milkflint-themes.css';
import '@/styles.css';
import { afterEach, expect, test } from 'vitest';
import { cleanup } from 'vitest-browser-react';
import { LuciLink } from '@/components/layout/sidebar';
import { renderWithProviders } from './render';

afterEach(cleanup);

test('Open LuCI opens in this tab', async () => {
  const screen = await renderWithProviders(<LuciLink />);
  const link = screen.getByRole('link', { name: 'Open LuCI' });
  await expect.element(link).toHaveAttribute('href', '/cgi-bin/luci/');
  await expect.element(link).not.toHaveAttribute('target');
});
