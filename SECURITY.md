# Security policy

## Supported code

Security fixes target the current default branch and the latest published semantic release, if a release exists. This
project doesn't promise an SLA or support window. Older immutable artifacts remain available for integrity and rollback
history, but may not receive fixes.

## Report a vulnerability

Use the repository's GitHub **Security** tab and its **Report a vulnerability** private vulnerability reporting flow. If
that button isn't available, open a detail-free public issue asking the maintainers to provide a private contact channel.
Don't include exploit details, reproduction steps, private searches, IP addresses, tokens, or other personal data in that
public issue. No project security email is published.

In a private report, include the affected version or commit, impact, reproduction steps using synthetic data, and a
suggested fix if available. Remove private searches, IP addresses, tokens, copyrighted payloads, and other personal data.

Don't disclose an exploitable issue in a public issue, discussion, pull request, or social post before maintainers have
had a reasonable chance to assess and fix it. Public reports are suitable for non-sensitive availability or
documentation problems only.

## Trust boundary

The extension code can see Hayase search metadata and make requests allowed by its manifest. It sends selected title
queries and release identifiers to AniLiberty as described in
[README.md](README.md#privacy-and-security). It doesn't provide anonymity, and BitTorrent peers can observe a user's IP
address independently of the extension.

Published bundles have SHA-256 checksums and GitHub build provenance. Verify both against the same release before
import. Integrity checks show whether bytes changed; they don't establish that the publisher or code is trustworthy.
