import { describe, expect, it } from "vitest";
import { botCommand } from "./bot.js";
import { apply, legalActions, redactGameForViewer } from "./engine.js";
import {
  anchorVisible,
  createPracticeGame,
  createTutorialGame,
  createTutorialRng,
  sameCommand,
  TUTORIAL_DICE,
  TUTORIAL_RIVAL,
  TUTORIAL_SELF,
  TUTORIAL_STEPS,
  type TutorialRng,
} from "./tutorial.js";
import type { GameState } from "./types.js";

/** 按剧本走到第 upTo 步之前（不含），返回那时的局面。 */
function playScript(upTo = TUTORIAL_STEPS.length, rng: TutorialRng = createTutorialRng(1)): GameState {
  let game = createTutorialGame("小蒲");
  for (const step of TUTORIAL_STEPS.slice(0, upTo)) {
    if (step.kind === "do") game = apply(game, TUTORIAL_SELF, step.expect, rng).state;
    if (step.kind === "watch") for (const move of step.moves) game = apply(game, TUTORIAL_RIVAL, move, rng).state;
  }
  return game;
}

const stepIndex = (id: string) => TUTORIAL_STEPS.findIndex((step) => step.id === id);

describe("新手教程剧本", () => {
  it("从头走到尾：每一步要你做的都合法、轮到的是对的人，高亮的东西在界面上看得见", () => {
    let game = createTutorialGame("小蒲");
    const rng = createTutorialRng(1);
    for (const step of TUTORIAL_STEPS) {
      if (step.anchor) expect(anchorVisible(game, step.anchor, TUTORIAL_SELF), `「${step.id}」高亮的 ${step.anchor} 看不见`).toBe(true);
      if (step.kind === "do") {
        expect(legalActions(game, TUTORIAL_SELF).some((command) => sameCommand(command, step.expect)), `「${step.id}」这一步不合法`).toBe(true);
        game = apply(game, TUTORIAL_SELF, step.expect, rng).state;
      }
      if (step.kind === "watch") {
        for (const move of step.moves) {
          expect(legalActions(game, TUTORIAL_RIVAL).some((command) => sameCommand(command, move)), `「${step.id}」里对手的 ${JSON.stringify(move)} 不合法`).toBe(true);
          game = apply(game, TUTORIAL_RIVAL, move, rng).state;
        }
      }
    }
    // 剧本骰子正好用完：多一颗少一颗，后面的剧情都会错位
    expect(rng.remaining).toBe(0);
  });

  it("关键的几幕一定发生：7 走两步、3 个登山者用满、扎营存下 6/7/8、咕噜一号爆掉", () => {
    const afterPair = playScript(stepIndex("pair") + 1);
    expect(afterPair.runners).toEqual([{ column: 7, height: 2 }]);

    const afterThree = playScript(stepIndex("three") + 1);
    expect(afterThree.runners.map((runner) => runner.column).sort((a, b) => a - b)).toEqual([6, 7, 8]);

    const afterStop = playScript(stepIndex("stop") + 1);
    const me = afterStop.players.find((player) => player.id === TUTORIAL_SELF)!;
    expect([me.progress[6], me.progress[7], me.progress[8]]).toEqual([1, 2, 1]);
    expect(afterStop.players[afterStop.currentPlayer]!.id).toBe(TUTORIAL_RIVAL);

    const afterRival = playScript(stepIndex("rival") + 1);
    expect(afterRival.lastRoll).toMatchObject({ player: TUTORIAL_RIVAL, dice: [1, 1, 2, 6], bust: true });
    expect(afterRival.events.some((event) => event.type === "Busted" && event.player === TUTORIAL_RIVAL)).toBe(true);
    // 爆掉以后轮回到你，正等着掷骰
    expect(afterRival.players[afterRival.currentPlayer]!.id).toBe(TUTORIAL_SELF);
    expect(afterRival.stage).toBe("roll");
    const rival = afterRival.players.find((player) => player.id === TUTORIAL_RIVAL)!;
    expect(rival.progress.every((height) => height === 0)).toBe(true);
  });

  it("第二回合：从营地上方接着爬、「只走一条」的选项出现、2 号路登顶后收手占领", () => {
    const beforeResume = playScript(stepIndex("resume"));
    expect(beforeResume.options.map((option) => option.sums)).toEqual(expect.arrayContaining([[2, 8], [5, 5]]));
    const afterResume = playScript(stepIndex("resume") + 1);
    // 8 号路的营地在 1 格，登山者从 2 格开始
    expect(afterResume.runners).toEqual(expect.arrayContaining([{ column: 2, height: 1 }, { column: 8, height: 2 }]));

    const beforeOnly = playScript(stepIndex("only"));
    const sums = beforeOnly.options.map((option) => option.sums.join("+")).sort();
    expect(sums).toEqual(["2+7", "4", "5"]);

    const beforeTop = playScript(stepIndex("top"));
    expect(beforeTop.options.map((option) => option.sums)).toEqual([[2, 8]]);
    const atTop = playScript(stepIndex("attop"));
    expect(atTop.runners).toEqual(expect.arrayContaining([{ column: 2, height: 3 }]));
    expect(atTop.stage).toBe("decide");

    const claimed = playScript(stepIndex("claim") + 1);
    expect(claimed.owners[2]).toBe(TUTORIAL_SELF);
    expect(claimed.events.some((event) => event.type === "ColumnClaimed" && event.column === 2 && event.player === TUTORIAL_SELF)).toBe(true);
    expect(claimed.phase).toBe("playing");
    expect(claimed.players[claimed.currentPlayer]!.id).toBe(TUTORIAL_RIVAL);
  });

  it("剧本本身：步骤 id 不重复，最后一步是唯一的收尾，说明文字不空", () => {
    const ids = TUTORIAL_STEPS.map((step) => step.id);
    expect(new Set(ids).size).toBe(ids.length);
    const finales = TUTORIAL_STEPS.filter((step) => step.kind === "info" && step.finale);
    expect(finales).toHaveLength(1);
    expect(TUTORIAL_STEPS.at(-1)).toBe(finales[0]);
    for (const step of TUTORIAL_STEPS) expect(step.say.trim().length).toBeGreaterThan(0);
  });

  it("剧本骰子按顺序出，用完以后是普通随机数", () => {
    const rng = createTutorialRng(7);
    expect(Array.from({ length: TUTORIAL_DICE.length }, () => rng.int(6) + 1)).toEqual([...TUTORIAL_DICE]);
    expect(rng.remaining).toBe(0);
    const rolls = Array.from({ length: 200 }, () => rng.int(6) + 1);
    expect(rolls.every((face) => face >= 1 && face <= 6)).toBe(true);
    expect(new Set(rolls).size).toBe(6);
  });

  it("剧本走完接练习局：两边都交给人机，120 局都能正常打完", () => {
    const stuck: string[] = [];
    for (let seed = 1; seed <= 120; seed += 1) {
      const rng = createTutorialRng(seed);
      let game = seed % 2 === 0 ? playScript(TUTORIAL_STEPS.length, rng) : createPracticeGame("小蒲", seed);
      let moves = 0;
      // 每一步都 expect 会慢到超时，用普通判断，出错时记下来
      while (game.phase === "playing" && moves < 5000) {
        const actor = game.players[game.currentPlayer]!.id;
        const command = botCommand(redactGameForViewer(game, actor), actor);
        if (!command) break;
        game = apply(game, actor, command, rng).state;
        moves += 1;
      }
      if (game.phase !== "finished" || !game.finalResult) stuck.push(`第 ${seed} 局（${moves} 步）`);
    }
    expect(stuck).toEqual([]);
  }, 60_000);
});
