import { useEffect, useRef } from "react";
import { COLUMN_HEIGHTS, type GameEvent, type GameState } from "@cantstop/game";
import { ROLL_MS } from "./DiceTray.js";
import { sfx, synth, useSfxCountdown } from "./gm-sound.js";

/**
 * 欲罢不能的动作音效：对比前后两次对局快照，按这一步的 events 出声。
 * 自己的动作 mine=true 响亮，别人的（含观战时所有人的）减半。
 * 第一次拿到快照（进房间、重连、观战刚进来、教程开场）不出声；每个快照只带最近一步的事件，所以跳了很多步也只响最后一步。
 *
 * 引擎事件 → 声音：
 * - Rolled 掷 4 骰 → dice(4)
 * - Busted 爆掉 → 骰子停下时 落石（招牌）+ bust
 * - Advanced 选组合、登山者前进 → move(步数)；有登山者刚爬到顶 → reveal
 * - Stopped 收手扎营 → place（钉帐篷，两下）
 * - ColumnClaimed 登顶 → 山顶号角（招牌）+ score(big)；别人的营地被撤下 → hit
 * - TurnTimedOut 超时 → 自己 timeout，别人 pass
 * - TurnStarted 轮到你 → yourTurn；自己交出回合 → turnPassed
 * - GameEnded 终局 → gameOver(赢/输)
 * - 再来一局 / 练习局重开（version 变小）→ gameStart
 */

/** 开发时记下响了哪个声音，测试脚本读 window.__sfxLog。 */
function play(name: string, fn: () => void, delay = 0) {
  const run = () => {
    if (import.meta.env.DEV) ((window as unknown as { __sfxLog?: string[] }).__sfxLog ??= []).push(name);
    fn();
  };
  if (delay > 0) window.setTimeout(run, delay);
  else run();
}

/** 落石：低沉的隆隆声 + 几块石头滚下来磕碰。 */
function rockfall(mine: boolean) {
  const v = synth.level(mine);
  synth.noise({ duration: 0.8, volume: 0.32 * v, filter: "lowpass", freq: 700, freqTo: 120 });
  synth.tone(90, { duration: 0.6, volume: 0.22 * v, glideTo: 45 });
  for (let i = 0; i < 5; i += 1) {
    const at = 0.08 + i * 0.11 + Math.random() * 0.05;
    synth.noise({ at, duration: 0.04, volume: 0.22 * v * (1 - i * 0.12), freq: 900 * synth.jitter(0.25), q: 2 });
    synth.tone(200 * synth.jitter(0.2), { at, duration: 0.07, volume: 0.1 * v, type: "triangle" });
  }
}

/** 山顶号角：三个上行的长音，像吹响登顶的号。 */
function summitHorn(mine: boolean) {
  const v = synth.level(mine);
  synth.tone(392, { duration: 0.28, volume: 0.15 * v, type: "sawtooth" });
  synth.tone(392, { duration: 0.28, volume: 0.12 * v, type: "triangle" });
  synth.tone(523, { at: 0.22, duration: 0.3, volume: 0.13 * v, type: "sawtooth" });
  synth.tone(523, { at: 0.22, duration: 0.3, volume: 0.12 * v, type: "triangle" });
  synth.tone(784, { at: 0.46, duration: 0.7, volume: 0.12 * v, type: "sawtooth" });
  synth.tone(784, { at: 0.46, duration: 0.7, volume: 0.14 * v, type: "triangle" });
  // 旗子在风里抖一下
  synth.noise({ at: 0.5, duration: 0.3, volume: 0.08 * v, freq: 1500, freqTo: 2600, q: 0.6 });
}

type Of<T extends GameEvent["type"]> = Extract<GameEvent, { type: T }>;

export function useGameSfx(game: GameState | undefined, selfId: string) {
  const prev = useRef<GameState | undefined>(undefined);

  useEffect(() => {
    const before = prev.current;
    prev.current = game;
    if (!before || !game || before.version === game.version) return;

    // 再来一局 / 练习局重开：版本号从头算
    if (game.version < before.version) {
      play("gameStart", () => sfx.gameStart());
      if (game.phase === "playing" && game.players[game.currentPlayer]?.id === selfId) play("yourTurn", () => sfx.yourTurn(), 700);
      return;
    }

    const events = game.events;
    const find = <T extends GameEvent["type"]>(type: T) => events.find((event): event is Of<T> => event.type === type);
    const isMine = (playerId: string) => playerId === selfId;
    let at = 0;

    const timedOut = find("TurnTimedOut");
    if (timedOut) {
      const mine = isMine(timedOut.player);
      play(mine ? "timeout" : "pass", () => (mine ? sfx.timeout() : sfx.pass(false)));
      at = 350;
    }

    const rolled = find("Rolled");
    const busted = find("Busted");
    if (rolled) {
      const mine = isMine(rolled.player);
      play("dice", () => sfx.dice(4, mine));
      if (busted) {
        play("rockfall", () => rockfall(mine), ROLL_MS);
        play("bust", () => sfx.bust(mine), ROLL_MS + 250);
        at = ROLL_MS + 900;
      }
    }

    const advanced = find("Advanced");
    if (advanced) {
      const mine = isMine(advanced.player);
      play("move", () => sfx.move(advanced.sums.length, mine), at);
      const reachedTop = game.runners.some(
        (runner) =>
          advanced.sums.includes(runner.column) &&
          runner.height >= COLUMN_HEIGHTS[runner.column] &&
          !before.runners.some((old) => old.column === runner.column && old.height >= COLUMN_HEIGHTS[old.column]),
      );
      if (reachedTop) play("reveal", () => sfx.reveal(mine), at + 300);
    }

    const stopped = find("Stopped");
    if (stopped) {
      const mine = isMine(stopped.player);
      play("place", () => sfx.place(mine), at);
      play("place", () => sfx.place(mine), at + 110);
      at += 300;
    }

    const claims = events.filter((event): event is Of<"ColumnClaimed"> => event.type === "ColumnClaimed");
    if (claims.length > 0) {
      const mine = isMine(claims[0]!.player);
      play("summitHorn", () => summitHorn(mine), at);
      play("score", () => sfx.score(mine, true), at + 650);
      const bumped = claims.flatMap((claim) => claim.bumped);
      if (bumped.length > 0) play("hit", () => sfx.hit(bumped.includes(selfId)), at + 1000);
      at += 1100;
    }

    const ended = find("GameEnded");
    if (ended) {
      play("gameOver", () => sfx.gameOver(isMine(ended.winner)), at + 500);
      return;
    }

    const started = find("TurnStarted");
    if (started) {
      const actor = before.players[before.currentPlayer]?.id ?? "";
      if (isMine(started.player)) play("yourTurn", () => sfx.yourTurn(), at + 450);
      else if (isMine(actor)) play("turnPassed", () => sfx.turnPassed(), at + 400);
    }
  }, [game?.version]);
}

/** 自己行动的最后 5 秒每秒一声（gm-sound 的 useSfxCountdown）；开发时也记进 __sfxLog。 */
export function useCountdownSfx(isMyTurn: boolean, secondsLeft: number | null | undefined) {
  useSfxCountdown(isMyTurn, secondsLeft);
  useEffect(() => {
    if (import.meta.env.DEV && isMyTurn && secondsLeft != null && secondsLeft >= 1 && secondsLeft <= 5) {
      ((window as unknown as { __sfxLog?: string[] }).__sfxLog ??= []).push("countdown");
    }
  }, [isMyTurn, secondsLeft]);
}
