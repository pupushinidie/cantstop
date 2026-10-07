import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  COLUMNS,
  type Column,
  type GameCommand,
  type GameEvent,
  type GameState,
  type LobbyRoomSnapshot,
  type Runner,
} from "@cantstop/game";
import { avatarArt, backdropFor, iconArt, seatOf, summitArt } from "./art.js";
import DiceTray, { ROLL_MS } from "./DiceTray.js";
import GameRules from "./GameRules.js";
import Mountain, { type BustGhosts, type Fresh } from "./Mountain.js";
import { socket } from "./socket.js";

interface GameBoardProps {
  readonly room: LobbyRoomSnapshot;
  readonly busy: boolean;
  readonly error: string;
  readonly notice: string;
  readonly brand: ReactNode;
  readonly connection: ReactNode;
  readonly chat: ReactNode;
  readonly onCommand: (command: GameCommand) => void;
  readonly onRematch: (accept: boolean) => void;
  readonly onDissolve: () => void;
}

function useCountdown(room: LobbyRoomSnapshot): number | null {
  const [now, setNow] = useState(Date.now());
  const [anchor, setAnchor] = useState({ at: Date.now(), ms: room.turnRemainingMs });
  useEffect(() => setAnchor({ at: Date.now(), ms: room.turnRemainingMs }), [room]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, []);
  if (anchor.ms === undefined) return null;
  return Math.max(0, Math.ceil((anchor.ms - (now - anchor.at)) / 1000));
}

const joinColumns = (columns: readonly number[]) => columns.join("、");

function describeEvent(event: GameEvent, name: (id: string) => string): string | null {
  switch (event.type) {
    case "Rolled":
      return `${name(event.player)} 掷出 ${event.dice.join(" ")}`;
    case "Advanced":
      return event.sums.length === 2 && event.sums[0] === event.sums[1]
        ? `${name(event.player)} 在 ${event.sums[0]} 号赛道爬 2 格`
        : `${name(event.player)} 爬 ${joinColumns(event.sums)} 号赛道`;
    case "Busted":
      return event.lost.length > 0
        ? `${name(event.player)} 爆掉了！${joinColumns(event.lost.map((runner) => runner.column))} 号赛道的进度作废`
        : `${name(event.player)} 爆掉了`;
    case "Stopped":
      return `${name(event.player)} 收手，在 ${joinColumns(event.saved.map((entry) => entry.column))} 号赛道扎营`;
    case "ColumnClaimed":
      return `${name(event.player)} 登顶 ${event.column} 号赛道！${event.bumped.length > 0 ? `${event.bumped.map(name).join("、")}的营地被撤下` : ""}`;
    case "TurnTimedOut":
      return event.stage === "roll" ? `${name(event.player)} 超时，跳过这回合` : `${name(event.player)} 超时，自动收手`;
    case "GameEnded":
      return `${name(event.winner)} 占领 3 条赛道，获胜！`;
    default:
      return null;
  }
}

type Banner = { readonly key: string; readonly text: string; readonly tone: "bust" | "summit" | "turn" | "win" };

function GameBoard({ room, busy, error, notice, brand, connection, chat, onCommand, onRematch, onDissolve }: GameBoardProps) {
  const game = room.game!;
  const member = room.members.find((candidate) => candidate.id === socket.id);
  const myId = member?.playerId ?? "";
  const isHost = member?.isHost ?? false;
  const current = game.players[game.currentPlayer]!;
  const myTurn = game.phase === "playing" && current.id === myId;
  const secondsLeft = useCountdown(room);
  const nameOf = (playerId: string) => (playerId === myId ? "你" : game.players.find((player) => player.id === playerId)?.name ?? "?");
  const colorOf = (playerId: string) => game.players.find((player) => player.id === playerId)?.color ?? 0;
  const connected = (playerId: string) => room.members.find((candidate) => candidate.playerId === playerId)?.connected ?? false;
  // 「对局已开始」这类提示只留到第一步动作
  const firstVersion = useRef(game.version);
  const shownNotice = game.version === firstVersion.current ? notice : "";

  const [preview, setPreview] = useState<Runner[] | null>(null);
  const [rollKey, setRollKey] = useState<string | null>(null);
  const [bust, setBust] = useState<BustGhosts | null>(null);
  const [fresh, setFresh] = useState<Fresh | null>(null);
  const [banner, setBanner] = useState<Banner | null>(null);
  const [log, setLog] = useState<{ key: string; text: string }[]>([]);
  const seenVersion = useRef(game.version);

  useEffect(() => {
    if (game.version === seenVersion.current) return;
    // 再来一局时版本号从头算：清掉上一局的日志和动画
    const restarted = game.version < seenVersion.current;
    seenVersion.current = game.version;
    if (restarted) {
      setLog([]);
      setBust(null);
      setFresh(null);
    }
    const key = String(game.version);
    const events = game.events;
    const lines = events
      .map((event, index) => ({ key: `${key}-${index}`, text: describeEvent(event, nameOf) }))
      .filter((line): line is { key: string; text: string } => line.text !== null);
    // 最新的一步排在最上面；同一步里的几条也是后发生的在上（不要在更新函数里原地 reverse，开发模式会调两次）
    const newestFirst = [...lines].reverse();
    setLog((previous) => [...newestFirst, ...(restarted ? [] : previous)].slice(0, 60));

    const rolled = events.find((event) => event.type === "Rolled");
    if (rolled) setRollKey(key);
    const busted = events.find((event) => event.type === "Busted");
    const stopped = events.find((event) => event.type === "Stopped");
    const claims = events.filter((event): event is Extract<GameEvent, { type: "ColumnClaimed" }> => event.type === "ColumnClaimed");
    const ended = events.find((event) => event.type === "GameEnded");
    const started = events.find((event) => event.type === "TurnStarted");

    if (busted) {
      setBust({ key, color: colorOf(busted.player), runners: busted.lost });
      setBanner({ key, text: `${nameOf(busted.player)} 爆掉了！`, tone: "bust" });
    } else if (stopped) {
      setFresh({
        key,
        player: stopped.player,
        camps: stopped.saved.map((entry) => entry.column),
        summits: claims.map((claim) => claim.column),
      });
      if (ended) setBanner({ key, text: `${nameOf(ended.winner)} 登顶 3 座山峰，获胜！`, tone: "win" });
      else if (claims.length > 0) setBanner({ key, text: `${nameOf(stopped.player)} 登顶 ${joinColumns(claims.map((claim) => claim.column))} 号！`, tone: "summit" });
    }
    if (started && started.player === myId && !busted && claims.length === 0) {
      setBanner({ key, text: "轮到你了", tone: "turn" });
    }
  }, [game.version]);

  // 轮到自己而页面在后台时，标签页标题提醒一下
  useEffect(() => {
    const base = document.title.replace(/^【轮到你】/, "");
    const update = () => { document.title = myTurn && document.hidden ? `【轮到你】${base}` : base; };
    update();
    document.addEventListener("visibilitychange", update);
    return () => {
      document.removeEventListener("visibilitychange", update);
      document.title = base;
    };
  }, [myTurn]);

  // 爆掉的登山者摔完、横幅播完就清掉
  useEffect(() => {
    if (!bust) return;
    const timer = window.setTimeout(() => setBust(null), ROLL_MS + 1800);
    return () => window.clearTimeout(timer);
  }, [bust?.key]);
  useEffect(() => {
    if (!banner) return;
    const timer = window.setTimeout(() => setBanner(null), banner.tone === "bust" ? ROLL_MS + 2200 : 2400);
    return () => window.clearTimeout(timer);
  }, [banner?.key]);

  let prompt: string;
  if (game.phase === "finished") prompt = `${nameOf(game.finalResult!.winner)} 获胜`;
  else if (myTurn && game.stage === "roll") prompt = "轮到你了：掷骰子";
  else if (myTurn && game.stage === "choose") prompt = "选一种走法（鼠标停在选项上可以预览）";
  else if (myTurn) prompt = "再掷一次，还是收手扎营？";
  else prompt = `${current.name} 的回合`;

  const seat = seatOf(current.color);

  return (
    <div className="cs-screen" style={{ "--turn": seat.hex } as CSSProperties}>
      <header className="cs-topbar">
        {brand}
        <div className="cs-turn">
          <span>第 {game.turn} 手</span>
          {game.phase === "playing" && (
            <span className={myTurn ? "cs-turn-who mine" : "cs-turn-who"}>
              <img src={avatarArt(current.color)} alt="" />
              {myTurn ? "轮到你" : `轮到 ${current.name}`}
            </span>
          )}
          {game.phase === "playing" && secondsLeft !== null && <b className={secondsLeft <= 10 ? "cs-timer low" : "cs-timer"}>{secondsLeft}s</b>}
        </div>
        <div className="cs-topbar-right">
          <GameRules />
          {isHost && <button className="quiet-button danger" type="button" onClick={onDissolve}>解散</button>}
          {connection}
        </div>
      </header>

      <div className="cs-layout">
        <section className="cs-stage" style={{ backgroundImage: `url(${backdropFor(room.code)})` }}>
          <div className="cs-hud">
            <div className={myTurn ? "cs-prompt mine" : "cs-prompt"} role="status">
              <i className="cs-dot" style={{ background: seat.hex }} />{prompt}
            </div>
            {(error || shownNotice) && <p className={error ? "cs-feedback error" : "cs-feedback"} role={error ? "alert" : "status"}>{error || shownNotice}</p>}
          </div>
          <Mountain game={game} preview={preview} bust={bust} fresh={fresh} nameOf={nameOf} />
          {banner && (
            <div className={`cs-banner ${banner.tone}`} key={banner.key} aria-hidden="true">
              {banner.tone === "bust" && <img src={iconArt.rockfall} alt="" />}
              {(banner.tone === "summit" || banner.tone === "win") && <img src={iconArt.trophy} alt="" />}
              {banner.text}
            </div>
          )}
        </section>

        <aside className="cs-side">
          <DiceTray game={game} myTurn={myTurn} busy={busy} rollKey={rollKey} onCommand={onCommand} onPreview={setPreview} />
          <Players game={game} myId={myId} connected={connected} />
          <section className="cs-panel cs-log">
            <h3>登山日志</h3>
            {log.length === 0 ? <p className="cs-muted">还没有动作。</p> : <ul>{log.map((line) => <li key={line.key}>{line.text}</li>)}</ul>}
          </section>
          <div className="cs-chat">{chat}</div>
        </aside>
      </div>
      {game.phase === "finished" && <FinalDialog game={game} room={room} myId={myId} onRematch={onRematch} />}
    </div>
  );
}

function ClaimedSlots({ game, playerId }: { game: GameState; playerId: string }) {
  const claimed = COLUMNS.filter((column) => game.owners[column] === playerId);
  const color = game.players.find((player) => player.id === playerId)?.color ?? 0;
  const slots = Math.max(game.config.columnsToWin, claimed.length);
  return (
    <span className="cs-slots" aria-label={`已占领 ${claimed.length} 条赛道`}>
      {Array.from({ length: slots }, (_, index) => {
        const column: Column | undefined = claimed[index];
        return column !== undefined ? (
          <span key={index} className="cs-slot filled" title={`${column} 号赛道`}>
            <img src={summitArt(color)} alt="" />
            <b>{column}</b>
          </span>
        ) : <span key={index} className="cs-slot" />;
      })}
    </span>
  );
}

function Players({ game, myId, connected }: { game: GameState; myId: string; connected: (id: string) => boolean }) {
  return (
    <section className="cs-panel cs-players">
      <h3>登山队 <small>先占领 {game.config.columnsToWin} 条赛道获胜</small></h3>
      {game.players.map((player, index) => {
        const active = game.phase === "playing" && game.currentPlayer === index;
        const camps = COLUMNS.filter((column) => (player.progress[column] ?? 0) > 0 && !game.owners[column]).length;
        return (
          <div
            className={["cs-player", active ? "active" : "", !connected(player.id) ? "offline" : ""].join(" ")}
            key={player.id}
            style={{ "--seat": seatOf(player.color).hex } as CSSProperties}
          >
            <img className="cs-avatar" src={avatarArt(player.color)} alt="" />
            <div className="cs-player-main">
              <strong>
                {player.name}
                {player.id === myId && <small className="cs-you">你</small>}
                {!connected(player.id) && <small className="cs-offline">离线</small>}
              </strong>
              <span>{active ? (game.stage === "roll" ? "准备掷骰" : `本回合已掷 ${game.rollsThisTurn} 次`) : `营地 ${camps} 处`}</span>
            </div>
            <ClaimedSlots game={game} playerId={player.id} />
          </div>
        );
      })}
    </section>
  );
}

function FinalDialog({ game, room, myId, onRematch }: { game: GameState; room: LobbyRoomSnapshot; myId: string; onRematch: (accept: boolean) => void }) {
  const result = game.finalResult!;
  const accepted = room.rematch?.acceptedIds.includes(socket.id ?? "") ?? false;
  const rows = [...game.players].sort((a, b) => (b.id === result.winner ? 1 : 0) - (a.id === result.winner ? 1 : 0) || b.score - a.score);
  const winner = game.players.find((player) => player.id === result.winner)!;
  return (
    <div className="gm-modal-backdrop" role="presentation">
      <section className="gm-panel cs-final" role="dialog" aria-modal="true" aria-labelledby="cs-final-title">
        <img className="cs-final-trophy" src={iconArt.trophy} alt="" />
        <h2 id="cs-final-title">{winner.id === myId ? "你登顶了！" : `${winner.name} 获胜`}</h2>
        <ol className="cs-standings">
          {rows.map((player) => (
            <li key={player.id} className={player.id === result.winner ? "winner" : ""} style={{ "--seat": seatOf(player.color).hex } as CSSProperties}>
              <img className="cs-avatar" src={avatarArt(player.color)} alt="" />
              <strong>{player.name}{player.id === myId ? "（你）" : ""}</strong>
              <ClaimedSlots game={game} playerId={player.id} />
            </li>
          ))}
        </ol>
        {room.rematch && (
          <div className="cs-rematch">
            <span>再来一局？还剩 {Math.ceil(room.rematch.remainingMs / 1000)} 秒（{room.rematch.acceptedIds.length}/{room.members.length} 人同意）</span>
            <div className="gm-panel-actions">
              <button className="quiet-button" type="button" onClick={() => onRematch(false)}>离开</button>
              <button className="primary-button" type="button" disabled={accepted} onClick={() => onRematch(true)}>{accepted ? "等待其他人" : "再来一局"}</button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

export default GameBoard;
