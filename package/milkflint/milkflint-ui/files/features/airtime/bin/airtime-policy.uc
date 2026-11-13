// The airtime policy of the "airtime" feature, apart from the service that
// applies it (airtime), so that it can be tested by itself: nothing here reads
// or changes the router.
//
// The router's own airtime fairness gives every busy device an equal share
// of the air, however slow its link. A device at the edge of range then
// takes as long on the air as one in the same room, for a hundredth of the
// data, and a device that has stopped answering takes it for nothing: every
// frame is sent again and again at the lowest rates. This policy looks at
// what each device's link is worth and gives the poor ones less:
//
//   useful rate = the rate the router sends to it at
//                 x the share of its frames that get through
//
//   full   at or above the band's "good link" rate (60 Mbit/s on 5 and
//          6 GHz, 15 on 2.4 GHz, unless set otherwise): a full share,
//          nothing changed
//   slow   below that: a share that shrinks with the square root of the
//          useful rate (a quarter of the rate, half the share), so it still
//          gets more than its data would earn it; below the "very slow"
//          rate (30 and 8 Mbit/s) it is paced as well (see below)
//   weak   below the "weak link" rate (12 and 4 Mbit/s): the same curve
//          down to a floor,
//          only a frame or two of it queued in the radio at a time, and each
//          frame sent fewer times before it's given up on (where the driver
//          can: the MilkFlint mt76's per-device tx_tries)
//   lost   frames keep failing and none gets through, while the device is
//          awake: the smallest share, one frame in the radio at a time and
//          sent only twice, until one is answered. (Frames sent to a phone as it dozes off
//          fail too; that's its power save, not its link, and doesn't count.)
//
// A phone can also stop listening without saying so (asleep, with the router
// still taking it for awake): for some seconds nothing sent to it is
// answered, and the first frame it does answer goes out at the low rate
// the radio had fallen back to. None of that says its link is slow. So a
// second in which nothing got through leaves the delivery share alone
// (that's "lost", above), and a lower rate is only believed once a number
// of frames went through at it in each of two seconds close together; a
// higher one at once. (One such second is also what a phone gets that the
// router's driver held while it was silent: everything that waited for it,
// at once.) A link that really is slow shows it as soon as it carries
// traffic.
//
// A share only matters while devices compete for the air: alone, a weak
// device still gets all of it.
//
// A share by itself is weak, though: the radio takes turns between the
// devices it has frames for, a transmission each, and one at a low rate is
// long. So where the driver can (the MilkFlint mt76's per-device tx_pace),
// a slow device below PACE, a weak and a lost one are paced: while a device
// that isn't paced has traffic waiting, the paced one's ordinary traffic
// (not its voice or video) is sent for no more than a part of the time, its
// class's airtime goal: 17% for a very slow device, 12% for a weak one, 5%
// for a lost one, unless set otherwise. (Small, because a link that slow
// carries little for the air it takes, and its repeats aren't in the count.)
//
// The three rates and the three goals can be set per band in
// milkflint.wifi (settings_of() below reads them); unset, or not making
// sense together, they are these defaults.
//
// Or a band's shares can be worked out as it goes ("auto", at a strength:
// gentle, balanced or strict), in place of the very slow and weak goals and
// the very slow rate (auto_pace() below):
//
//   share = left x w / (the sum of w over the devices wanting the air now)
//   w     = (useful rate / good-link rate) ^ strength, a good link 1
//
// So a slow device's share follows how slow it is next to the others that
// want the air at that moment, and shrinks as more of them do (none
// wanting it right now counts as one, so that its share is ready when one
// starts). `left` is what devices using a little of the air (under 5%)
// leave. Strength 0 would be an equal share for every device (the router's
// own fairness), and the higher it is, the more the total speed counts
// against a slow device's: gentle is 0.5, balanced 1 (a share in
// proportion to the useful rate), strict 1.5. A device is paced from where
// its share beside one good link would be under four fifths of an even
// split, and never below the not-answering goal. The driver counts a
// device's airtime by an estimate that leaves its repeats out, so each
// second it was mostly held back, what it took is measured (the radio's
// own count, repeats in) and its pacing trimmed towards its share.
'use strict';

export const WEIGHT_FULL = 256;		// mac80211's default airtime weight
export const WEIGHT_FLOOR = 48;		// a weak device's smallest share
export const WEIGHT_LOST = 32;

// useful rate in Mbit/s
export const FULL = { '2g': 15, '5g': 60, '6g': 60 };
export const WEAK = { '2g': 4, '5g': 12, '6g': 12 };

// AQL limits for best effort and background, in us of airtime queued in the
// radio ([low, high]; null keeps the radio's own): at a weak device's rates
// a frame takes a millisecond or more, so these are a frame or two
export const AQL_WEAK = [ 1500, 2500 ];
export const AQL_LOST = [ 500, 500 ];

// useful rate in Mbit/s below which a slow device is paced too. Wi-Fi 5 and 6
// devices with a workable link are well above it
export const PACE = { '2g': 8, '5g': 30, '6g': 30 };

// airtime goals: the part of the time, in percent, a paced device of each
// class may be sent to while a device that isn't paced has traffic waiting
export const GOALS = { slow: 17, weak: 12, lost: 5 };

// the strengths of the auto shares (see above)
export const STRENGTHS = { gentle: 0.5, balanced: 1.0, strict: 1.5 };
// auto: paced from where the share beside one good link, w / (w + 1), would
// be under four fifths of an even split; that is w under 2/3
const GATE = 2.0 / 3;
// auto: a device that isn't paced wants the air when it has traffic waiting
// or took this much of the last second; one that took less leaves the rest
// to the others, but those together never more than half of it
const BUSY_AIR = 0.05;
const LIGHT_MAX = 0.5;
// auto: a device's pacing is trimmed after a second it was held back for at
// least this much of, when what it took is more than this far from its
// share; by the square root of the difference (half of it, as a factor),
// and to no less than half and no more than 1.25 times its share
const TRIM_HELD = 0.5;
const TRIM_BAND = 0.1;
const TRIM_GAIN = 0.5;
const TRIM_MIN = 0.5;
const TRIM_MAX = 1.25;

// the rate below which a slow link is paced in auto (see GATE), in Mbit/s
// to one place, and not below the weak rate
export function auto_pace_rate(full, weak, strength) {
	const r = int(full * GATE ** (1.0 / strength) * 10 + 0.5) / 10.0;
	return max(r, weak);
};

// A band's settings: { full, pace, weak } (useful rates in Mbit/s: a good
// link from `full`, a slow one paced below `pace`, a weak one below `weak`),
// { goal_slow, goal_weak, goal_lost } (percent) and { auto, strength } (the
// auto shares' strength by name and as a number; both null: the goals).
// `raw` is the milkflint.wifi section (airtime_<band>_full, _pace, _weak,
// _goal_slow, _goal_weak, _goal_lost, _auto) or null. A rate or goal that
// isn't a number in its range is the default; rates out of order (weak <=
// pace <= full; with auto weak <= full) are all three the defaults; `auto`
// other than a strength's name is the goals. With auto, `pace` is where
// pacing starts by GATE and the pace setting isn't used.
export function settings_of(raw, band) {
	const b = (FULL[band] != null) ? band : '5g';
	const num = (name, lo, hi, def) => {
		const v = raw?.[`airtime_${band}_${name}`];
		if (v == null || !match(`${v}`, /^[0-9]+(\.[0-9]+)?$/))
			return def;
		const n = +v;
		return (n >= lo && n <= hi) ? n : def;
	};
	let full = num('full', 1, 10000, FULL[b]);
	let pace = num('pace', 1, 10000, PACE[b]);
	let weak = num('weak', 1, 10000, WEAK[b]);
	const name = raw?.[`airtime_${band}_auto`];
	const strength = (type(name) == 'string') ? STRENGTHS[name] : null;
	// with auto there's no very slow rate set to be out of order with
	if ((strength == null) ? (weak > pace || pace > full) : (weak > full)) {
		full = FULL[b];
		pace = PACE[b];
		weak = WEAK[b];
	}
	if (strength != null)
		pace = auto_pace_rate(full, weak, strength);
	return {
		full, pace, weak,
		goal_slow: num('goal_slow', 1, 100, GOALS.slow),
		goal_weak: num('goal_weak', 1, 100, GOALS.weak),
		goal_lost: num('goal_lost', 1, 100, GOALS.lost),
		auto: (strength != null) ? name : null,
		strength
	};
};

// times a frame is sent before it's given up on (0: the driver's own, 15):
// at the lowest rates every try of a full-size frame is milliseconds of air
export const TRIES_WEAK = 6;
export const TRIES_LOST = 2;

// how much of the previous seconds the delivery share keeps (it's weighed by
// what was sent)
const KEEP = 0.6;
// a second counts for the delivery share with at least this many frames sent
const MIN_SENDS = 4;
// a lower rate is believed from seconds with at least this many frames
// through (a link that takes any air to speak of has many more), two of
// them no more than LOW_WITHIN seconds apart
const MIN_FRAMES = 8;
const LOW_WITHIN = 3;
// a step down in class needs this many seconds in a row, a step up this many
const DOWN_AFTER = 2;
const UP_AFTER = 3;
// within a class, the weight moves to another step when that step has been
// the one for this many seconds: a rate at a step's edge would otherwise
// change it every second
const WEIGHT_AFTER = 3;
// a device is lost after this many failed frames with none through
const LOST_FAILED = 3;
// what a frame sent 9 or more times, or given up on, counts as
const FAILED_SENDS = 12;

const RANK = { full: 3, slow: 2, weak: 1, lost: 0 };
// weights are set in steps, so that a small change of rate changes nothing
const STEPS = [ 256, 224, 192, 160, 128, 112, 96, 80, 64, 48, 32 ];

// (ucode wants a semicolon after an exported function)
export function band_of(freq) {
	return (freq > 5925) ? '6g' : (freq > 4900) ? '5g' : '2g';
};

// the weight for a useful rate: the square-root curve, in steps. `full`: the
// band's good-link rate, where it isn't the default
export function weight_for(useful, band, full) {
	full ??= FULL[band] ?? FULL['5g'];
	if (useful >= full)
		return WEIGHT_FULL;
	// the largest step s with s / WEIGHT_FULL <= sqrt(useful / full), compared
	// as squares: no square root needed
	for (let s in STEPS)
		if (s * s * full <= useful * WEIGHT_FULL * WEIGHT_FULL)
			return max(s, WEIGHT_FLOOR);
	return WEIGHT_FLOOR;
};

// the class a useful rate alone gives
function class_for(useful, cfg) {
	if (useful >= cfg.full)
		return 'full';
	return (useful < cfg.weak) ? 'weak' : 'slow';
}

// A device's state after another second.
//   prev    its state so far, or null for a device new to the policy
//   s       the second's figures: rate (Mbit/s the router sends to it at; 0
//           when not known yet), sends (transmissions of its frames,
//           repeats included), delivered and failed (frames that got through
//           or were given up on), asleep (the share of the second it spent
//           in power save, where the driver says; 0 otherwise)
//   band    '2g', '5g' or '6g'
//   cfg     the band's settings (settings_of()); the defaults without
// Returns { class, weight, aql, tries, pace, paced, useful, delivery, reason,
// ... }: what the service applies, and what the page shows.
export function decide(prev, s, band, cfg) {
	cfg ??= settings_of(null, band);
	const was = prev?.class;
	const st = {
		delivery: prev?.delivery ?? 1.0,
		rate: prev?.rate ?? 0,
		low: prev?.low ?? 0,
		class: prev?.class ?? 'full',
		streak: prev?.streak ?? 0,
		want: prev?.want ?? 'full',
		failed_run: prev?.failed_run ?? 0
	};

	// the rate its link is judged by: the one the router sends to it at, but
	// a lower one than before only once frames have gone through at it in
	// two seconds close together (after a silence the first frames go out
	// at whatever the radio had fallen back to, one or many at once)
	if (s.rate > 0 && (st.rate <= 0 || s.rate >= st.rate)) {
		st.rate = s.rate;
		st.low = 0;
	}
	else if (s.rate > 0 && s.delivered >= MIN_FRAMES) {
		if (st.low > 0) {
			st.rate = s.rate;
			st.low = 0;
		}
		else
			st.low = LOW_WITHIN;
	}
	else if (st.low > 0)
		st.low--;

	// the share of its transmissions that got a frame through. In a second it
	// partly slept, the frames given up on were sent at a device that wasn't
	// listening: they say nothing of its link and are left out. Nor does a
	// second in which nothing got through at all: that's a device not
	// answering (below), not a share
	const slept = (s.asleep ?? 0) > 0;
	const sends = slept ? max(s.delivered, s.sends - s.failed * FAILED_SENDS) : s.sends;
	if (sends >= MIN_SENDS && s.delivered > 0) {
		// (as a fraction whatever the counts' type: two whole numbers
		// would divide to 0 or 1)
		const now = min(1.0, max(0.0, 1.0 * s.delivered / sends));
		st.delivery = KEEP * st.delivery + (1 - KEEP) * now;
	}
	// frames given up on with none through: counted until one gets through,
	// and not while the device slept (those failed for that)
	if (s.delivered > 0)
		st.failed_run = 0;
	else if (!slept)
		st.failed_run += s.failed;

	st.useful = st.rate * st.delivery;
	// no rate yet (it has just joined): nothing to judge it by
	let want = (st.rate > 0) ? class_for(st.useful, cfg) : 'full';
	if (st.failed_run >= LOST_FAILED)
		want = 'lost';

	// lost at once (every second of it costs the others), and back from it
	// with the first frame that gets through, to what its link is worth;
	// other steps wait a little
	if (want == 'lost' || st.class == 'lost') {
		st.class = want;
		st.streak = 0;
	}
	else if (want != st.class) {
		st.streak = (want == st.want) ? st.streak + 1 : 1;
		if (st.streak >= ((RANK[want] < RANK[st.class]) ? DOWN_AFTER : UP_AFTER)) {
			st.class = want;
			st.streak = 0;
		}
	}
	else
		st.streak = 0;
	st.want = want;

	switch (st.class) {
	case 'lost':
		st.weight = WEIGHT_LOST;
		st.aql = AQL_LOST;
		st.tries = TRIES_LOST;
		st.reason = 'not answering';
		break;
	case 'weak':
		st.weight = weight_for(st.useful, band, cfg.full);
		st.aql = AQL_WEAK;
		st.tries = TRIES_WEAK;
		st.reason = 'weak link';
		break;
	case 'slow':
		st.weight = weight_for(st.useful, band, cfg.full);
		st.aql = null;
		st.tries = 0;
		st.reason = 'slow link';
		break;
	default:
		st.weight = WEIGHT_FULL;
		st.aql = null;
		st.tries = 0;
		st.reason = null;
	}

	// a change of class takes its weight at once; within a class a new step
	// waits a little
	const target = st.weight;
	st.weight_streak = 0;
	if (prev?.weight != null && was == st.class && target != prev.weight) {
		st.weight_streak = (prev.weight_want == target) ? (prev.weight_streak ?? 0) + 1 : 1;
		if (st.weight_streak < WEIGHT_AFTER)
			st.weight = prev.weight;
		else
			st.weight_streak = 0;
	}
	st.weight_want = target;

	// paced: a lost and a weak device always, a slow one below the very slow
	// rate. Around that rate a slow one waits a little either way, as for a
	// step of class
	const below = st.class == 'lost' || st.class == 'weak' ||
		(st.class == 'slow' && st.useful < cfg.pace);
	st.paced = prev?.paced ?? false;
	st.pace_streak = 0;
	if (st.class != 'slow' || was != 'slow')
		st.paced = below;
	else if (below != st.paced) {
		st.pace_streak = (prev?.pace_streak ?? 0) + 1;
		if (st.pace_streak >= (below ? DOWN_AFTER : UP_AFTER)) {
			st.paced = below;
			st.pace_streak = 0;
		}
	}
	// its class's goal, in thousandths of the time
	const goal = (st.class == 'lost') ? cfg.goal_lost : (st.class == 'weak') ? cfg.goal_weak : cfg.goal_slow;
	st.pace = st.paced ? int(goal * 10 + 0.5) : 0;
	// for auto_pace(): the share it had for the second just measured (in
	// thousandths of the air; 0: none yet) and its trim, while it stays paced
	st.aim = st.paced ? (prev?.aim ?? 0) : 0;
	st.trim = st.paced ? (prev?.trim ?? 1.0) : 1.0;
	return st;
};

// a device's weight among those wanting the air, for the auto shares
function auto_weight(useful, cfg) {
	return (min(max(useful, 0.1), cfg.full) / cfg.full) ** cfg.strength;
}

// The auto shares (see the top) of a band's devices, after decide() has
// had their second. `list`: [{ st, air, air_tx, backlog, held }] (st: what
// decide() returned; air: the share of the last second the device took,
// both ways, and air_tx the router's sending to it alone, 0..1; backlog:
// its best effort or background traffic waiting at the reading; held: the
// share of the last second its traffic was held back, 0..1). Sets each
// paced device's `aim` (its share, in thousandths of the air), `trim` and
// `pace` (what the driver is given, in thousandths of the time); one not
// answering keeps its goal. Returns { competing }: how many devices that
// aren't paced wanted the air (0: none, which counted as one).
export function auto_pace(list, cfg) {
	let sum = 0.0, light = 0.0, competing = 0;
	for (let e in list) {
		const st = e.st;
		if (st.class == 'lost')
			continue;
		if (st.paced)
			sum += auto_weight(st.useful, cfg);
		else if (e.backlog || (e.air ?? 0) >= BUSY_AIR) {
			sum += auto_weight(st.useful, cfg);
			competing++;
		}
		else
			light += e.air ?? 0;
	}
	if (!competing)
		sum += 1.0;
	const left = max(1.0 - LIGHT_MAX, 1.0 - light);
	const floor = int(cfg.goal_lost * 10 + 0.5);
	for (let e in list) {
		const st = e.st;
		if (!st.paced)
			continue;
		if (st.class == 'lost') {
			st.aim = st.pace;
			st.trim = 1.0;
			continue;
		}
		// what it took in a second it was held back for most of, against
		// the share it had then
		const took = e.air_tx ?? 0;
		if (st.aim > 0 && (e.held ?? 0) >= TRIM_HELD && took > 0) {
			const ratio = st.aim / 1000.0 / took;
			if (ratio > 1 + TRIM_BAND || ratio < 1 - TRIM_BAND)
				st.trim = min(TRIM_MAX, max(TRIM_MIN, st.trim * ratio ** TRIM_GAIN));
		}
		st.aim = min(1000, max(floor, int(1000 * left * auto_weight(st.useful, cfg) / sum + 0.5)));
		st.pace = min(1000, max(1, int(st.aim * st.trim + 0.5)));
	}
	return { competing };
};

// The transmissions behind the driver's tx_attempts counters (frames sent
// once, twice, 3-4, 5-8 and 9 or more times, and those never answered),
// between two readings: { sends, delivered, failed }. The ranges count as
// their middle.
const TRIES = { '1': 1, '2': 2, '3-4': 3.5, '5-8': 6.5, '9+': FAILED_SENDS };
export function attempts_delta(a, b) {
	let frames = 0, sends = 0;
	for (let k, n in TRIES) {
		const d = (b?.[k] ?? 0) - (a?.[k] ?? 0);
		if (d < 0)
			return null;	// the counters started over
		frames += d;
		sends += d * n;
	}
	const failed = (b?.failed ?? 0) - (a?.failed ?? 0);
	if (failed < 0)
		return null;
	return { sends, delivered: max(0, frames - failed), failed };
};
