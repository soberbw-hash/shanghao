import { useId } from "react";

const mobaGames = new Set(["英雄联盟", "Dota 2", "王者荣耀世界"]);
const shooterGames = new Set([
  "CS2",
  "无畏契约",
  "三角洲行动",
  "穿越火线",
  "守望先锋",
  "Apex 英雄",
  "绝地求生",
  "Fortnite",
  "彩虹六号：围攻",
  "战地风云",
  "暗区突围：无限",
  "逃离塔科夫",
  "终极角逐",
  "漫威争锋",
  "绝地潜兵 2",
  "命运 2",
  "Warframe",
]);
const cozyGames = new Set([
  "我的世界",
  "星露谷物语",
  "泰拉瑞亚",
  "胡闹厨房",
  "粒粒的小人国",
  "幻兽帕鲁",
  "洛克王国：世界",
]);
const racingGames = new Set(["火箭联盟", "极限竞速：地平线 5", "GTA V"]);

/** Decorative genre artwork, never a live screenshot or invented game telemetry. */
export const GameMonitorScene = ({ gameName }: { gameName: string }) => {
  const gradient = useId();
  const genre = mobaGames.has(gameName)
    ? "moba"
    : shooterGames.has(gameName)
      ? "tactical"
      : cozyGames.has(gameName)
        ? "cozy"
        : racingGames.has(gameName)
          ? "racing"
          : "adventure";
  return (
    <svg
      className="scene-game-illustration"
      viewBox="0 0 160 90"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
      data-game-genre={genre}
    >
      <defs>
        <linearGradient id={gradient} x2="0" y2="1">
          <stop stopColor={genre === "cozy" ? "#8bb9d8" : "#233b55"} />
          <stop offset="1" stopColor={genre === "cozy" ? "#e7dcc2" : "#122235"} />
        </linearGradient>
      </defs>
      <path fill={`url(#${gradient})`} d="M0 0h160v90H0z" />
      {genre === "moba" ? (
        <>
          <path fill="#315c58" d="M10 5h140v78H10z" />
          <path
            d="M24 70V18h112v52H24L136 18"
            fill="none"
            stroke="#87a98c"
            strokeWidth="8"
            strokeLinejoin="round"
          />
          <path d="m25 12 111 67" stroke="#4d929b" strokeWidth="6" />
          {[36, 58, 98, 122].map((x, i) => (
            <g key={x} transform={`translate(${x} ${i % 2 ? 58 : 32})`}>
              <path d="m-7 6 7-18 7 18" fill="#23483f" />
              <circle cy="8" r="5" fill="#244f44" />
            </g>
          ))}
          <rect x="17" y="63" width="14" height="14" rx="3" fill="#7bbbdc" stroke="#cbecff" />
          <rect x="130" y="12" width="14" height="14" rx="3" fill="#cf8c87" stroke="#ffe1cd" />
          {[48, 80, 112].map((x) => (
            <g key={x}>
              <circle cx={x} cy={83 - x / 2} r="4" fill="#e7dbaa" />
              <circle cx={x} cy={83 - x / 2} r="7" fill="none" stroke="#e7dbaa" opacity=".4" />
            </g>
          ))}
        </>
      ) : genre === "tactical" ? (
        <>
          <path d="M0 16h42v49H0M118 11h42v60h-42" fill="#587080" />
          <path d="m42 16 18 20v31H42m76-56-20 26v33h20" fill="#344b61" />
          <path d="M61 34h36v32H61z" fill="#bdc5ba" />
          <path d="m0 90 60-24h38l62 24" fill="#5e6c71" />
          <circle cx="80" cy="49" r="8" fill="none" stroke="#cfebdf" opacity=".8" />
          <path d="M80 36v7m0 12v7M67 49h7m12 0h7" stroke="#d4eddf" />
          <path d="m64 90 6-14 12-6 8 6 7 14" fill="#243d50" stroke="#89a6b2" />
          <rect x="7" y="6" width="21" height="15" rx="2" fill="#182e40" stroke="#a8beb6" />
          <path d="m10 17 6-8 7 8" fill="none" stroke="#a5d6c8" />
        </>
      ) : genre === "cozy" ? (
        <>
          <circle cx="124" cy="20" r="9" fill="#fff3cf" />
          <path d="M0 55q35-26 75-5t85-5v45H0" fill="#84b294" />
          <path d="M0 72q48-22 80-9t80 0v27H0" fill="#aac39b" />
          <path d="M40 47h34v25H40z" fill="#f0dcc1" />
          <path d="m35 48 22-21 22 21" fill="#7e9bab" />
          <rect x="52" y="57" width="10" height="15" rx="2" fill="#7da5ad" />
          {[20, 104, 140].map((x) => (
            <g key={x}>
              <path d={`M${x} 69V46`} stroke="#789981" strokeWidth="4" />
              <circle cx={x} cy="44" r="13" fill="#63958b" />
              <circle cx={x - 5} cy="38" r="8" fill="#83ada0" />
            </g>
          ))}
          <path d="m70 90 9-17 7-3 5 20" fill="#e9dcc0" />
        </>
      ) : genre === "racing" ? (
        <>
          <path d="M0 44 26 20l29 24 27-25 31 25 26-16 21 16" fill="#5f8291" />
          <path d="m47 90 25-48h16l26 48" fill="#506377" />
          <path d="M80 51v7m0 9v9m0 10v4" stroke="#ece0bb" strokeWidth="3" />
          <path d="m56 84 9-18h30l10 18" fill="#91becd" stroke="#dceef2" strokeWidth="2" />
          <path d="m70 66 3-8h15l4 8" fill="#293f5a" />
          <path d="M59 85h10m25 0h9" stroke="#f7d3b1" strokeWidth="3" />
        </>
      ) : (
        <>
          <circle cx="124" cy="20" r="11" fill="#d5e3e5" opacity=".75" />
          <path d="m0 61 33-35 29 28 25-43 47 47 26-18v50H0" fill="#536e82" />
          <path d="m0 77 49-27 39 26 38-24 34 18v20H0" fill="#304e61" />
          <ellipse cx="81" cy="80" rx="21" ry="5" fill="#80bfc5" opacity=".28" />
          <path d="M76 78v-17q0-5 5-5t5 5v17" fill="#e5d6b7" />
          <circle cx="81" cy="51" r="5" fill="#e5d6b7" />
          <path d="m85 65 16-18" stroke="#ccebef" strokeWidth="2" />
          <circle cx="40" cy="61" r="3" fill="#e8c888" />
        </>
      )}
      <path d="M0 0h160v5H0zM0 86h160v4H0z" fill="#15283e" opacity=".55" />
    </svg>
  );
};
