import { describe, expect, it } from 'vitest';
import { SHELL_COMMANDS, GIT_COMMANDS } from './commands';
import { LEVELS } from './levels';

/**
 * DECISIONS §12 の除外基準を機械的にチェックする禁止パターン。
 * 1 件でもマッチしたらそのコマンドはプールから除くべき。
 */
const FORBIDDEN_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  { name: 'rm (削除)', pattern: /(^|[\s;|&])rm(\s|$)/ },
  { name: 'mv (上書きの恐れ)', pattern: /(^|[\s;|&])mv(\s|$)/ },
  { name: 'リダイレクトによる上書き (>)', pattern: />/ },
  { name: 'truncate', pattern: /\btruncate\b/ },
  { name: 'sudo', pattern: /\bsudo\b/ },
  { name: 'curl | sh 系のネットワーク越し副作用', pattern: /curl[^|]*\|\s*(sh|bash)\b/ },
  { name: 'wget | bash 系のネットワーク越し副作用', pattern: /wget[^|]*\|\s*(sh|bash)\b/ },
  { name: 'git push --force', pattern: /git\s+push[^|]*(--force|-f\b)/ },
  { name: 'git reset --hard', pattern: /git\s+reset[^|]*--hard/ },
  { name: 'git clean -fd', pattern: /git\s+clean[^|]*-f\s*d|git\s+clean[^|]*-d\s*f/ },
  { name: 'git branch -D', pattern: /git\s+branch[^|]*-D\b/ },
  // レビュー r1 minor-1: 'cp .env.example .env' が既存 .env を無警告で上書きしていた。
  // cp 自体は安全な用途（新規コピー先）もあるため、-n/-i の安全フラグが無いまま
  // .env 系のドットファイルへコピーする形だけを狙い撃ちする。
  {
    name: 'cp による設定ファイルの無条件上書き (.env 等)',
    pattern: /\bcp\s+(?!.*-[a-zA-Z]*[ni]\b)[^|]*\s\.env(\.[\w-]+)?(\s|$)/,
  },
];

function expectNoForbiddenCommand(items: { text: string }[]) {
  for (const item of items) {
    for (const { name, pattern } of FORBIDDEN_PATTERNS) {
      expect(pattern.test(item.text), `"${item.text}" が除外基準 [${name}] に該当していない`).toBe(false);
    }
  }
}

describe('SHELL_COMMANDS', () => {
  it('30〜40 件である', () => {
    expect(SHELL_COMMANDS.length).toBeGreaterThanOrEqual(30);
    expect(SHELL_COMMANDS.length).toBeLessThanOrEqual(40);
  });

  it('全件に日本語 hint がある', () => {
    for (const item of SHELL_COMMANDS) {
      expect(item.hint, `"${item.text}" の hint`).toBeTruthy();
    }
  });

  it('除外基準に該当する危険コマンドを含まない (DECISIONS §12)', () => {
    expectNoForbiddenCommand(SHELL_COMMANDS);
  });

  it('設計書 §3.1 の例示コマンドを含む', () => {
    const texts = SHELL_COMMANDS.map((c) => c.text);
    expect(texts).toContain('ls -la');
    expect(texts).toContain('cd ../src');
    expect(texts).toContain('grep -rn "foo" .');
    expect(texts).toContain('chmod +x run.sh');
  });

  it('重複がない', () => {
    const texts = SHELL_COMMANDS.map((c) => c.text);
    expect(new Set(texts).size).toBe(texts.length);
  });
});

describe('GIT_COMMANDS', () => {
  it('30〜40 件である', () => {
    expect(GIT_COMMANDS.length).toBeGreaterThanOrEqual(30);
    expect(GIT_COMMANDS.length).toBeLessThanOrEqual(40);
  });

  it('全件に日本語 hint がある', () => {
    for (const item of GIT_COMMANDS) {
      expect(item.hint, `"${item.text}" の hint`).toBeTruthy();
    }
  });

  it('除外基準に該当する危険コマンドを含まない (DECISIONS §12)', () => {
    expectNoForbiddenCommand(GIT_COMMANDS);
  });

  it('設計書 §3.1 の例示コマンドを含む', () => {
    const texts = GIT_COMMANDS.map((c) => c.text);
    expect(texts).toContain('git commit -m "fix: typo"');
    expect(texts).toContain('git rebase -i HEAD~3');
    expect(texts).toContain('git push origin HEAD');
  });

  it('重複がない', () => {
    const texts = GIT_COMMANDS.map((c) => c.text);
    expect(new Set(texts).size).toBe(texts.length);
  });
});

describe('コマンド文字とレベル既習キーの整合性', () => {
  it('コマンド文字列の使用文字が Lv1〜Lv6 の既習文字集合の和に収まる（既知の例外を除く）', () => {
    // Lv1〜Lv6 の charset の和集合。Lv7/Lv8 は charset を持たない (fixedList) ため対象外。
    const practicedChars = new Set<string>();
    for (const level of LEVELS) {
      if (level.id <= 6 && level.charset) {
        for (const c of level.charset) practicedChars.add(c);
      }
    }

    const allTexts = [...SHELL_COMMANDS, ...GIT_COMMANDS].map((c) => c.text);
    const uncovered = new Set<string>();
    for (const text of allTexts) {
      for (const char of text) {
        if (!practicedChars.has(char)) uncovered.add(char);
      }
    }

    // 既知の例外:
    //   - ' ' (スペース): Lv1〜Lv6 のどの charset にも含まれないが、物理的にはスペースキー
    //     (親指) のみで押鍵位置に迷いがなく、コマンド中では単なる区切りとして頻出するため
    //     練習不要とみなす。
    //   - 'H' 'E' 'A' 'D': 設計書 §3.1 で必須とされる例示コマンド
    //     (git rebase -i HEAD~3 / git push origin HEAD 等) に含まれる大文字 "HEAD" 由来。
    //     Lv1〜Lv6 は大文字を一切練習しないため、Lv7/Lv8 で初めて大文字に触れることになる。
    //     これは意図された例示コマンドを削れないための既知のギャップとして報告する
    //     (README/REPORT 参照)。
    const knownExceptions = new Set([' ', 'H', 'E', 'A', 'D']);
    const unexpected = [...uncovered].filter((c) => !knownExceptions.has(c));

    expect(unexpected, `未知の未習得文字: ${JSON.stringify(unexpected)}`).toEqual([]);
  });
});

describe('DECISIONS §5 で Lv5 に追加した記号の Lv7/Lv8 での回収確認', () => {
  it('[ ] \\ \' がそれぞれ Lv7/Lv8 のコマンドに最低 1 件は出現する（レビュー r1 minor-2）', () => {
    // DECISIONS §5:「'...' クオートと \ エスケープは Lv7/Lv8 で頻出するため、
    // 到達前に単独練習を必ず 1 回踏ませる」という根拠が実データで回収されているかを保証する。
    const joined = [...SHELL_COMMANDS, ...GIT_COMMANDS].map((c) => c.text).join('\n');
    for (const char of ['[', ']', '\\', "'"]) {
      expect(joined.includes(char), `"${char}" を含むコマンドが少なくとも 1 件存在する`).toBe(true);
    }
  });
});
