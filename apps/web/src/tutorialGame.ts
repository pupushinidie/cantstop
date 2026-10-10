/**
 * 欲罢不能和教程有关的部分（共用的 tutorial/ 文件夹之外，每款游戏自己写的）：
 * 游戏 id、「提示」怎么说、「第一次遇到」小贴士什么时候出。
 */
import {
  advanceRunners,
  botCommand,
  bustProbability,
  COLUMN_HEIGHTS,
  optionAnchor,
  runnersAtTop,
  type Column,
  type GameState,
} from "@cantstop/game";
import { optionLabel } from "./DiceTray.js";

/** 本机记录（gm-tutorial-<id>、gm-tips-<id>）用的游戏 id。 */
export const GAME_ID = "cantstop";

export interface Hint {
  readonly say: string;
  readonly note?: string;
  /** 高亮哪个按钮（data-tutorial）；null 不指。 */
  readonly anchor: string | null;
}

/** 「提示」：让人机从你的位置算一步（它本来就只看你能看到的信息），配一句原因。 */
export function hintFor(game: GameState, playerId: string): Hint {
  if (game.phase !== "playing") return { say: "这局已经结束了。", anchor: null };
  const current = game.players[game.currentPlayer]!;
  if (current.id !== playerId) return { say: `等 ${current.name} 走完再问我。`, anchor: null };
  const command = botCommand(game, playerId);
  if (!command || game.stage === "roll") return { say: "先点「掷骰」。", anchor: "roll" };

  if (command.type === "CHOOSE") {
    const after = advanceRunners(game, current, game.runners, command.sums as Column[]) ?? [];
    const toppedNow = after
      .filter((runner) => runner.height >= COLUMN_HEIGHTS[runner.column])
      .filter((runner) => !game.runners.some((before) => before.column === runner.column && before.height >= COLUMN_HEIGHTS[before.column]))
      .map((runner) => runner.column);
    const onRunners = command.sums.every((sum) => game.runners.some((runner) => runner.column === sum));
    const middle = command.sums.some((sum) => sum >= 6 && sum <= 8);
    const note = toppedNow.length > 0 ? `这样走 ${toppedNow.join("、")} 号就到顶了，收手就能占领。`
      : onRunners ? "不用再派新的登山者，再掷更不容易爆掉。"
      : middle ? "6、7、8 最容易掷出，以后接着爬更稳。"
      : "这样走离路顶更近。";
    return { say: `我会选「${optionLabel(command.sums)}」。`, note, anchor: optionAnchor(command.sums) };
  }

  const odds = Math.round(bustProbability(game) * 100);
  if (command.type === "STOP") {
    const top = runnersAtTop(game);
    return {
      say: "我会收手扎营。",
      note: top.length > 0 ? `${top.join("、")} 号已经到顶，收手就能占领。` : `再掷有 ${odds}% 会爆掉，这回合爬得不少了，先存下来。`,
      anchor: "stop",
    };
  }
  return { say: "我会再掷一次。", note: `再掷爆掉的概率是 ${odds}%，还不算高。`, anchor: "roll" };
}

/** 「第一次遇到」小贴士的内容。 */
export const TIPS = {
  bust: { title: "第一次爆掉？", text: "这回合还没扎营的进度全丢了，之前的营地都还在。下次先看「再掷爆掉的概率」再决定。" },
  "at-top": { title: "登山者到顶了", text: "现在收手就能占领这条路；继续掷要是爆掉，这次登顶也一起作废。" },
  "three-runners": { title: "3 个登山者都派出去了", text: "这回合再掷时只能走这 3 条路，凑不出就会爆掉。" },
  "claim-self": { title: "你占领了一条路！", text: "先占领 3 条路就赢。别人在这条路上的营地全部撤下，这条路之后谁都不能再走。" },
  bumped: { title: "你的营地被撤下了", text: "别人先登顶了这条路：你在上面的营地作废，这条路之后谁都不能再走。" },
  "claim-other": { title: "有人登顶了", text: "这条路关闭了，谁都不能再走；上面其他人的营地全部撤下。" },
} as const;

/** 这一步该出哪些小贴士（按优先顺序；只出第一条没看过的）。 */
export function detectTips(game: GameState, selfId: string): string[] {
  const ids: string[] = [];
  for (const event of game.events) {
    if (event.type === "Busted" && event.player === selfId) ids.push("bust");
    if (event.type === "ColumnClaimed") {
      if (event.player === selfId) ids.push("claim-self");
      else if (event.bumped.includes(selfId)) ids.push("bumped");
      else ids.push("claim-other");
    }
  }
  const myTurn = game.phase === "playing" && game.players[game.currentPlayer]?.id === selfId;
  if (myTurn && game.stage === "decide") {
    if (runnersAtTop(game).length > 0) ids.push("at-top");
    else if (game.runners.length >= game.config.runners) ids.push("three-runners");
  }
  return ids;
}
