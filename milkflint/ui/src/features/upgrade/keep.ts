// Whether an upgrade keeps the settings, to start with. Upgrading from an
// earlier MilkFlint keeps them (the release notes say so); coming from or
// going to another firmware starts afresh. The router's check of the image
// (rpcd's validate_firmware_image, sysupgrade --test) says whether it fits
// and whether it can keep settings, not which firmware it is, so that is
// told from the file's name: MilkFlint's images are named
// milkflint-<version>-…-sysupgrade.bin. Anything the name doesn't settle
// keeps nothing unless the user turns keeping on.
// No imports from the app, so the tests (ui/tests) load it as it is.

export type ImageKind = 'milkflint' | 'openwrt' | 'glinet' | 'unknown';

/** Which firmware an image is, from its file name. */
export function imageKind(name: string): ImageKind {
  const n = name.trim().toLowerCase();
  if (n.includes('milkflint')) return 'milkflint';
  // GL.iNet's own: openwrt-mt6000-4.7.4-0925-….bin; stock OpenWrt's name the
  // model after the target instead (openwrt-25.12.0-mediatek-filogic-glinet_gl-mt6000-…)
  if (/^(?:openwrt-)?(?:gl-)?mt6000-\d+\.\d+/.test(n)) return 'glinet';
  if (n.startsWith('openwrt-')) return 'openwrt';
  return 'unknown';
}

export interface KeepChoice {
  /** what the switch starts at */
  keep: boolean;
  /** the image can keep settings at all */
  allowed: boolean;
  kind: ImageKind;
  /** why it starts where it does, one sentence */
  reason: string;
}

/**
 * Keeping settings, to start with, for an image of this name. `running` is
 * the firmware the router runs now (board's release.distribution, "MilkFlint"),
 * undefined while it isn't known; `allowBackup` is the image check's
 * allow_backup.
 */
export function keepChoice({
  running,
  image,
  allowBackup,
}: {
  running: string | undefined;
  image: string;
  allowBackup: boolean | undefined;
}): KeepChoice {
  const kind = imageKind(image);
  if (allowBackup === false) return { keep: false, allowed: false, kind, reason: 'This image can’t keep the current settings.' };
  const fromMilkFlint = running?.trim().toLowerCase() === 'milkflint';
  if (!fromMilkFlint) {
    return {
      keep: false,
      allowed: true,
      kind,
      reason:
        running === undefined
          ? 'Couldn’t read which firmware the router runs now, so settings are erased unless you turn this on.'
          : `The router runs ${running} now, not MilkFlint: start the new firmware with factory settings.`,
    };
  }
  switch (kind) {
    case 'milkflint':
      return { keep: true, allowed: true, kind, reason: 'A MilkFlint image: upgrading from MilkFlint keeps your settings.' };
    case 'openwrt':
      return {
        keep: false,
        allowed: true,
        kind,
        reason: 'A stock OpenWrt image: MilkFlint’s settings may not suit it, so it starts with factory settings.',
      };
    case 'glinet':
      return {
        keep: false,
        allowed: true,
        kind,
        reason: 'A GL.iNet image: MilkFlint’s settings may not suit it, so it starts with factory settings.',
      };
    case 'unknown':
      return {
        keep: false,
        allowed: true,
        kind,
        reason: 'Its name doesn’t say which firmware it is: turn this on if it’s a MilkFlint image.',
      };
  }
}

/** What an upgrade that erases the settings leaves the router as. */
export function erasedText(kind: ImageKind): string {
  return kind === 'glinet'
    ? 'It comes back with GL.iNet’s own factory settings.'
    : 'It comes back as new, at http://192.168.1.1/, with no admin password and Wi-Fi off: only a device on a cable can sign in.';
}
