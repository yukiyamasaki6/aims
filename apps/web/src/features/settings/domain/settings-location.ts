// 設定パネルの表示とURLのハッシュの対応、ブラウザの履歴に積む状態の規則。
// 表示はハッシュだけから決める。パネルが積む履歴の項目は、起点からの段数と、積んだ文書の識別子を状態に持つ。
import {
  CHANGE_EMAIL_HASH,
  CHANGE_PASSWORD_HASH,
  DELETE_ACCOUNT_HASH,
  SETTINGS_ACCOUNT_HASH,
  SETTINGS_HASH,
} from "@/routes";

// 項目の画面の表示。
export type SettingsItemView = "email" | "password" | "delete-account";

// 設定パネルの表示。分類「アカウント」か、その項目の画面。
export type SettingsView = "account" | SettingsItemView;

const HASH_OF_VIEW: Record<SettingsView, string> = {
  account: SETTINGS_ACCOUNT_HASH,
  email: CHANGE_EMAIL_HASH,
  password: CHANGE_PASSWORD_HASH,
  "delete-account": DELETE_ACCOUNT_HASH,
};

// ハッシュが表す設定パネルの表示。
// view: 開く表示。閉じているときはnull。
// normalize: ハッシュを表示のハッシュへ書き換える要否(`#settings`、`#settings/`で始まる存在しない分類・項目)。
export type SettingsLocation = {
  view: SettingsView | null;
  normalize: boolean;
};

const CLOSED: SettingsLocation = { view: null, normalize: false };

// ハッシュ(`location.hash`の形。無いときは空文字)から表示を返す。
// `#settings`でも`#settings/`で始まるものでもないハッシュ(`#settingsfoo`など)は閉じている。
export function settingsLocationOf(hash: string): SettingsLocation {
  if (hash !== SETTINGS_HASH && !hash.startsWith(`${SETTINGS_HASH}/`))
    return CLOSED;
  const view = (Object.keys(HASH_OF_VIEW) as SettingsView[]).find(
    (candidate) => HASH_OF_VIEW[candidate] === hash,
  );
  return view === undefined
    ? { view: "account", normalize: true }
    : { view, normalize: false };
}

// 表示のハッシュ。
export function settingsHashOf(view: SettingsView): string {
  return HASH_OF_VIEW[view];
}

// パネルが積む履歴の項目の状態。depth: 起点からの段数(1以上)。documentId: 積んだ文書の識別子。
export type SettingsHistoryState = {
  settingsDepth: number;
  settingsDocumentId: string;
};

// 履歴の項目の起点からの段数。この文書が積んでいない項目(読み込み時の項目、アドレス欄でハッシュを書き換えた項目、前の文書が積んだ項目)は0。
// state: 今の`history.state`。documentId: 今の文書の識別子。
export function settingsDepthOf(state: unknown, documentId: string): number {
  if (typeof state !== "object" || state === null) return 0;
  const { settingsDepth, settingsDocumentId } = state as Partial<
    Record<keyof SettingsHistoryState, unknown>
  >;
  if (settingsDocumentId !== documentId) return 0;
  return typeof settingsDepth === "number" &&
    Number.isInteger(settingsDepth) &&
    settingsDepth > 0
    ? settingsDepth
    : 0;
}

// 積む項目の状態。自分の値だけを持つ新しいオブジェクトを返す(Next.jsの内部の印を持つ今の状態を渡すと、Next.jsが取り込まないため)。
export function settingsHistoryStateOf(
  depth: number,
  documentId: string,
): SettingsHistoryState {
  return { settingsDepth: depth, settingsDocumentId: documentId };
}
