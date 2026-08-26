/**
 * US 配列キーボードの共有データ（レイアウト・運指・Shift 逆引き）。
 *
 * 画面内キーボード描画（t11）・キー入力フック（t09）・統計のキー別ヒートマップ（t17）の
 * 3 方向から参照される。将来の JIS 対応を安く残すため、レイアウトは行×キーの
 * 純粋なデータ（KEYBOARD_ROWS）として定義し、React や DOM には一切依存しない。
 *
 * 参照元:
 *   - docs/design.md §3.4（次キー/Shift ハイライト）
 *   - docs/design.md §3.5（運指ガイド・担当キー表）
 *   - docs/design.md §4（アクセシビリティ: 色だけに依存しない）
 *   - docs/design.md §5.3（練習画面の配列ワイヤーフレーム）
 *   - .claude/epics/typing-app/00-decisions.md §3（theme.css は CSS 変数専用）
 */

/** US 配列の運指区分。左右 4 指ずつ＋親指（Space 専用）の 9 分類。 */
export type Finger =
  | 'lPinky'
  | 'lRing'
  | 'lMiddle'
  | 'lIndex'
  | 'rIndex'
  | 'rMiddle'
  | 'rRing'
  | 'rPinky'
  | 'thumb';

/** 1 キーの定義。 */
export interface KeyDef {
  /** キーの一意な id（`Keyboard` コンポーネントの React key やハイライト対象の指定に使う） */
  id: string;
  /** 画面表示用ラベル（記号キーは unshifted 面を表示するのが基本） */
  label: string;
  /** Shift なしで入力される文字。Tab/CapsLock/Enter/Shift/Backspace など文字を持たないキーは undefined */
  unshifted?: string;
  /** Shift ありで入力される文字。Shift で意味を持たないキー（英数字以外の一部）は undefined */
  shifted?: string;
  /** 担当指 */
  finger: Finger;
  /** 標準キー幅を 1 とした相対幅。省略時は 1 として扱う */
  width?: number;
  /** 文字を持たない特殊キー（Tab/CapsLock/Enter/Shift/Backspace）なら true */
  special?: boolean;
}

/** 指の日本語ラベル。色だけに依存しないアクセシビリティ要件 (design.md §4) を満たすため必須で持たせる。 */
export const FINGER_LABELS: Record<Finger, string> = {
  lPinky: '左小指',
  lRing: '左薬指',
  lMiddle: '左中指',
  lIndex: '左人差指',
  rIndex: '右人差指',
  rMiddle: '右中指',
  rRing: '右薬指',
  rPinky: '右小指',
  thumb: '親指',
};

/**
 * 指ごとの色を表す theme.css の CSS 変数名（値そのものは持たない）。
 * theme.css は t01 で確定済みのため、ここでは参照名のみを保持する (DECISIONS §3)。
 */
export const FINGER_COLOR_VARS: Record<Finger, string> = {
  lPinky: '--finger-l-pinky',
  lRing: '--finger-l-ring',
  lMiddle: '--finger-l-middle',
  lIndex: '--finger-l-index',
  rIndex: '--finger-r-index',
  rMiddle: '--finger-r-middle',
  rRing: '--finger-r-ring',
  rPinky: '--finger-r-pinky',
  thumb: '--finger-thumb',
};

/**
 * US 配列キーボード。数字段・上段・ホーム段・下段・スペース段の 5 行 (design.md §5.3)。
 * 運指の割当ては design.md §3.5 の表に厳密に従う。
 *
 * 表に明記のない Backspace の担当指は、標準的なタッチタイピングの慣習
 * （`=` の右隣で右手小指が担当）に倣い rPinky とした（design.md §3.5 は範囲外）。
 */
export const KEYBOARD_ROWS: KeyDef[][] = [
  // 数字段
  [
    { id: 'backquote', label: '`', unshifted: '`', shifted: '~', finger: 'lPinky' },
    { id: 'digit1', label: '1', unshifted: '1', shifted: '!', finger: 'lPinky' },
    { id: 'digit2', label: '2', unshifted: '2', shifted: '@', finger: 'lRing' },
    { id: 'digit3', label: '3', unshifted: '3', shifted: '#', finger: 'lMiddle' },
    { id: 'digit4', label: '4', unshifted: '4', shifted: '$', finger: 'lIndex' },
    { id: 'digit5', label: '5', unshifted: '5', shifted: '%', finger: 'lIndex' },
    { id: 'digit6', label: '6', unshifted: '6', shifted: '^', finger: 'rIndex' },
    { id: 'digit7', label: '7', unshifted: '7', shifted: '&', finger: 'rIndex' },
    { id: 'digit8', label: '8', unshifted: '8', shifted: '*', finger: 'rMiddle' },
    { id: 'digit9', label: '9', unshifted: '9', shifted: '(', finger: 'rRing' },
    { id: 'digit0', label: '0', unshifted: '0', shifted: ')', finger: 'rPinky' },
    { id: 'minus', label: '-', unshifted: '-', shifted: '_', finger: 'rPinky' },
    { id: 'equal', label: '=', unshifted: '=', shifted: '+', finger: 'rPinky' },
    { id: 'backspace', label: 'Backspace', finger: 'rPinky', width: 2, special: true },
  ],
  // 上段
  [
    { id: 'tab', label: 'Tab', finger: 'lPinky', width: 1.5, special: true },
    { id: 'q', label: 'q', unshifted: 'q', shifted: 'Q', finger: 'lPinky' },
    { id: 'w', label: 'w', unshifted: 'w', shifted: 'W', finger: 'lRing' },
    { id: 'e', label: 'e', unshifted: 'e', shifted: 'E', finger: 'lMiddle' },
    { id: 'r', label: 'r', unshifted: 'r', shifted: 'R', finger: 'lIndex' },
    { id: 't', label: 't', unshifted: 't', shifted: 'T', finger: 'lIndex' },
    { id: 'y', label: 'y', unshifted: 'y', shifted: 'Y', finger: 'rIndex' },
    { id: 'u', label: 'u', unshifted: 'u', shifted: 'U', finger: 'rIndex' },
    { id: 'i', label: 'i', unshifted: 'i', shifted: 'I', finger: 'rMiddle' },
    { id: 'o', label: 'o', unshifted: 'o', shifted: 'O', finger: 'rRing' },
    { id: 'p', label: 'p', unshifted: 'p', shifted: 'P', finger: 'rPinky' },
    { id: 'bracketLeft', label: '[', unshifted: '[', shifted: '{', finger: 'rPinky' },
    { id: 'bracketRight', label: ']', unshifted: ']', shifted: '}', finger: 'rPinky' },
    { id: 'backslash', label: '\\', unshifted: '\\', shifted: '|', finger: 'rPinky', width: 1.5 },
  ],
  // ホーム段
  [
    { id: 'capsLock', label: 'CapsLock', finger: 'lPinky', width: 1.75, special: true },
    { id: 'a', label: 'a', unshifted: 'a', shifted: 'A', finger: 'lPinky' },
    { id: 's', label: 's', unshifted: 's', shifted: 'S', finger: 'lRing' },
    { id: 'd', label: 'd', unshifted: 'd', shifted: 'D', finger: 'lMiddle' },
    { id: 'f', label: 'f', unshifted: 'f', shifted: 'F', finger: 'lIndex' },
    { id: 'g', label: 'g', unshifted: 'g', shifted: 'G', finger: 'lIndex' },
    { id: 'h', label: 'h', unshifted: 'h', shifted: 'H', finger: 'rIndex' },
    { id: 'j', label: 'j', unshifted: 'j', shifted: 'J', finger: 'rIndex' },
    { id: 'k', label: 'k', unshifted: 'k', shifted: 'K', finger: 'rMiddle' },
    { id: 'l', label: 'l', unshifted: 'l', shifted: 'L', finger: 'rRing' },
    { id: 'semicolon', label: ';', unshifted: ';', shifted: ':', finger: 'rPinky' },
    { id: 'quote', label: "'", unshifted: "'", shifted: '"', finger: 'rPinky' },
    { id: 'enter', label: 'Enter', finger: 'rPinky', width: 2.25, special: true },
  ],
  // 下段
  [
    { id: 'shiftLeft', label: 'Shift', finger: 'lPinky', width: 2.25, special: true },
    { id: 'z', label: 'z', unshifted: 'z', shifted: 'Z', finger: 'lPinky' },
    { id: 'x', label: 'x', unshifted: 'x', shifted: 'X', finger: 'lRing' },
    { id: 'c', label: 'c', unshifted: 'c', shifted: 'C', finger: 'lMiddle' },
    { id: 'v', label: 'v', unshifted: 'v', shifted: 'V', finger: 'lIndex' },
    { id: 'b', label: 'b', unshifted: 'b', shifted: 'B', finger: 'lIndex' },
    { id: 'n', label: 'n', unshifted: 'n', shifted: 'N', finger: 'rIndex' },
    { id: 'm', label: 'm', unshifted: 'm', shifted: 'M', finger: 'rIndex' },
    { id: 'comma', label: ',', unshifted: ',', shifted: '<', finger: 'rMiddle' },
    { id: 'period', label: '.', unshifted: '.', shifted: '>', finger: 'rRing' },
    { id: 'slash', label: '/', unshifted: '/', shifted: '?', finger: 'rPinky' },
    { id: 'shiftRight', label: 'Shift', finger: 'rPinky', width: 2.75, special: true },
  ],
  // スペース段
  [{ id: 'space', label: 'Space', unshifted: ' ', finger: 'thumb', width: 6.25 }],
];

/** 全キーをフラットにした配列（逆引きテーブル構築・網羅チェックに使う） */
export const ALL_KEYS: readonly KeyDef[] = KEYBOARD_ROWS.flat();

/** 左右どちらの Shift キーかを表す id。KEYBOARD_ROWS 内の 'shiftLeft' / 'shiftRight' の id と対応する。 */
export type ShiftKeyId = 'shiftLeft' | 'shiftRight';

/** findKeyForChar の返り値。 */
export interface CharKeyMatch {
  /** 対象文字が乗っている物理キー */
  key: KeyDef;
  /** Shift を押す必要があるか */
  needsShift: boolean;
  /** Shift が必要な場合にハイライトすべき Shift キー id。不要な場合は null */
  shiftKeyId: ShiftKeyId | null;
}

/**
 * 「対象キーと反対の手」ルール (design.md §3.4) を機械的に導出する。
 *
 * アルゴリズム:
 *   1. 対象キーの finger を見る。finger 名は 'l'（左手）/ 'r'（右手）で始まる命名にしてあるため、
 *      先頭 1 文字だけで担当手を判定できる。
 *   2. finger が 'l' で始まる（左手担当キー）なら、反対の手である右 Shift ('shiftRight') を返す。
 *      finger が 'r' で始まる（右手担当キー）なら、反対の手である左 Shift ('shiftLeft') を返す。
 *   3. finger が 'thumb'（Space。Shift を伴う文字は存在しない）の場合は null を返す。
 *
 * 例: '|' は backslash キー（finger: 'rPinky'、右手）に乗っているので、反対の手である
 *     shiftLeft を返す。'!' は digit1 キー（finger: 'lPinky'、左手）に乗っているので、
 *     反対の手である shiftRight を返す。
 */
function oppositeHandShiftKeyId(finger: Finger): ShiftKeyId | null {
  if (finger === 'thumb') return null;
  return finger.startsWith('l') ? 'shiftRight' : 'shiftLeft';
}

/**
 * field（'unshifted' | 'shifted'）の文字 → KeyDef の逆引きテーブルを構築する。
 * 同じ文字が 2 つの異なるキーに割り当てられている場合はデータ不整合としてロード時に例外を投げる。
 */
function buildCharKeyMap(field: 'unshifted' | 'shifted'): ReadonlyMap<string, KeyDef> {
  const map = new Map<string, KeyDef>();
  for (const key of ALL_KEYS) {
    const char = key[field];
    if (char === undefined) continue;
    const existing = map.get(char);
    if (existing !== undefined) {
      throw new Error(
        `keyboardUs: 文字 ${JSON.stringify(char)} が ${field} として ${existing.id} と ${key.id} の` +
          ' 2 つのキーに重複して割り当てられています',
      );
    }
    map.set(char, key);
  }
  return map;
}

const UNSHIFTED_CHAR_MAP = buildCharKeyMap('unshifted');
const SHIFTED_CHAR_MAP = buildCharKeyMap('shifted');

/**
 * 任意の 1 文字から、対応する物理キー・Shift の要否・ハイライトすべき Shift キーを引く。
 * t09（キー入力フック）・t11（画面内キーボード UI）が「次に押すべき文字」の解決に使う。
 *
 * - unshifted 面に一致する文字があれば needsShift: false で即返す。
 * - なければ shifted 面を探し、見つかれば needsShift: true と、
 *   反対の手の Shift キー id (oppositeHandShiftKeyId 参照) を返す。
 * - どちらにも無ければ null（US 配列で入力不可能な文字。呼び出し側で無視する想定）。
 *
 * スペースは unshifted: ' ' として space キー（finger: 'thumb'）に定義されているため、
 * needsShift: false, shiftKeyId: null で解決できる。
 */
export function findKeyForChar(char: string): CharKeyMatch | null {
  const unshiftedKey = UNSHIFTED_CHAR_MAP.get(char);
  if (unshiftedKey) {
    return { key: unshiftedKey, needsShift: false, shiftKeyId: null };
  }

  const shiftedKey = SHIFTED_CHAR_MAP.get(char);
  if (shiftedKey) {
    return {
      key: shiftedKey,
      needsShift: true,
      shiftKeyId: oppositeHandShiftKeyId(shiftedKey.finger),
    };
  }

  return null;
}
