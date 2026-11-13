// Stand-ins for OpenWrt's shell libraries, for tests that run the router's
// scripts on the Mac.

/**
 * /lib/functions.sh's config functions, with config_load reading
 * <configDir>/<name> as uci export prints it (which is what OpenWrt's
 * config_load evaluates too).
 */
export function functionsSh(configDir: string): string {
  return `
N="
"
append() {
	local var="$1" value="$2" sep="\${3:- }"
	eval "$var=\\\${$var:+\\\${$var}\\\${value:+\\$sep}}\\$value"
}
reset_cb() {
	config_cb() { return 0; }
	option_cb() { return 0; }
	list_cb() { return 0; }
}
reset_cb
package() { return 0; }
config() {
	local cfgtype="$1" name="$2"
	CONFIG_NUM_SECTIONS=$((CONFIG_NUM_SECTIONS + 1))
	name="\${name:-cfg$CONFIG_NUM_SECTIONS}"
	append CONFIG_SECTIONS "$name"
	CONFIG_SECTION="$name"
	config_set "$name" TYPE "$cfgtype"
	config_cb "$cfgtype" "$name"
}
option() {
	local varname="$1"
	shift
	config_set "$CONFIG_SECTION" "$varname" "$*"
	option_cb "$varname" "$*"
}
list() {
	local varname="$1"
	shift
	append "CONFIG_\${CONFIG_SECTION}_\${varname}" "$*" " "
	list_cb "$varname" "$*"
}
config_set() { eval "CONFIG_$1_$2=\\$3"; }
config_get() {
	case "$3" in
	"") eval echo "\\"\\\${CONFIG_\${1}_\${2}:-\\\${4}}\\"" ;;
	*) eval "\${1}=\\\${CONFIG_\${2}_\${3}:-\\\${4}}" ;;
	esac
}
config_foreach() {
	local fn="$1" type="$2" section cfgtype
	[ "$#" -ge 2 ] && shift 2 || shift
	for section in $CONFIG_SECTIONS; do
		config_get cfgtype "$section" TYPE
		[ -n "$type" ] && [ "$cfgtype" != "$type" ] && continue
		eval "$fn \\"\\$section\\" \\"\\$@\\""
	done
}
config_load() {
	CONFIG_SECTIONS=
	CONFIG_NUM_SECTIONS=0
	CONFIG_SECTION=
	[ -f "${configDir}/$1" ] && . "${configDir}/$1"
	config_cb
}
`;
}

/** one config file, as uci export prints it */
export function uciExport(config: string, type: string, sections: Record<string, Record<string, string>>): string {
  const text = Object.entries(sections)
    .map(([name, options]) => `config ${type} '${name}'\n${Object.entries(options).map(([o, v]) => `\toption ${o} '${v}'\n`).join('')}`)
    .join('\n');
  return `package ${config}\n\n${text}`;
}
