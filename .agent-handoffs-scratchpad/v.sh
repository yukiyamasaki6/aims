#!/bin/bash
cd /root/worktrees/aims-batch1-simplify
S=/tmp/claude-0/-home-user/8d234c46-e442-5d63-b5e4-2eb590f18707/scratchpad
pnpm typecheck 2>&1 | tail -3
$S/lint.sh
pnpm knip 2>&1 | tail -3
pnpm test > $S/test.out 2>&1; echo "test exit=$?"; grep -E "ERROR|FAIL" $S/test.out | head
