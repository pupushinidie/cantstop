/**
 * 新手教程的剧本（欲罢不能）。
 *
 * 教程在浏览器里直接跑规则引擎，不连服务器：骰子按 TUTORIAL_DICE 出，对手按剧本走，
 * 所以「对手贪心爆掉」这种关键一幕一定会发生。剧本走完接一局练习：对手交给人机，骰子换成普通随机数。
 *
 * 每一步写三件事：咕噜嘎说什么（say / note）、高亮哪个元素（anchor，对应网页里的 data-tut="…"）、
 * 等玩家做什么（do 步骤的 expect）。改了规则或界面，tutorial.test.ts 会检查剧本还能不能从头走到尾。
 */
import { COLUMN_HEIGHTS, type Column } from "./board.js";
import { createGame } from "./engine.js";
import { createRng, type Rng } from "./rng.js";
import type { GameCommand, GameState } from "./types.js";

/** 咕噜嘎的表情。 */
export type TutorialFace = "base" | "happy" | "surprised" | "think";

interface StepBase {
  readonly id: string;
  /** 侧栏「新手教程」进度里这一课叫什么；没有就不单独列。 */
  readonly lesson?: string;
  /** 主句（24px），一句话说清这一步。 */
  readonly say: string;
  /** 补充说明（12px）。 */
  readonly note?: string;
  /** 触屏设备上换成这句说明（比如「鼠标停在选项上」在手机上不成立）。 */
  readonly noteTouch?: string;
  /**
   * 高亮哪个元素：网页里 data-tut 的值。
   * 固定的有 mountain、dice、roll、stop、odds、players；选项是 option:<和>+<和>（如 option:7+7），
   * 本回合的登山者是 runner:<路号>。
   */
  readonly anchor?: string;
  readonly face?: TutorialFace;
}

export type TutorialStep =
  /** 讲解：玩家点「下一步」继续。finale 是最后一步（接练习局或结束）。 */
  | (StepBase & { readonly kind: "info"; readonly finale?: boolean })
  /** 等玩家做这一步；做别的会被拦下。 */
  | (StepBase & { readonly kind: "do"; readonly expect: GameCommand })
  /** 对手按剧本自动走这几步，牌桌不压暗。 */
  | (StepBase & { readonly kind: "watch"; readonly moves: readonly GameCommand[] });

export const TUTORIAL_SELF = "p1";
export const TUTORIAL_RIVAL = "p2";
export const TUTORIAL_RIVAL_NAME = "咕噜一号";

export const TUTORIAL_STEPS: readonly TutorialStep[] = [
  {
    kind: "info", id: "mountain", lesson: "山和目标", anchor: "mountain",
    say: "这座山有 11 条路，编号 2 到 12。",
    note: "先占领 3 条路（爬到路顶）的人获胜。7 最容易掷出，所以 7 号路最长；2 号和 12 号最短。",
  },
  { kind: "do", id: "roll", lesson: "掷骰", anchor: "roll", expect: { type: "ROLL" }, say: "点「掷骰」，一次掷 4 颗骰子。" },
  {
    kind: "do", id: "pair", lesson: "两两分组选路", anchor: "option:7+7", expect: { type: "CHOOSE", sums: [7, 7] },
    say: "4 颗骰子两两一组，每组的和就是要爬的路。",
    note: "选「7 走两步」：两组都是 7，7 号路一口气爬 2 格。鼠标停在选项上，山上会先预览。",
    noteTouch: "选「7 走两步」：两组都是 7，7 号路一口气爬 2 格。",
  },
  {
    kind: "info", id: "runner", lesson: "登山者是临时的", anchor: "runner:7", face: "think",
    say: "这是你的登山者，它的位置还没存下来。",
    note: "回合结束前要「收手扎营」才算数，不然全部作废。",
  },
  { kind: "do", id: "again", lesson: "再掷", anchor: "roll", expect: { type: "ROLL" }, say: "可以接着掷，也可以收手。先点「再掷」。" },
  {
    kind: "do", id: "three", lesson: "最多 3 个登山者", anchor: "option:6+8", expect: { type: "CHOOSE", sums: [6, 8] },
    say: "选「走 6 和 8」。",
    note: "你一共只有 3 个登山者，现在全派出去了：这回合接下来只能在 6、7、8 号路上爬。",
  },
  {
    kind: "info", id: "odds", lesson: "爆掉的风险", anchor: "odds", face: "think",
    say: "再掷时凑不出 6、7、8，就会「爆掉」。",
    note: "爆掉 = 这回合爬的全部作废。这里一直显示再掷爆掉的概率。",
  },
  {
    kind: "do", id: "stop", lesson: "收手扎营", anchor: "stop", expect: { type: "STOP" },
    say: "见好就收：点「收手扎营」。",
    note: "登山者的位置变成营地小旗，下回合从这里接着爬。",
  },
  {
    kind: "watch", id: "rival", lesson: "看对手冒险",
    say: "轮到咕噜一号了，看看它怎么走。",
    moves: [{ type: "ROLL" }, { type: "CHOOSE", sums: [4, 6] }, { type: "ROLL" }, { type: "CHOOSE", sums: [10, 10] }, { type: "ROLL" }],
  },
  {
    kind: "info", id: "bust", anchor: "dice", face: "surprised",
    say: "咕噜一号太贪心，爆掉了！",
    note: "它掷出 1、1、2、6，凑不出正在爬的 4、6、10 号路，这回合爬的全没了。之前扎好的营地不受影响。",
  },
  {
    kind: "info", id: "finale", finale: true, face: "happy",
    say: "你已经会玩了！先占领 3 条路就赢。",
    note: "接下来和咕噜一号把这局打完。拿不准的时候点「提示」，我告诉你我会怎么走。",
  },
];

/** 剧本里每一掷的骰子，按顺序：你掷两次，咕噜一号掷三次（最后一次爆掉）。用完以后是普通的随机数。 */
export const TUTORIAL_DICE: readonly number[] = [3, 4, 2, 5, 1, 5, 2, 6, 2, 2, 3, 3, 5, 5, 4, 6, 1, 1, 2, 6];

/** 教程开局：你先手，对手是咕噜一号。 */
export function createTutorialGame(selfName: string, seed = 20261009): GameState {
  const game = createGame([{ id: TUTORIAL_SELF, name: selfName }, { id: TUTORIAL_RIVAL, name: TUTORIAL_RIVAL_NAME }], seed);
  game.currentPlayer = 0;
  game.events = [{ type: "TurnStarted", player: TUTORIAL_SELF }];
  return game;
}

/** 练习局重开：随机先手、随机骰子。 */
export function createPracticeGame(selfName: string, seed: number): GameState {
  return createGame([{ id: TUTORIAL_SELF, name: selfName }, { id: TUTORIAL_RIVAL, name: TUTORIAL_RIVAL_NAME }], seed);
}

/** 剧本骰子：前面按 dice 出（每次 int(6) 取一颗），用完以后交给普通随机数。 */
export interface TutorialRng extends Rng {
  /** 还剩几颗剧本骰子。 */
  readonly remaining: number;
}

export function createTutorialRng(seed: number, dice: readonly number[] = TUTORIAL_DICE): TutorialRng {
  const queue = [...dice];
  const free = createRng(seed);
  return {
    next: () => free.next(),
    int: (max) => (max === 6 && queue.length > 0 ? queue.shift()! - 1 : free.int(max)),
    pick: (items) => free.pick(items),
    shuffle: (items) => free.shuffle(items),
    get state() {
      return free.state;
    },
    get remaining() {
      return queue.length;
    },
  };
}

/** 两条命令是不是同一步（选路要比较走哪几条）。 */
export function sameCommand(a: GameCommand, b: GameCommand): boolean {
  if (a.type !== b.type) return false;
  if (a.type !== "CHOOSE" || b.type !== "CHOOSE") return true;
  return a.sums.length === b.sums.length && a.sums.every((sum, index) => sum === b.sums[index]);
}

/** 选项的锚点名：option:7+7、option:6+8、option:9（只走一条）。 */
export function optionAnchor(sums: readonly number[]): string {
  return `option:${sums.join("+")}`;
}

/**
 * 这个锚点在这个局面里，界面上应该看得见吗（给剧本单测用，对应 DiceTray / Mountain 的显示条件）。
 * viewer 是看界面的人（教程里就是你）。
 */
export function anchorVisible(state: GameState, anchor: string, viewer: string): boolean {
  const myTurn = state.phase === "playing" && state.players[state.currentPlayer]?.id === viewer;
  if (anchor === "mountain" || anchor === "dice" || anchor === "players") return true;
  if (anchor === "roll") return myTurn && state.stage !== "choose";
  if (anchor === "stop" || anchor === "odds") return myTurn && state.stage === "decide";
  if (anchor.startsWith("option:")) {
    return myTurn && state.stage === "choose" && state.options.some((option) => optionAnchor(option.sums) === anchor);
  }
  if (anchor.startsWith("runner:")) {
    const column = Number(anchor.slice("runner:".length)) as Column;
    return state.runners.some((runner) => runner.column === column);
  }
  return false;
}

/** 本回合有没有登山者已经到顶（收手就能占领）。 */
export function runnersAtTop(state: GameState): Column[] {
  return state.runners.filter((runner) => runner.height >= COLUMN_HEIGHTS[runner.column]).map((runner) => runner.column);
}
