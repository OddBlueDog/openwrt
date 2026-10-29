/* rtprio: show or set a thread's scheduling policy. packet-steering.sh runs
 * the RSS rings' NAPI threads with it (busybox's chrt fails on musl).
 *
 *   rtprio PID                 print "PID policy priority"
 *   rtprio PID fifo|rr PRIO    SCHED_FIFO/SCHED_RR at PRIO (1-99)
 *   rtprio PID other           back to SCHED_OTHER (nice is left alone)
 */
#include <sched.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/syscall.h>
#include <unistd.h>

/* musl's sched_setscheduler() is a stub returning ENOSYS: use the syscalls */
static int get_policy(pid_t pid)
{
	return syscall(SYS_sched_getscheduler, pid);
}

static int set_policy(pid_t pid, int policy, int prio)
{
	struct sched_param sp = { .sched_priority = prio };

	return syscall(SYS_sched_setscheduler, pid, policy, &sp);
}

int main(int argc, char **argv)
{
	struct sched_param sp;
	const char *names[] = { "other", "fifo", "rr" };
	pid_t pid;
	int policy, prio = 0;

	if (argc < 2) {
		fprintf(stderr, "usage: rtprio PID [fifo|rr PRIO | other]\n");
		return 2;
	}
	pid = atoi(argv[1]);
	if (argc >= 3) {
		if (!strcmp(argv[2], "fifo") && argc == 4)
			policy = SCHED_FIFO, prio = atoi(argv[3]);
		else if (!strcmp(argv[2], "rr") && argc == 4)
			policy = SCHED_RR, prio = atoi(argv[3]);
		else if (!strcmp(argv[2], "other"))
			policy = SCHED_OTHER;
		else {
			fprintf(stderr, "usage: rtprio PID [fifo|rr PRIO | other]\n");
			return 2;
		}
		if (set_policy(pid, policy, prio)) {
			perror("sched_setscheduler");
			return 1;
		}
	}
	policy = get_policy(pid);
	if (policy < 0 || syscall(SYS_sched_getparam, pid, &sp)) {
		perror("sched_getscheduler");
		return 1;
	}
	printf("%d %s %d\n", pid, policy <= SCHED_RR ? names[policy] : "?",
	       sp.sched_priority);
	return 0;
}
