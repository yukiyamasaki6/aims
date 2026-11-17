// 図の中の的の輪の色。アプリの的の定義(target_face_rings。supabase/migrations/20261016000100_target_faces.sql)の色と同じで、画面の配色(テーマ)に依存しない。
export const WHITE = "#FFFFFF";
export const BLACK = "#231F20";
export const BLUE = "#00B4E4";
export const RED = "#F65058";
export const GOLD = "#FFE552";

// 的の細い線(標準の的の外周の線、6点的・3つ目の6点的の輪の境の線)の太さ。図の座標(viewBox)で1。図ごとの拡大率(group の scale)に応じて逆数で補正して、図の座標で同じ太さにする(画面上の太さは、図の大きさに比例する)。
export const TARGET_LINE = 1;
