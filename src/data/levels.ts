import type { LevelDef, LevelId } from '../storage/schema';
import { SHELL_COMMANDS, GIT_COMMANDS } from './commands';

// このファイルは Lv7/Lv8 の items を組み立てるため src/data/commands.ts を import する。
// 一方 src/data/words.ts (WORDS) はここでは import しない。Lv4 は charset（全英字）
// だけを持たせ、「charset に収まる単語の抽出」は問題生成器 (t07 の src/engine/generator.ts)
// の責務とする方針にしたため。levels.ts はあくまで静的なカリキュラム定義に留める。

const LOWER_ALPHA = 'abcdefghijklmnopqrstuvwxyz'.split('');

/**
 * 全 8 レベルのカリキュラム定義 (docs/design.md §3.1)。
 *
 * charset / defaultGuideMode に関する意図的な設計書からの逸脱は以下 2 点
 * (00-decisions.md §4 / §5 で確定済み。設計書より DECISIONS を優先する):
 *   - Lv3: 「出題内容: 全英字ランダム」は設計書の表記ミスと確定。charset は
 *     英字 26 文字すべて（ホーム段＋上段＋下段）＋ `,` `.` `/` とする。
 *   - Lv5: Shift 不要の基本記号を Lv5 までに全部潰す方針のため、`[` `]` `\` `'`
 *     を追加する（`'` と `\` は Lv7/Lv8 のコマンドで頻出するため事前に単独練習させる）。
 * Lv6 の記号一覧は設計書 §3.1 のまま変更しない。
 */
export const LEVELS: LevelDef[] = [
  {
    id: 1,
    name: 'ホームポジション',
    description: 'ホームポジション（a s d f / j k l ; / g h）の位置を指に覚え込ませる',
    charset: ['a', 's', 'd', 'f', 'j', 'k', 'l', ';', 'g', 'h'],
    generator: 'randomChars',
    questionCount: 20,
    passAccuracy: 0.97,
    passKpm: 60,
    defaultGuideMode: 'always',
  },
  {
    id: 2,
    name: '上段',
    description: 'ホームポジションに上段（q w e r t / y u i o p）を加えた混合練習',
    charset: [
      'a', 's', 'd', 'f', 'j', 'k', 'l', ';', 'g', 'h',
      'q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p',
    ],
    generator: 'randomChars',
    questionCount: 20,
    passAccuracy: 0.96,
    passKpm: 70,
    defaultGuideMode: 'always',
  },
  {
    id: 3,
    name: '下段',
    // DECISIONS §4: 英字 26 文字すべて（ホーム段＋上段＋下段）＋ , . /
    description: '下段（z x c v b / n m , . /）を含む、これまでの全習得キー＋下段記号のランダム練習',
    charset: [...LOWER_ALPHA, ',', '.', '/'],
    generator: 'randomChars',
    questionCount: 20,
    passAccuracy: 0.96,
    passKpm: 80,
    defaultGuideMode: 'always',
  },
  {
    id: 4,
    name: '英単語',
    description: '全英字を使った短い英単語（3〜8 文字）の練習',
    charset: [...LOWER_ALPHA],
    generator: 'words',
    questionCount: 20,
    passAccuracy: 0.96,
    passKpm: 100,
    defaultGuideMode: 'onMiss',
  },
  {
    id: 5,
    name: '数字と基本記号',
    // DECISIONS §5: 0-9 - = / . , ; に加えて [ ] \ ' を追加
    description: '数字とハイフン・イコールなど Shift 不要の基本記号（角括弧・バックスラッシュ・シングルクオートを含む）の練習',
    charset: [
      '0', '1', '2', '3', '4', '5', '6', '7', '8', '9',
      '-', '=', '/', '.', ',', ';', '[', ']', '\\', "'",
    ],
    generator: 'randomChars',
    questionCount: 20,
    passAccuracy: 0.95,
    passKpm: 100,
    defaultGuideMode: 'onMiss',
  },
  {
    id: 6,
    name: 'Shift ＆ シェル記号',
    // 設計書 §3.1 のまま変更しない
    description: 'Shift を使う記号単体〜2 文字の組み合わせ練習',
    charset: [
      '~', '!', '@', '#', '$', '%', '^', '&', '*', '(', ')',
      '_', '+', '{', '}', '|', ':', '"', '<', '>', '?',
    ],
    generator: 'randomChars',
    questionCount: 20,
    passAccuracy: 0.94,
    passKpm: 90,
    defaultGuideMode: 'onMiss',
  },
  {
    id: 7,
    name: '実践 Shell',
    description: 'これまでの全習得キーを使った実務シェルコマンドの練習',
    items: SHELL_COMMANDS,
    generator: 'fixedList',
    questionCount: 20,
    passAccuracy: 0.95,
    passKpm: 130,
    defaultGuideMode: 'never',
  },
  {
    id: 8,
    name: '実践 Git',
    description: 'これまでの全習得キーを使った実務 Git コマンドの練習',
    items: GIT_COMMANDS,
    generator: 'fixedList',
    questionCount: 20,
    passAccuracy: 0.95,
    passKpm: 150,
    defaultGuideMode: 'never',
  },
];

/** 指定した id のレベル定義を取得する。存在しない id が来ることは型上あり得ないが、防御的に例外を投げる。 */
export function getLevel(id: LevelId): LevelDef {
  const level = LEVELS.find((l) => l.id === id);
  if (!level) {
    throw new Error(`Unknown level id: ${String(id)}`);
  }
  return level;
}
