// banIP's license, as AdGuard Home's page gives its own: what banIP and the
// GNU awk it reads its lists with are, under which license, and links to the
// license texts this image carries (an older image has none: then the GPL's
// own copy) and to the source.
import type { ReactElement } from 'react';
import type { BanipStatus } from './api';

const link = 'link font-medium underline-offset-4';
const GPL3 = 'https://www.gnu.org/licenses/gpl-3.0.txt';

export function LicenseCard({ s }: { s: BanipStatus }): ReactElement {
  const version = s.version ?? undefined;
  return (
    <section
      aria-labelledby="banip-license"
      className="flex flex-col gap-2 rounded-xl border bg-card px-5 py-4 text-sm text-muted-foreground shadow-xs"
    >
      <h2 id="banip-license" className="font-medium text-foreground">
        License
      </h2>
      <p className="max-w-4xl">
        banIP, by Dirk Brenken, is free software under the GNU General Public License version 3 or later. It reads its lists with
        GNU awk (gawk), free software under the same license. Both come from OpenWrt’s packages feed: banIP unchanged, gawk built
        as gawk only (not as the router’s awk). MilkFlint isn’t made or endorsed by banIP’s author.
      </p>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        <a href={s.licenses?.banip ?? GPL3} target="_blank" rel="noreferrer" className={link}>
          License (GPL-3.0)
        </a>
        {s.licenses?.gawk !== null && s.licenses?.gawk !== undefined && (
          <a href={s.licenses.gawk} target="_blank" rel="noreferrer" className={link}>
            GNU awk’s license
          </a>
        )}
        <a
          href="https://github.com/openwrt/packages/tree/openwrt-25.12/net/banip"
          target="_blank"
          rel="noreferrer"
          className={link}
        >
          Source code{version === undefined ? '' : ` (banIP ${version})`}
        </a>
        <a href="https://www.gnu.org/software/gawk/" target="_blank" rel="noreferrer" className={link}>
          GNU awk
        </a>
      </div>
    </section>
  );
}
