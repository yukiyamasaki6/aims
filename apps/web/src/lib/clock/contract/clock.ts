// 時刻と時間の経過。例外: どれも投げない。
export type Clock = {
  now(): number;
  // msの後に1回runを呼ぶ。取り消す関数を返す。
  after(ms: number, run: () => void): () => void;
};
