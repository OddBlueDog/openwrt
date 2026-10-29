#!/bin/sh
# Checks rtprio on the router (or any Linux box it's built for), as root:
#   sh rtprio-test.sh [path to rtprio]   (default /usr/libexec/milkflint/rtprio)
# A sleeping child is moved to SCHED_FIFO 1, SCHED_RR 3 and back to
# SCHED_OTHER; each step must read back as set, and bad usage must fail.
R=${1:-/usr/libexec/milkflint/rtprio}
fail=0
check() { [ "$2" = "$3" ] && echo "ok   $1" || { echo "FAIL $1: got '$2', want '$3'"; fail=1; }; }

sleep 30 & pid=$!
check "starts other"  "$($R $pid)"          "$pid other 0"
check "fifo 1"        "$($R $pid fifo 1)"   "$pid fifo 1"
check "reads fifo 1"  "$($R $pid)"          "$pid fifo 1"
check "rr 3"          "$($R $pid rr 3)"     "$pid rr 3"
check "back to other" "$($R $pid other)"    "$pid other 0"
$R $pid fifo 2> /dev/null; check "fifo without a priority fails" "$?" 2
$R $pid fifo 100 > /dev/null 2>&1; check "priority 100 fails" "$?" 1
$R 2> /dev/null; check "no pid fails" "$?" 2
kill $pid
exit $fail
