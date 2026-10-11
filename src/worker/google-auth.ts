// OAuth2 access tokens for a Google service account, signed with WebCrypto (no Node SDK needed).

interface ServiceAccount {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

let cached: { token: string; exp: number; email: string } | null = null;

const b64url = (data: ArrayBuffer | string) => {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : new Uint8Array(data);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

async function importKey(pem: string): Promise<CryptoKey> {
  const body = pem.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, "").replace(/\\n|\s/g, "");
  const der = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
}

export async function googleAccessToken(serviceAccountJson: string, scope: string): Promise<string> {
  const sa = JSON.parse(serviceAccountJson) as ServiceAccount;
  const now = Math.floor(Date.now() / 1000);
  if (cached && cached.email === sa.client_email && cached.exp - 120 > now) return cached.token;

  const tokenUri = sa.token_uri ?? "https://oauth2.googleapis.com/token";
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(JSON.stringify({ iss: sa.client_email, scope, aud: tokenUri, iat: now, exp: now + 3600 }));
  const key = await importKey(sa.private_key);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${header}.${claims}`));
  const assertion = `${header}.${claims}.${b64url(sig)}`;

  const res = await fetch(tokenUri, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
  });
  if (!res.ok) throw new Error(`Google token exchange failed: ${res.status} ${await res.text()}`);
  const json = (await res.json()) as { access_token: string; expires_in: number };
  cached = { token: json.access_token, exp: now + json.expires_in, email: sa.client_email };
  return json.access_token;
}
