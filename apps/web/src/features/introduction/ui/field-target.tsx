// フィールド的(簡略化した描き方)。外から、黒の面、黄の中心の同心円と、黒の面の上の白い細い線1本。色と、色ごとの外縁の半径の比は、アプリの的の定義(target_face_ringsの的ID a1000000-0000-0000-0000-000000000011。supabase/migrations/20261127010002_target_faces.sql)と同じ。
// アプリの白は、黒の面を区切る細い境界線(半径の比 0.5・2/3・5/6・1)で、この図では、そのうち 2/3 の位置の1本だけを、白い線として描く。
import { BLACK, WHITE, GOLD as YELLOW } from "./target-style";

// 色ごとの外縁の半径の比(的の半径に対する比)。アプリの定義と同じ。
const FIELD_EDGES = { yellow: 1 / 3, black: 1 } as const;
// 白い境界線の位置(アプリの白い境界線 0.5・2/3・5/6・1 のうち、2/3)
const FIELD_WHITE_BORDER = 2 / 3;

// 白い線の太さ(図の座標)。黒の面の上では、他の的の細い線(TARGET_LINE = 1)だと、画面上で約0.18pxになって見えないので、画面上で約0.75pxになる4.2にする(幅375・1024で見える、いちばん細い太さ)。的の大きさによらず同じ値で、図の中の的(card 01・04の大小の的)は、group の拡大をかけずに描くので、画面上でも同じ太さになる。
const FIELD_WHITE_LINE = 4.2;

type FieldTargetProps = {
  x: number;
  y: number;
  // 的の半径(いちばん外側の黒の半径)
  outer: number;
};

export function FieldTarget({ x, y, outer }: FieldTargetProps) {
  return (
    <g transform={`translate(${x} ${y})`} stroke="none">
      <circle r={outer * FIELD_EDGES.black} fill={BLACK} />
      <circle r={outer * FIELD_EDGES.yellow} fill={YELLOW} />
      <circle
        r={outer * FIELD_WHITE_BORDER}
        fill="none"
        stroke={WHITE}
        strokeWidth={FIELD_WHITE_LINE}
      />
    </g>
  );
}
