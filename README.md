<img src="milkflint/logo.svg" width="96" alt="MilkFlint logo: a flint rock, half full of milk">

# MilkFlint: OpenWrt for the GL.iNet Flint 2 (GL-MT6000)

MilkFlint is OpenWrt with a few changes for the Flint 2. It aims for:

- **Stable 5 GHz Wi-Fi**: a fork of the open-source mt76 driver with fixes
  for the MT7986's Wi-Fi (resets, power save, block-ack sessions, radar
  detection, firmware replies and more), plus a few mac80211 and hostapd
  fixes.
- **RSS**: received Ethernet traffic spread over the MT7986's receive
  rings, each with its own interrupt and CPU core, instead of all on one.
- **cake_mq**: multi-queue CAKE for Smart Queue (SQM), sharing the line's
  rate between the queues by demand, with less CPU per packet, and working
  with flow offloading.

It also has its own web interface for the everyday settings, served at the
router's address; LuCI stays installed under "Advanced".

MilkFlint is experimental (an alpha). Images are on the
[Releases](https://github.com/OddBlueDog/openwrt/releases) page.

## Installing

> **Don't keep settings.** Untick "Keep settings" when you flash MilkFlint,
> whether the router runs GL.iNet's firmware, OpenWrt or an earlier
> MilkFlint (from a shell: `sysupgrade -n`). Settings from another firmware
> or an earlier alpha may not match this one; start clean and set the
> router up again. Back up first if you want your old settings for
> reference.

Flash only `milkflint-*-glinet_gl-mt6000-squashfs-sysupgrade.bin`. Never
the factory, preloader or bl31-uboot images: they can brick the router or
replace its bootloader, and with it the U-Boot recovery page.

- **From GL.iNet's firmware:** at <http://192.168.8.1>, System → Upgrade →
  Local Upgrade, upload the image, untick "Keep Settings".
- **From OpenWrt:** LuCI's System → Backup / Flash Firmware → Flash image,
  untick "Keep settings".
- **If it won't boot:** U-Boot recovery, on
  [OpenWrt's GL-MT6000 page](https://openwrt.org/toh/gl.inet/gl-mt6000).

Then plug a cable into a LAN port and open <http://192.168.1.1>. There's no
password yet: sign in with it empty and set one under System → Admin
Password. Wi-Fi is off until you set it up on the Wi-Fi page, with your
country.

## This branch

`milkflint-25.12` is the OpenWrt release `v25.12.6` with MilkFlint's
changes as commits on top, so `git log v25.12.6..` lists all of them. A new
OpenWrt release is picked up by rebasing them onto its tag.

| Where | What |
|---|---|
| `target/linux/`, `package/kernel/mac80211/`, `package/network/services/hostapd/`, `package/base-files/` | Kernel, Ethernet, mac80211 and hostapd patches, and MilkFlint's name and version |
| `package/kernel/mt76/patches/` | The mt76 driver fork, on upstream mt76 of the date in its Makefile |
| `package/milkflint/milkflint-ui/` | The web interface package (`htdocs/` is the built interface) |
| `package/milkflint/` | Newer versions of dnsproxy, miniupnpd, nlbwmon and sqm-scripts; they replace the feeds' copies |
| `milkflint/ui/` | The web interface's source (React, TypeScript) |
| `milkflint/diffconfig` | The build configuration |

## Building

On a Linux build host set up for OpenWrt (see below):

```bash
./scripts/feeds update -a
./scripts/feeds install -a
cp milkflint/diffconfig .config
make defconfig
make download
make -j$(nproc)
```

`feeds install` says it isn't overriding the core packages in
`package/milkflint/`: that's how they replace the feeds' copies. The images
are in `bin/targets/mediatek/filogic/`; flash the
`milkflint-*-glinet_gl-mt6000-squashfs-sysupgrade.bin` one (see Installing).

To build the web interface after changing it (Node.js 24 and pnpm):

```bash
cd milkflint/ui
pnpm install --frozen-lockfile
pnpm package
```

`pnpm package` checks it (TypeScript, ESLint), builds it and copies it into
`package/milkflint/milkflint-ui/htdocs/`.

---

*The rest of this README is OpenWrt's.*

![OpenWrt logo](include/logo.png)

OpenWrt Project is a Linux operating system targeting embedded devices. Instead
of trying to create a single, static firmware, OpenWrt provides a fully
writable filesystem with package management. This frees you from the
application selection and configuration provided by the vendor and allows you
to customize the device through the use of packages to suit any application.
For developers, OpenWrt is the framework to build an application without having
to build a complete firmware around it; for users this means the ability for
full customization, to use the device in ways never envisioned.

Sunshine!

## Download

Built firmware images are available for many architectures and come with a
package selection to be used as WiFi home router. To quickly find a factory
image usable to migrate from a vendor stock firmware to OpenWrt, try the
*Firmware Selector*.

* [OpenWrt Firmware Selector](https://firmware-selector.openwrt.org/)

If your device is supported, please follow the **Info** link to see install
instructions or consult the support resources listed below.

## 

An advanced user may require additional or specific package. (Toolchain, SDK, ...) For everything else than simple firmware download, try the wiki download page:

* [OpenWrt Wiki Download](https://openwrt.org/downloads)

## Development

To build your own firmware you need a GNU/Linux, BSD or macOS system (case
sensitive filesystem required). Cygwin is unsupported because of the lack of a
case sensitive file system.

### Requirements

You need the following tools to compile OpenWrt, the package names vary between
distributions. A complete list with distribution specific packages is found in
the [Build System Setup](https://openwrt.org/docs/guide-developer/build-system/install-buildsystem)
documentation.

```
binutils bzip2 diff find flex gawk gcc-6+ getopt grep install libc-dev libz-dev
make4.1+ perl python3.7+ rsync subversion unzip which
```

### Quickstart

1. Run `./scripts/feeds update -a` to obtain all the latest package definitions
   defined in feeds.conf / feeds.conf.default

2. Run `./scripts/feeds install -a` to install symlinks for all obtained
   packages into package/feeds/

3. Run `make menuconfig` to select your preferred configuration for the
   toolchain, target system & firmware packages.

4. Run `make` to build your firmware. This will download all sources, build the
   cross-compile toolchain and then cross-compile the GNU/Linux kernel & all chosen
   applications for your target system.

### Related Repositories

The main repository uses multiple sub-repositories to manage packages of
different categories. All packages are installed via the OpenWrt package
manager called `opkg`. If you're looking to develop the web interface or port
packages to OpenWrt, please find the fitting repository below.

* [LuCI Web Interface](https://github.com/openwrt/luci): Modern and modular
  interface to control the device via a web browser.

* [OpenWrt Packages](https://github.com/openwrt/packages): Community repository
  of ported packages.

* [OpenWrt Routing](https://github.com/openwrt/routing): Packages specifically
  focused on (mesh) routing.

* [OpenWrt Video](https://github.com/openwrt/video): Packages specifically
  focused on display servers and clients (Xorg and Wayland).

## Support Information

For a list of supported devices see the [OpenWrt Hardware Database](https://openwrt.org/supported_devices)

### Documentation

* [Quick Start Guide](https://openwrt.org/docs/guide-quick-start/start)
* [User Guide](https://openwrt.org/docs/guide-user/start)
* [Developer Documentation](https://openwrt.org/docs/guide-developer/start)
* [Technical Reference](https://openwrt.org/docs/techref/start)

### Support Community

* [Forum](https://forum.openwrt.org): For usage, projects, discussions and hardware advise.
* [Support Chat](https://webchat.oftc.net/#openwrt): Channel `#openwrt` on **oftc.net**.

### Developer Community

* [Bug Reports](https://bugs.openwrt.org): Report bugs in OpenWrt
* [Dev Mailing List](https://lists.openwrt.org/mailman/listinfo/openwrt-devel): Send patches
* [Dev Chat](https://webchat.oftc.net/#openwrt-devel): Channel `#openwrt-devel` on **oftc.net**.

## License

OpenWrt is licensed under GPL-2.0
