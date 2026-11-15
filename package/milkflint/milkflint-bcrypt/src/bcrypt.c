/* bcrypt: a bcrypt password hash, as AdGuard Home keeps its users' passwords
 * (golang.org/x/crypto/bcrypt accepts $2a$, $2b$ and $2y$). musl's crypt()
 * implements bcrypt; busybox's mkpasswd/cryptpw don't offer it.
 *
 *   bcrypt              read a password (one line) on stdin, print its hash
 *                       (cost 10, AdGuard Home's own, random salt)
 *   bcrypt check HASH   read a password on stdin: exit 0 if it matches HASH
 *
 * The password comes on stdin, never as an argument (which any user can read
 * in /proc). bcrypt uses at most 72 bytes of it; longer ones are refused, as
 * golang.org/x/crypto/bcrypt refuses them.
 *
 * SPDX-License-Identifier: MIT
 */
#include <crypt.h>
#include <fcntl.h>
#include <stdio.h>
#include <string.h>
#include <unistd.h>

#define COST "10"
#define MAX_PASSWORD 72

/* bcrypt's base64 alphabet */
static const char b64[] = "./ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

/* 16 bytes of salt as bcrypt writes them: 22 characters */
static void encode_salt(const unsigned char *in, char *out)
{
	int i = 0, o = 0;

	while (i < 16) {
		unsigned c1 = in[i++], c2;

		out[o++] = b64[c1 >> 2];
		c1 = (c1 & 0x03) << 4;
		if (i >= 16) {
			out[o++] = b64[c1];
			break;
		}
		c2 = in[i++];
		c1 |= c2 >> 4;
		out[o++] = b64[c1];
		c1 = (c2 & 0x0f) << 2;
		if (i >= 16) {
			out[o++] = b64[c1];
			break;
		}
		c2 = in[i++];
		c1 |= c2 >> 6;
		out[o++] = b64[c1];
		out[o++] = b64[c2 & 0x3f];
	}
	out[o] = '\0';
}

static int read_password(char *buf, size_t size)
{
	size_t n;

	if (!fgets(buf, size, stdin))
		return -1;
	n = strlen(buf);
	if (n > 0 && buf[n - 1] == '\n')
		buf[--n] = '\0';
	else if (!feof(stdin))
		return -1; /* longer than the buffer */
	if (n > 0 && buf[n - 1] == '\r')
		buf[--n] = '\0';
	if (n == 0 || n > MAX_PASSWORD)
		return -1;
	return 0;
}

int main(int argc, char **argv)
{
	char password[MAX_PASSWORD + 3];
	unsigned char raw[16];
	char setting[7 + 22 + 1] = "$2b$" COST "$";
	const char *hash;
	int fd;

	if (read_password(password, sizeof(password)) < 0) {
		fprintf(stderr, "bcrypt: a password of 1 to %d bytes on one line\n", MAX_PASSWORD);
		return 2;
	}

	if (argc == 3 && strcmp(argv[1], "check") == 0) {
		hash = crypt(password, argv[2]);
		memset(password, 0, sizeof(password));
		return hash && hash[0] == '$' && strcmp(hash, argv[2]) == 0 ? 0 : 1;
	}
	if (argc != 1) {
		fprintf(stderr, "usage: bcrypt [check HASH] < password\n");
		return 2;
	}

	fd = open("/dev/urandom", O_RDONLY);
	if (fd < 0 || read(fd, raw, sizeof(raw)) != (ssize_t)sizeof(raw)) {
		fprintf(stderr, "bcrypt: no random salt\n");
		return 1;
	}
	close(fd);
	encode_salt(raw, setting + 7);

	hash = crypt(password, setting);
	memset(password, 0, sizeof(password));
	/* a failed crypt() gives NULL or a string that isn't a hash ("*0") */
	if (!hash || strncmp(hash, "$2b$" COST "$", 7) != 0 || strlen(hash) != 60) {
		fprintf(stderr, "bcrypt: this libc's crypt() has no bcrypt\n");
		return 1;
	}
	puts(hash);
	return 0;
}
