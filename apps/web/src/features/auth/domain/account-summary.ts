// アカウントの概要。設定の「メールアドレス」「Google認証」の行が示す値で、端末に記録して、オフラインでアクセストークンが切れていても表示する。

// 行に示すGoogleの手段。
export type GoogleIdentity = {
  // 認証サービスの手段のID(解除に使う)。
  readonly id: string;
  // Googleアカウントのメールアドレス。読めないときはnull。
  readonly email: string | null;
};

export type AccountSummary = {
  readonly userId: string;
  // アカウントのメールアドレス。読めないときはnull。
  readonly email: string | null;
  // 行に示すGoogleの手段。結び付いていなければnull。
  readonly google: GoogleIdentity | null;
};

// 認証サービスの手段の最小の形。
export type IdentityRecord = {
  readonly id: string;
  readonly provider: string;
  readonly email: string | null;
  // 作成の時刻(ISO 8601)。読めないときはnull。
  readonly createdAt: string | null;
};

// 行に示すGoogleの手段を選ぶ。直接の呼び出しで複数が結び付いていても、作成の最も古い1つを示す(作成の時刻が読めないものは後ろ)。
export function googleIdentityOf(
  identities: readonly IdentityRecord[],
): GoogleIdentity | null {
  const time = (identity: IdentityRecord) =>
    identity.createdAt === null
      ? Number.POSITIVE_INFINITY
      : Date.parse(identity.createdAt);
  const oldest = identities
    .filter((identity) => identity.provider === "google")
    .sort((a, b) => time(a) - time(b))[0];
  return oldest ? { id: oldest.id, email: oldest.email } : null;
}
