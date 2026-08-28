/**
 * Lv4「英単語」用の基礎英単語リスト（約 300 語）。
 *
 * 選定基準 (00-decisions.md §11 を機械的に適用):
 *   - すべて小文字の a-z のみ。記号・数字・大文字・アクセント記号を含まない
 *   - 長さ 3〜8 文字
 *   - 一般的な基礎語彙（file, data, code, make, have, open, list, time のような日常語）
 *   - 除外: 固有名詞、専門用語、スラング、攻撃的・差別的語彙、著作権のあるコーパスからの
 *     逐語コピー
 *   - 重複なし。アルファベット順に整理し可読性を保つ
 *
 * このファイルは src/data/levels.ts の generator: 'words' からは直接 import しない
 * （levels.ts は charset のみを持ち、生成器側 (t07 の generator.ts) が WORDS を参照して
 * level.charset に収まる語を抽出する方針。詳細は levels.ts 冒頭のコメント参照）。
 */

export const WORDS: string[] = [
  "able", "actor", "afraid", "ahead", "album", "allow", "alter", "ancient", "answer", "area",
  "arrive", "ask", "balance", "base", "battle", "bed", "belief", "bench", "beyond", "birth",
  "blame", "blood", "body", "bone", "border", "bottom", "boy", "brave", "bridge", "broken",
  "bulk", "bush", "camp", "captain", "career", "catch", "chair", "charge", "cheek", "choice",
  "civil", "click", "close", "coach", "code", "color", "core", "could", "crack", "credit",
  "crowd", "cry", "cute", "dark", "data", "debate", "defeat", "desert", "diary", "direct",
  "dock", "donor", "draft", "dream", "drive", "duty", "earn", "echo", "either", "enemy",
  "enough", "error", "even", "exam", "expect", "fade", "fall", "fancy", "fault", "feel",
  "field", "file", "fill", "finger", "fish", "flame", "flesh", "floor", "focus", "force",
  "fort", "frank", "front", "fund", "gap", "gaze", "ghost", "glad", "globe", "goat", "grade",
  "graph", "green", "gross", "guest", "habit", "hang", "haste", "have", "heart", "hello",
  "hide", "history", "holy", "hook", "hotel", "hunger", "idea", "inch", "inside", "issue",
  "jail", "join", "judge", "justice", "kick", "kit", "knight", "know", "lake", "last", "law",
  "leap", "left", "less", "liar", "lid", "limb", "list", "listen", "lobby", "long", "lose",
  "loyal", "machine", "make", "male", "mark", "match", "meat", "melon", "menu", "metal",
  "might", "mini", "mix", "model", "moral", "motor", "movie", "myth", "native", "needle",
  "next", "noon", "now", "oath", "ocean", "older", "onto", "open", "ounce", "oval", "pack",
  "panel", "park", "past", "peace", "pen", "period", "photo", "pile", "pipe", "plain", "play",
  "plot", "point", "police", "poor", "post", "praise", "primary", "probe", "pull", "puppy",
  "queen", "quiet", "race", "rain", "rapid", "reach", "reason", "refer", "relief", "rent",
  "rescue", "result", "review", "ride", "ring", "river", "rocket", "room", "rough", "rule",
  "rust", "salt", "scan", "scope", "seal", "secret", "seek", "send", "setup", "shame", "shelf",
  "shirt", "short", "show", "side", "silly", "single", "skate", "skull", "slide", "slot",
  "smell", "snap", "social", "solid", "sorry", "source", "speak", "spice", "split", "spray",
  "staff", "stamp", "state", "steel", "sting", "store", "stray", "sugar", "supply", "swing",
  "tale", "tape", "tax", "teen", "tent", "theme", "think", "throw", "tight", "time", "title",
  "token", "topic", "tour", "toy", "train", "trick", "truck", "tube", "twin", "union", "upper",
  "used", "vague", "vapor", "velvet", "very", "villa", "vital", "vote", "wait", "warm", "wave",
  "weave", "weigh", "wheel", "width", "wind", "wise", "wool", "worth", "wrist", "yeast",
  "youth",
];
