"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@/types/supabase";

type Memo = Tables<"memos">;

const supabase = createClient();

export default function Home() {
  const [memos, setMemos] = useState<Memo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newContent, setNewContent] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingContent, setEditingContent] = useState("");

  const fetchMemos = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("memos")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      setError(error.message);
    } else {
      setMemos(data);
      setError(null);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchMemos();
  }, [fetchMemos]);

  async function addMemo() {
    if (!newContent.trim()) return;

    const { error } = await supabase
      .from("memos")
      .insert({ content: newContent.trim() });

    if (error) {
      setError(error.message);
    } else {
      setNewContent("");
      await fetchMemos();
    }
  }

  async function updateMemo(id: string) {
    if (!editingContent.trim()) return;

    const { error } = await supabase
      .from("memos")
      .update({ content: editingContent.trim() })
      .eq("id", id);

    if (error) {
      setError(error.message);
    } else {
      setEditingId(null);
      setEditingContent("");
      await fetchMemos();
    }
  }

  async function deleteMemo(id: string) {
    const { error } = await supabase.from("memos").delete().eq("id", id);

    if (error) {
      setError(error.message);
    } else {
      await fetchMemos();
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col gap-6 p-8">
      <div className="flex items-center gap-2">
        <h1 className="text-2xl font-bold">Memos</h1>
        <span className="rounded-full bg-blue-100 px-3 py-1 text-xs font-semibold text-blue-800 dark:bg-blue-900 dark:text-blue-300">
          Supabase 動作確認
        </span>
      </div>

      {error && (
        <p className="rounded-md bg-red-100 px-3 py-2 text-sm text-red-800 dark:bg-red-900 dark:text-red-300">
          {error}
        </p>
      )}

      <div className="flex gap-2">
        <input
          className="flex-1 rounded-md border px-3 py-2 text-sm"
          placeholder="新しいメモを入力"
          value={newContent}
          onChange={(e) => setNewContent(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addMemo()}
        />
        <Button onClick={addMemo}>追加</Button>
      </div>

      {loading ? (
        <p className="text-muted-foreground text-sm">読み込み中...</p>
      ) : memos.length === 0 ? (
        <p className="text-muted-foreground text-sm">メモがありません。</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {memos.map((memo) => (
            <li
              key={memo.id}
              className="flex items-center gap-2 rounded-md border px-3 py-2"
            >
              {editingId === memo.id ? (
                <>
                  <input
                    className="flex-1 rounded-md border px-2 py-1 text-sm"
                    value={editingContent}
                    onChange={(e) => setEditingContent(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && updateMemo(memo.id)}
                  />
                  <Button size="sm" onClick={() => updateMemo(memo.id)}>
                    保存
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setEditingId(null)}
                  >
                    キャンセル
                  </Button>
                </>
              ) : (
                <>
                  <span className="flex-1 text-sm">{memo.content}</span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setEditingId(memo.id);
                      setEditingContent(memo.content);
                    }}
                  >
                    編集
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => deleteMemo(memo.id)}
                  >
                    削除
                  </Button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
