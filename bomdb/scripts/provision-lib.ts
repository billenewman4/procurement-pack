// URL construction for provisioned users, split from provision-user.ts for
// testability. Supabase's direct host is IPv6-only — hosted servers (Cloud
// Run egress is IPv4) and many home networks need the pooler form, whose
// username is <role>.<project-ref>.

/** Supabase project ref from either host form, or null if not Supabase. */
export function projectRef(masterUrl: string): string | null {
  const u = new URL(masterUrl);
  const direct = u.hostname.match(/^db\.([a-z0-9]+)\.supabase\.co$/);
  if (direct) return direct[1];
  if (/\.pooler\.supabase\.com$/.test(u.hostname)) {
    const dot = u.username.indexOf('.');
    return dot === -1 ? null : u.username.slice(dot + 1);
  }
  return null;
}

export function connectionUrls(
  masterUrl: string,
  role: string,
  password: string,
): { direct: string; pooler: string | null } {
  const master = new URL(masterUrl);
  const ref = projectRef(masterUrl);
  if (!ref) {
    const url = new URL(masterUrl);
    url.username = role;
    url.password = password;
    return { direct: url.toString(), pooler: null };
  }
  const direct = new URL(masterUrl);
  direct.hostname = `db.${ref}.supabase.co`;
  direct.username = role;
  direct.password = password;
  const pooler = new URL(masterUrl);
  // The region-qualified pooler host isn't derivable from the direct form;
  // reuse the master's when it is one, else our project's region.
  pooler.hostname = /\.pooler\.supabase\.com$/.test(master.hostname)
    ? master.hostname
    : 'aws-0-us-west-1.pooler.supabase.com';
  pooler.username = `${role}.${ref}`;
  pooler.password = password;
  return { direct: direct.toString(), pooler: pooler.toString() };
}
